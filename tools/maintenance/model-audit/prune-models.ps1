<#
.SYNOPSIS
  Act on model-audit.csv. Dry-run by default; nothing is ever deleted outright.
  Refuses rows the rescan still finds in use (override with -AllowInUse).

.DESCRIPTION
  The audit produced model-audit.csv with a verdict per model. You decide what
  actually goes by filling the ACTION column (or by trusting the verdict column
  with -UseVerdict). This script then works in two deliberate steps:

     -Execute   MOVE the selected files to <drive>\_model_quarantine\
                On the same volume a move is a rename: instant, even for 300 GB,
                and completely reversible with -Restore. It does NOT free space.
     -Purge     permanently delete the quarantine. THIS is what frees the space,
                and only after you have run ComfyUI and confirmed nothing broke.

  Work in that order. Quarantine, restart ComfyUI, run the workflows you care
  about, then purge. If something breaks, -Restore puts it back in seconds.

.PARAMETER UseVerdict
  Select rows by the audit's own `verdict` column instead of your ACTION column.
  Combine with -Verdict to choose which (default DELETE).

.EXAMPLE
  .\prune-models.ps1                      # dry run on your ACTION column
  .\prune-models.ps1 -UseVerdict          # dry run on the audit's DELETE verdicts
  .\prune-models.ps1 -UseVerdict -Execute # quarantine them
  .\prune-models.ps1 -Restore             # undo
  .\prune-models.ps1 -Purge               # free the space, after verifying
#>
[CmdletBinding(DefaultParameterSetName = 'Plan')]
param(
    [Parameter(ParameterSetName = 'Plan')]
    [Parameter(ParameterSetName = 'Execute')]
    [switch]$UseVerdict,

    [Parameter(ParameterSetName = 'Plan')]
    [Parameter(ParameterSetName = 'Execute')]
    [ValidateSet('DELETE', 'REVIEW', 'KEEP')]
    [string]$Verdict = 'DELETE',

    [Parameter(ParameterSetName = 'Execute')][switch]$Execute,
    [Parameter(ParameterSetName = 'Restore')][switch]$Restore,
    [Parameter(ParameterSetName = 'Purge')][switch]$Purge,

    # NOTE: do NOT default this to (Join-Path $PSScriptRoot ...) in the param
    # block. With parameter sets declared, $PSScriptRoot is not yet populated
    # when defaults are evaluated, so -Restore and -Purge (which nobody passes
    # -Csv to) died on "Path is an empty string" before doing anything.
    # Resolved in the body instead, like $Quarantine.
    [string]$Csv,
    # Delete even rows the rescan reports as still in use. You almost never
    # want this -- see the BLOCKED message for what each row is needed by.
    [switch]$AllowInUse,
    [string]$Quarantine
)

$ErrorActionPreference = 'Stop'

# Where ComfyUI is comes from ComfyQ's own config (Manage ComfyUI -> ComfyUI
# Settings), not from this script's position or a hardcoded folder name. The
# previous version named "ComfyUI_windows_portable_nvidia" outright, which is
# the layout of one particular disk image.
$repoRoot = $PSScriptRoot
while ($repoRoot -and -not (Test-Path (Join-Path $repoRoot 'package.json'))) {
    $parent = Split-Path $repoRoot -Parent
    if (-not $parent -or $parent -eq $repoRoot) { $repoRoot = $null; break }
    $repoRoot = $parent
}
$comfyRoot = $env:COMFY_ROOT
if (-not $comfyRoot -and $repoRoot) {
    $cfgPath = Join-Path $repoRoot 'config.json'
    if (Test-Path $cfgPath) {
        try {
            $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
            if ($cfg.comfy_ui.root_path) { $comfyRoot = $cfg.comfy_ui.root_path }
        } catch { }
    }
}
if (-not $comfyRoot) {
    Write-Host "Could not find the ComfyUI install." -ForegroundColor Red
    Write-Host "Set it in ComfyQ (Manage ComfyUI -> ComfyUI Settings), or run with COMFY_ROOT set." -ForegroundColor Red
    exit 1
}
$models = Join-Path $comfyRoot 'models'
# Quarantine goes on the same volume as the models, so a move is instant and
# needs no second copy of a 40 GB file.
if (-not $Quarantine) { $Quarantine = Join-Path ([System.IO.Path]::GetPathRoot($models)) '_model_quarantine' }
if (-not $Csv) { $Csv = Join-Path $PSScriptRoot 'model-audit.csv' }
$log = Join-Path $PSScriptRoot 'prune-log.csv'

if (-not (Test-Path $models)) {
    Write-Host "Models folder not found at: $models" -ForegroundColor Red
    Write-Host "Check comfy_ui.root_path in ComfyQ config.json (Manage ComfyUI -> ComfyUI Settings)." -ForegroundColor Red
    exit 1
}

function Test-ComfyRunning {
    try { $null = Invoke-WebRequest 'http://127.0.0.1:8188/system_stats' -TimeoutSec 3 -UseBasicParsing; return $true }
    catch { return $false }
}
function Show-Size([double]$bytes) { '{0,9:N1} GB' -f ($bytes / 1GB) }

# ---------------------------------------------------------------- RESTORE ---
if ($Restore) {
    if (-not (Test-Path $Quarantine)) { Write-Host "Nothing quarantined ($Quarantine does not exist)."; exit 0 }
    if (Test-ComfyRunning) { Write-Host "Stop ComfyUI first - it has model files open." -ForegroundColor Red; exit 1 }
    $n = 0; $b = 0
    Get-ChildItem $Quarantine -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($Quarantine.Length).TrimStart('\')
        $dest = Join-Path $models $rel
        New-Item -ItemType Directory -Force -LiteralPath (Split-Path $dest) | Out-Null
        Move-Item -LiteralPath $_.FullName -Destination $dest -Force
        $n++; $b += $_.Length
    }
    Get-ChildItem $Quarantine -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending |
        Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Recurse -File) } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
    Write-Host "Restored $n files ($(Show-Size $b)) to models\." -ForegroundColor Green
    Write-Host "Restart ComfyUI." -ForegroundColor Yellow
    exit 0
}

# ------------------------------------------------------------------ PURGE ---
if ($Purge) {
    if (-not (Test-Path $Quarantine)) { Write-Host "Nothing quarantined."; exit 0 }
    $f = Get-ChildItem $Quarantine -Recurse -File
    $b = ($f | Measure-Object Length -Sum).Sum
    Write-Host ""
    Write-Host "  About to PERMANENTLY DELETE $($f.Count) files, $(Show-Size $b)" -ForegroundColor Red
    Write-Host "  from $Quarantine" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Have you restarted ComfyUI and run the workflows you care about? " -NoNewline -ForegroundColor Yellow
    if ((Read-Host "Type PURGE to confirm") -ne 'PURGE') { Write-Host "Aborted - nothing deleted."; exit 0 }
    Remove-Item $Quarantine -Recurse -Force
    Write-Host "Purged. $(Show-Size $b) freed." -ForegroundColor Green
    exit 0
}

# --------------------------------------------------------- PLAN / EXECUTE ---
if (-not (Test-Path $Csv)) { Write-Host "Not found: $Csv" -ForegroundColor Red; exit 1 }
$rows = Import-Csv $Csv -Delimiter ';'

$selected = @(if ($UseVerdict) {
    $rows | Where-Object { $_.verdict -eq $Verdict }
} else {
    $rows | Where-Object { $_.ACTION -and $_.ACTION.Trim().ToUpper() -eq 'DELETE' }
})

if (-not $selected) {
    Write-Host ""
    if ($UseVerdict) { Write-Host "No rows with verdict = $Verdict." }
    else {
        Write-Host "No rows selected." -ForegroundColor Yellow
        Write-Host "Open model-audit.csv and put DELETE in the ACTION column for what you want gone,"
        Write-Host "or re-run with -UseVerdict to act on the audit's own DELETE verdicts."
    }
    exit 0
}

# --- safety net: never quietly delete something the rescan finds in use ----
# status comes from build_csv.py:
#   LOADED        a workflow names it in a loader widget
#   PICKABLE      a ComfyQ dropdown offers it to students (built from disk)
#   AUTO-DOWNLOAD a custom node fetches it by name at runtime
$inUse = $selected | Where-Object {
    $_.status -and @('LOADED', 'PICKABLE', 'AUTO-DOWNLOAD') -contains $_.status
}
if ($inUse -and -not $AllowInUse) {
    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor Red
    Write-Host "  BLOCKED: $($inUse.Count) selected row(s) are still in use." -ForegroundColor Red
    Write-Host ("=" * 78) -ForegroundColor Red
    $inUse | Sort-Object { [double]$_.gb } -Descending | Select-Object -First 20 | ForEach-Object {
        $who = if ($_.used_in) { $_.used_in } else { 'custom node' }
        "  {0,8} GB  {1,-14} {2}" -f $_.gb, $_.status, $_.name
        "            used by: $who"
    }
    if ($inUse.Count -gt 20) { Write-Host "  ... and $($inUse.Count - 20) more" }
    Write-Host ""
    Write-Host "  Deleting these breaks a workflow, a student dropdown, or a node." -ForegroundColor Yellow
    Write-Host "  The used_by column says exactly what needs each one (AUDIT.bat shows it)." -ForegroundColor Yellow
    Write-Host "  If you really mean it, re-run with -AllowInUse." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Nothing was changed." -ForegroundColor Cyan
    exit 1
}

$plan = @(foreach ($r in $selected) {
    $p = Join-Path (Split-Path $models -Parent) ($r.relpath -replace '/', '\')
    # -LiteralPath everywhere: [ ] * ? are wildcards to PowerShell, and model
    # filenames really do contain them ("[LoRa] Something.safetensors"). Without
    # it such a file silently reports as missing and is never pruned.
    $exists = Test-Path -LiteralPath $p
    $size = 0
    if ($exists) {
        $size = if (Test-Path -LiteralPath $p -PathType Container) {
            (Get-ChildItem -LiteralPath $p -Recurse -File | Measure-Object Length -Sum).Sum
        } else { (Get-Item -LiteralPath $p).Length }
    }
    [PSCustomObject]@{
        Name = $r.name; Category = $r.category; Path = $p; Exists = $exists
        Bytes = [double]$size; Backup = $r.backup; Verdict = $r.verdict; Risk = $r.risk
    }
})

$present = @($plan | Where-Object Exists)
$total = ($present | Measure-Object Bytes -Sum).Sum
$noBackup = @($present | Where-Object { $_.Backup -ne 'yes' })

Write-Host ""
Write-Host ("=" * 78)
Write-Host "  Selected $($present.Count) of $($plan.Count) rows   $(Show-Size $total)"
Write-Host ("=" * 78)
$present | Sort-Object Bytes -Descending | Select-Object -First 30 | ForEach-Object {
    $flag = if ($_.Backup -eq 'yes') { '[backup on D:]' } else { '[NO BACKUP]   ' }
    "  {0} {1} {2}" -f (Show-Size $_.Bytes), $flag, $_.Name
}
if ($present.Count -gt 30) { Write-Host "  ... and $($present.Count - 30) more" }

Write-Host ""
Write-Host "  $($noBackup.Count) of these have NO copy in the D: ISO staging tree" -ForegroundColor Yellow
Write-Host "  ($(Show-Size (($noBackup | Measure-Object Bytes -Sum).Sum))) - those must be re-downloaded if you want them back." -ForegroundColor Yellow
$missing = @($plan | Where-Object { -not $_.Exists })
if ($missing) {
    Write-Host "  $($missing.Count) listed path(s) are not on disk - already deleted, or the sheet is stale." -ForegroundColor DarkGray
    Write-Host "  (re-run build_csv.py to refresh the sheet)" -ForegroundColor DarkGray
}

if (-not $Execute) {
    Write-Host ""
    Write-Host "  DRY RUN - nothing was changed." -ForegroundColor Cyan
    Write-Host "  Re-run with -Execute to move these into $Quarantine (reversible)." -ForegroundColor Cyan
    Write-Host ""
    exit 0
}

if (Test-ComfyRunning) {
    Write-Host ""
    Write-Host "  ComfyUI is running on :8188 - stop it first, it holds model files open." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Moving to $Quarantine (a rename on the same volume: instant, reversible)." -ForegroundColor Yellow
Write-Host "  This does NOT free space yet - run -Purge once you have verified ComfyUI." -ForegroundColor Yellow
if ((Read-Host "  Type MOVE to continue") -ne 'MOVE') { Write-Host "Aborted."; exit 0 }

$moved = 0; $bytes = 0
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$records = foreach ($item in $present) {
    $rel = $item.Path.Substring($models.Length).TrimStart('\')
    $dest = Join-Path $Quarantine $rel
    New-Item -ItemType Directory -Force -LiteralPath (Split-Path $dest) | Out-Null
    try {
        Move-Item -LiteralPath $item.Path -Destination $dest -Force
        $moved++; $bytes += $item.Bytes
        [PSCustomObject]@{ when = $stamp; action = 'quarantine'; name = $item.Name
                           gb = [math]::Round($item.Bytes / 1GB, 2); from = $item.Path; ok = 'yes' }
    } catch {
        Write-Host "  FAILED $($item.Name): $_" -ForegroundColor Red
        [PSCustomObject]@{ when = $stamp; action = 'quarantine'; name = $item.Name
                           gb = [math]::Round($item.Bytes / 1GB, 2); from = $item.Path; ok = "no: $_" }
    }
}
$records | Export-Csv $log -Delimiter ';' -NoTypeInformation -Append -Encoding UTF8

Write-Host ""
Write-Host "  Quarantined $moved files, $(Show-Size $bytes). Log: $log" -ForegroundColor Green
Write-Host ""
Write-Host "  NEXT: start ComfyUI, run the workflows you care about, then either" -ForegroundColor Cyan
Write-Host "    .\prune-models.ps1 -Purge     (frees the space)" -ForegroundColor Cyan
Write-Host "    .\prune-models.ps1 -Restore   (puts everything back)" -ForegroundColor Cyan
Write-Host ""
