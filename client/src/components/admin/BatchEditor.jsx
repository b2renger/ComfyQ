import React, { useState, useEffect, useMemo, useRef, useCallback, useId } from 'react';
import {
    Plus, Upload, Download, FilePlus2, Trash2, Copy, ChevronDown, ChevronRight, ArrowUp, ArrowDown,
    AlertTriangle, XCircle, CheckCircle2, Loader2, ListOrdered, RefreshCw, Play, FlaskConical, Save,
} from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { SERVER_URL } from '../../utils/api';
import {
    tableFromCsv, csvFromRows, parseRef, formatRef, sourceRows, freeId, newUid,
} from '../../utils/batchTable';

// BatchEditor — make or change a batch table without a spreadsheet.
//
// The table stays the format (docs/batch-format.md): this reads a .csv, edits
// it as rows, and writes the same .csv back. Every change is checked by the
// server's own planner (/storyboard/preview), so a problem is marked on the
// field it is about with the message an upload would give, and the run order
// shown is the one the queue will follow. Queueing sends the same table to the
// same route as an upload.

const FIELD = 'w-full px-2.5 py-1.5 rounded-lg bg-background border text-sm text-foreground focus:outline-none focus:border-primary';
const fieldCls = (bad) => `${FIELD} ${bad ? 'border-danger' : 'border-border'}`;
const DRAFT_KEY = 'comfyq.batchEditor.draft';
const KIND_LABEL = { image: 'picture', video: 'video', audio: 'sound', model3d: '3D model' };

function fmtDuration(sec) {
    if (!sec || sec < 0) return '—';
    if (sec < 90) return `${Math.round(sec)} s`;
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function readDraft() {
    try {
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (d && Array.isArray(d.rows)) return { name: String(d.name || 'batch'), rows: d.rows.filter(r => r && r.uid && r.cells), suite: typeof d.suite === 'string' ? d.suite : null };
    } catch { /* no storage, or a draft from another version */ }
    return null;
}

// A text box that keeps what is typed and commits it on leaving the box, on
// Enter, or when it matches one of `options` (a pick from its list). A cell
// rebuilt from the parsed value on every key press loses what parsing drops:
// a "|" being typed, a space at the end of "Capture d'".
const DraftInput = ({ value, onCommit, options, ...props }) => {
    const [draft, setDraft] = useState(value);
    useEffect(() => { setDraft(value); }, [value]);
    const commit = (v) => { if (v !== value) onCommit(v); };
    return (
        <input {...props} value={draft}
            onChange={e => { setDraft(e.target.value); if (options?.includes(e.target.value)) commit(e.target.value); }}
            onBlur={() => commit(draft)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(draft); } }} />
    );
};

// ---- one input of a row ---------------------------------------------------

const InputPicker = ({ input, value, rows, cards, selfUid, assets, onChange, problem }) => {
    const listId = useId();
    const ref = parseRef(value);
    const kind = input.kind;
    const fromRows = sourceRows(rows, cards, selfUid, kind);
    const files = (assets?.files || []).filter(f => f.kind === kind);
    const folders = (assets?.folders || []).filter(f => (f.counts?.[kind] || 0) > 0);
    const cardOf = (id) => cards.find(c => c.id === id);
    const setType = (type) => {
        if (type === 'none') onChange('');
        else if (type === 'empty') onChange('empty');
        else if (type === 'row') onChange(fromRows[0]?.cells.id || '');
        else if (type === 'file') onChange(files[0] ? `file:${files[0].path}` : 'file:');
        else if (type === 'folder') onChange(folders[0] ? `folder:${folders[0].path}/` : 'folder:');
        else if (type === 'job') onChange('job:');
    };
    return (
        <div className="space-y-1">
            <label className="text-xs text-muted flex items-center gap-1.5">
                {input.label}
                <span className="text-muted/60">· {input.column}{input.required ? '' : ' · optional'}</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
                <select className={`${fieldCls(problem)} w-auto`} value={ref.type === 'raw' ? 'raw' : ref.type}
                    onChange={e => setType(e.target.value)}>
                    <option value="none">{input.required ? '— choose —' : 'Not set'}</option>
                    {!input.required && <option value="empty">Empty, on purpose</option>}
                    <option value="row">Result of another row</option>
                    <option value="file">A file from the assets folder</option>
                    <option value="folder">Every file of a folder</option>
                    <option value="job">An earlier job</option>
                    {ref.type === 'raw' && <option value="raw">As typed</option>}
                </select>
                {ref.type === 'row' && (
                    <>
                        <select className={`${fieldCls(problem)} flex-1 min-w-[10rem]`} value={ref.row}
                            onChange={e => onChange(formatRef({ ...ref, row: e.target.value }))}>
                            {!fromRows.some(r => r.cells.id === ref.row) && <option value={ref.row}>{ref.row || '— no row makes one yet —'}</option>}
                            {fromRows.map(r => (
                                <option key={r.uid} value={r.cells.id}>
                                    {r.cells.id} — {cardOf(r.cells.workflow)?.title || r.cells.workflow}
                                </option>
                            ))}
                        </select>
                        <label className="flex items-center gap-1 text-xs text-muted">
                            output
                            <input type="number" min={1} className={`${fieldCls(false)} w-16`} value={ref.output || 1}
                                onChange={e => onChange(formatRef({ ...ref, output: Math.max(1, Number(e.target.value) || 1) }))} />
                        </label>
                        {ref.copy && <span className="text-xs text-muted self-center">copy {ref.copy}</span>}
                    </>
                )}
                {ref.type === 'file' && (
                    <>
                        <DraftInput className={`${fieldCls(problem)} flex-1 min-w-[12rem]`} list={listId} value={ref.path || ''}
                            options={files.map(f => f.path)}
                            placeholder={`a ${KIND_LABEL[kind] || kind} in the assets folder`}
                            onCommit={v => onChange(formatRef({ ...ref, path: v.trim() }))} />
                        <datalist id={listId}>{files.map(f => <option key={f.path} value={f.path} />)}</datalist>
                    </>
                )}
                {ref.type === 'folder' && (
                    <select className={`${fieldCls(problem)} flex-1 min-w-[12rem]`} value={ref.path || ''}
                        onChange={e => onChange(`folder:${e.target.value}/`)}>
                        {!folders.some(f => f.path === ref.path) && <option value={ref.path || ''}>{ref.path || '— choose a folder —'}</option>}
                        {folders.map(f => <option key={f.path} value={f.path}>{f.path} ({f.counts[kind]} {KIND_LABEL[kind] || kind}{f.counts[kind] === 1 ? '' : 's'})</option>)}
                    </select>
                )}
                {ref.type === 'job' && (
                    <DraftInput className={`${fieldCls(problem)} flex-1 min-w-[12rem] font-mono`} value={ref.job || ''}
                        placeholder="job id, or its first 8 characters"
                        onCommit={v => onChange(formatRef({ ...ref, job: v.trim() }))} />
                )}
                {ref.type === 'raw' && (
                    <DraftInput className={`${fieldCls(problem)} flex-1 min-w-[12rem] font-mono`} value={ref.raw}
                        onCommit={v => onChange(v)} />
                )}
            </div>
            {(ref.type === 'file' || ref.type === 'folder') && (
                <DraftInput className={`${fieldCls(problem)} font-mono text-xs`} value={ref.steps || ''}
                    placeholder="Steps, if any: scale(0.5) | jpeg(40) — or frame(0) | crop(0, 0.16, 1, 0.91) on a video"
                    onCommit={v => onChange(formatRef({ ...ref, steps: v.trim() }))} />
            )}
            {ref.type === 'none' && !input.required && (
                <p className="text-xs text-muted">Not set: in a batch the input stays empty; the test suite picks a file for it. "Empty, on purpose" leaves it empty in both.</p>
            )}
            {ref.type === 'row' && !fromRows.length && (
                <p className="text-xs text-muted">No row makes a {KIND_LABEL[kind] || kind} yet: add one, then pick it here. It does not have to be above.</p>
            )}
            {ref.type === 'folder' && <p className="text-xs text-muted">One job per file, in name order.</p>}
            {problem && <p className="text-xs text-danger">{problem}</p>}
        </div>
    );
};

// ---- one setting of a row --------------------------------------------------

const SettingField = ({ setting, value, onChange, onRemove, problem }) => {
    const def = setting.default === null || setting.default === undefined || setting.default === '' ? '' : String(setting.default);
    let control;
    if ((setting.type === 'select' || setting.type === 'lora') && Array.isArray(setting.options) && setting.options.length) {
        control = (
            <select className={fieldCls(problem)} value={value} onChange={e => onChange(e.target.value)}>
                {!setting.options.includes(value) && <option value={value}>{value || `default (${def || 'none'})`}</option>}
                {setting.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
        );
    } else if (setting.type === 'checkbox') {
        control = (
            <select className={fieldCls(problem)} value={value} onChange={e => onChange(e.target.value)}>
                <option value="">{`default (${def === 'true' ? 'yes' : 'no'})`}</option>
                <option value="true">yes</option>
                <option value="false">no</option>
            </select>
        );
    } else if (setting.type === 'number') {
        control = (
            <input type="number" className={fieldCls(problem)} value={value} placeholder={def}
                min={setting.min ?? undefined} max={setting.max ?? undefined} step={setting.step ?? 'any'}
                onChange={e => onChange(e.target.value)} />
        );
    } else if (setting.type === 'textarea') {
        control = <textarea rows={2} className={`${fieldCls(problem)} resize-y`} value={value} placeholder={def.slice(0, 200)} onChange={e => onChange(e.target.value)} />;
    } else {
        control = <input className={fieldCls(problem)} value={value} placeholder={def.slice(0, 120)} onChange={e => onChange(e.target.value)} />;
    }
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <label className="text-xs text-muted flex-1 truncate" title={setting.key}>
                    {setting.label}
                    {setting.type === 'number' && setting.min !== null && setting.max !== null && <span className="text-muted/60"> · {setting.min}–{setting.max}</span>}
                </label>
                <button type="button" className="text-muted hover:text-danger" title="Back to the card's default" onClick={onRemove}>
                    <XCircle size={13} />
                </button>
            </div>
            {control}
            {problem && <p className="text-xs text-danger">{problem}</p>}
        </div>
    );
};

// ---- one row ---------------------------------------------------------------

// Columns a row may hold whatever its card: everything else must be the card's.
const ROW_COLUMNS = new Set(['id', 'workflow', 'prompt', 'negative', 'repeat', 'seed', 'notes', 'stage', 'caption', 'keepRuntime']);

const RowItem = ({ row, index, count, rows, cards, cardById, assets, problems, cautions, jobs, blocked, open, suite, onToggle, onCells, onRemove, onDuplicate, onMove }) => {
    const card = cardById.get(row.cells.workflow);
    const c = row.cells;
    const problemAt = (column) => problems.filter(p => p.column === column).map(p => p.message).join(' ') || null;
    const set = (column, value) => onCells(row.uid, { [column]: value });
    const setSettings = card?.settings.filter(s => c[s.key] !== undefined) || [];
    const unsetSettings = card?.settings.filter(s => c[s.key] === undefined) || [];
    const known = new Set([...ROW_COLUMNS, ...(card?.inputs.map(i => i.column) || []), ...(card?.settings.map(s => s.key) || [])]);
    const strays = Object.keys(c).filter(k => !known.has(k));
    const inputsLine = card?.inputs.filter(i => c[i.column]).map(i => `${i.column} ← ${c[i.column]}`).join(' · ');
    const rowProblems = problems.filter(p => !p.column || p.column === 'workflow' || p.column === 'id' || !known.has(p.column));
    const changeWorkflow = (id) => {
        const next = cardById.get(id);
        const keep = { id: c.id, workflow: id };
        for (const k of ['prompt', 'notes', 'repeat', 'stage', 'caption', 'keepRuntime']) if (c[k] !== undefined) keep[k] = c[k];
        if (next?.negative && c.negative !== undefined) keep.negative = c.negative;
        if (next?.seed && c.seed !== undefined) keep.seed = c.seed;
        for (const i of next?.inputs || []) if (c[i.column] !== undefined) keep[i.column] = c[i.column];
        for (const s of next?.settings || []) if (c[s.key] !== undefined) keep[s.key] = c[s.key];
        onCells(row.uid, keep, true);
    };
    const groups = useMemo(() => {
        const g = new Map();
        for (const k of cards) {
            const cat = k.category || 'other';
            if (!g.has(cat)) g.set(cat, []);
            g.get(cat).push(k);
        }
        return [...g.entries()];
    }, [cards]);

    return (
        <div className={`border rounded-lg ${problems.length ? 'border-danger/50' : 'border-border'} bg-surface/40`}>
            <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" onClick={() => onToggle(row.uid)}>
                {open ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
                <span className="text-xs text-muted tabular-nums w-5 shrink-0">{index + 1}</span>
                <span className="text-sm font-medium shrink-0">{c.id || <em className="text-muted">no id</em>}</span>
                <span className="text-xs text-muted truncate">
                    {card ? card.title : c.workflow ? <span className="text-danger">{c.workflow}</span> : 'no workflow yet'}
                    {c.prompt ? ` · ${c.prompt.slice(0, 70)}${c.prompt.length > 70 ? '…' : ''}` : ''}
                    {inputsLine ? ` · ${inputsLine}` : ''}
                </span>
                <span className="ml-auto flex items-center gap-2 shrink-0">
                    {jobs > 1 && <Badge>{jobs} jobs</Badge>}
                    {blocked && <span className="text-xs text-danger" title={`Waits on ${blocked.join(', ')}, which has a problem`}>waits on {blocked.join(', ')}</span>}
                    {problems.length > 0 && <span className="text-xs text-danger flex items-center gap-1"><XCircle size={13} />{problems.length}</span>}
                    {!problems.length && cautions.length > 0 && <span title={cautions.map(p => p.message).join('\n')}><AlertTriangle size={13} className="text-warning" /></span>}
                </span>
            </div>

            {open && (
                <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/60">
                    <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-2">
                        <div className="space-y-1">
                            <label className="text-xs text-muted">Id (how other rows name it)</label>
                            <input className={fieldCls(problemAt('id'))} value={c.id || ''} onChange={e => set('id', e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-muted">Workflow</label>
                            <select className={fieldCls(problemAt('workflow'))} value={card ? card.id : (c.workflow || '')} onChange={e => changeWorkflow(e.target.value)}>
                                {!card && <option value={c.workflow || ''}>{c.workflow ? `${c.workflow} (not a card here)` : '— choose a card —'}</option>}
                                {groups.map(([cat, list]) => (
                                    <optgroup key={cat} label={cat}>
                                        {list.map(k => <option key={k.id} value={k.id}>{k.title}{k.experimental ? ' (experimental)' : ''}</option>)}
                                    </optgroup>
                                ))}
                            </select>
                        </div>
                    </div>
                    {rowProblems.map((p, i) => <p key={i} className="text-xs text-danger">{p.message}</p>)}

                    {(suite || c.stage !== undefined || c.caption !== undefined || c.keepRuntime !== undefined) && (
                        <div className="grid grid-cols-1 sm:grid-cols-[14rem_1fr_7rem] gap-2 p-2 rounded-lg bg-background/40 border border-border/60">
                            <div className="space-y-1">
                                <label className="text-xs text-muted">Stage <span className="text-muted/60">· carried to the rows below</span></label>
                                <input className={fieldCls(problemAt('stage'))} value={c.stage || ''} onChange={e => set('stage', e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-muted">Caption <span className="text-muted/60">· shown with the example</span></label>
                                <textarea rows={2} className={`${fieldCls(problemAt('caption'))} resize-y`} value={c.caption || ''} onChange={e => set('caption', e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-muted" title="Leave this card's timings as they are">Keep timings</label>
                                <select className={fieldCls(problemAt('keepRuntime'))} value={/^(yes|true|1|x|oui)$/i.test(c.keepRuntime || '') ? 'yes' : ''}
                                    onChange={e => set('keepRuntime', e.target.value || undefined)}>
                                    <option value="">no</option>
                                    <option value="yes">yes</option>
                                </select>
                            </div>
                            {suite && c.id && c.workflow && c.id !== c.workflow && !c.id.startsWith(`${c.workflow}@`) && (
                                <p className="text-xs text-danger sm:col-span-3">In the test suite a row's id is its card ({c.workflow}), or {c.workflow}@something for a second run of it.</p>
                            )}
                        </div>
                    )}

                    {card?.prompt && (
                        <div className="space-y-1">
                            <label className="text-xs text-muted">Prompt <span className="text-muted/60">· or text:FILE.txt from the assets folder</span></label>
                            <textarea rows={3} className={`${fieldCls(problemAt('prompt'))} resize-y`} value={c.prompt || ''}
                                placeholder={String(card.prompt.default || '').slice(0, 300)} onChange={e => set('prompt', e.target.value)} />
                            {problemAt('prompt') && <p className="text-xs text-danger">{problemAt('prompt')}</p>}
                        </div>
                    )}
                    {card?.negative && (c.negative !== undefined ? (
                        <div className="space-y-1">
                            <label className="text-xs text-muted">Negative prompt</label>
                            <textarea rows={2} className={`${fieldCls(problemAt('negative'))} resize-y`} value={c.negative} onChange={e => set('negative', e.target.value)} />
                        </div>
                    ) : (
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => set('negative', String(card.negative.default || ''))}>+ Negative prompt</button>
                    ))}

                    {card?.inputs.length > 0 && (
                        <div className="space-y-2">
                            {card.inputs.map(input => (
                                <InputPicker key={input.column} input={input} value={c[input.column] || ''} rows={rows} cards={cards}
                                    selfUid={row.uid} assets={assets} problem={problemAt(input.column)}
                                    onChange={v => set(input.column, v)} />
                            ))}
                        </div>
                    )}

                    {card && (
                        <div className="space-y-2">
                            {setSettings.length > 0 && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {setSettings.map(s => (
                                        <SettingField key={s.key} setting={s} value={c[s.key] ?? ''} problem={problemAt(s.key)}
                                            onChange={v => set(s.key, v)} onRemove={() => onCells(row.uid, { [s.key]: undefined })} />
                                    ))}
                                </div>
                            )}
                            {unsetSettings.length > 0 && (
                                <select className={`${FIELD} border-border w-auto text-muted`} value=""
                                    onChange={e => { const s = card.settings.find(x => x.key === e.target.value); if (s) set(s.key, s.default === null || s.default === undefined ? '' : String(s.default)); }}>
                                    <option value="">+ Change a setting…</option>
                                    {unsetSettings.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                                </select>
                            )}
                        </div>
                    )}

                    {strays.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-xs text-warning">Columns this card does not have (from the file, or from the card this row had before):</p>
                            {strays.map(k => (
                                <div key={k} className="flex items-center gap-2 text-xs">
                                    <span className="font-mono">{k}</span><span className="text-muted truncate">{c[k]}</span>
                                    <button type="button" className="text-muted hover:text-danger" onClick={() => onCells(row.uid, { [k]: undefined })}><Trash2 size={12} /></button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-[6rem_10rem_1fr] gap-2">
                        <div className="space-y-1">
                            <label className="text-xs text-muted">Repeat</label>
                            <input type="number" min={1} max={100} className={fieldCls(problemAt('repeat'))} value={c.repeat || ''} placeholder="1" onChange={e => set('repeat', e.target.value)} />
                        </div>
                        {card?.seed && (
                            <div className="space-y-1">
                                <label className="text-xs text-muted">Seed <span className="text-muted/60">· empty: a new one</span></label>
                                <input type="number" min={0} className={fieldCls(problemAt('seed'))} value={c.seed || ''} onChange={e => set('seed', e.target.value)} />
                            </div>
                        )}
                        <div className="space-y-1 col-span-2 sm:col-span-1">
                            <label className="text-xs text-muted">Notes</label>
                            <input className={fieldCls(false)} value={c.notes || ''} onChange={e => set('notes', e.target.value)} />
                        </div>
                    </div>
                    {['repeat', 'seed'].map(k => problemAt(k) && <p key={k} className="text-xs text-danger">{problemAt(k)}</p>)}
                    {cautions.map((p, i) => <p key={i} className="text-xs text-warning">{p.message}</p>)}

                    <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="ghost" icon={ArrowUp} disabled={index === 0} onClick={() => onMove(row.uid, -1)}>Up</Button>
                        <Button size="sm" variant="ghost" icon={ArrowDown} disabled={index === count - 1} onClick={() => onMove(row.uid, 1)}>Down</Button>
                        <Button size="sm" variant="ghost" icon={Copy} onClick={() => onDuplicate(row.uid)}>Duplicate</Button>
                        <Button size="sm" variant="danger" icon={Trash2} onClick={() => onRemove(row.uid)}>Remove</Button>
                    </div>
                </div>
            )}
        </div>
    );
};

// ---- the editor --------------------------------------------------------------

const BatchEditor = ({ adminPassword, notify }) => {
    const draft = useMemo(readDraft, []);
    const [name, setName] = useState(draft?.name || 'batch');
    const [rows, setRows] = useState(draft?.rows || []);
    const [openUid, setOpenUid] = useState(null);
    const [cards, setCards] = useState([]);
    const [assets, setAssets] = useState(null);
    const [listsError, setListsError] = useState(null);
    const [preview, setPreview] = useState(null);
    const [checking, setChecking] = useState(false);
    const [checkError, setCheckError] = useState(null);
    const [showOrder, setShowOrder] = useState(false);
    // The server orders a batch for the fewest model loads (server/batch/runOrder.js);
    // ticked, the table's own order is kept, each row moved only below the rows it uses.
    const [keepOrder, setKeepOrder] = useState(false);
    const orderMode = keepOrder ? 'written' : 'fewest-loads';
    const [queueing, setQueueing] = useState(false);
    const [confirmNew, setConfirmNew] = useState(false);
    // The test suite this table is (its name), when it was opened with Open the test suite:
    // it is then saved back to tools/test-suite and run by the library sweep, not queued.
    const [suite, setSuite] = useState(draft?.suite || null);
    const [suiteBusy, setSuiteBusy] = useState(null);
    const [confirmRun, setConfirmRun] = useState(false);
    const fileRef = useRef(null);
    const queueingRef = useRef(false);

    const authHeaders = useCallback(() => (adminPassword ? { 'X-Admin-Password': adminPassword } : {}), [adminPassword]);
    const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);

    const loadLists = useCallback(async () => {
        setListsError(null);
        try {
            const [c, a] = await Promise.all([
                fetch(`${SERVER_URL}/storyboard/cards`, { headers: authHeaders() }),
                fetch(`${SERVER_URL}/storyboard/assets`, { headers: authHeaders() }),
            ]);
            if (!c.ok) throw new Error(c.status === 401 ? 'The admin password is needed to list the cards.' : `The card list did not load (${c.status}).`);
            setCards((await c.json()).cards || []);
            if (a.ok) setAssets(await a.json());
        } catch (e) { setListsError(e.message); }
    }, [authHeaders]);
    useEffect(() => { loadLists(); }, [loadLists]);

    // Keep the draft, so a reload or a server restart does not lose the work.
    useEffect(() => {
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ name, rows, suite })); } catch { /* storage off */ }
    }, [name, rows, suite]);

    const csv = useMemo(() => csvFromRows(rows), [rows]);

    // Check the table with the server's planner a moment after each change.
    useEffect(() => {
        if (!rows.length) { setPreview(null); setCheckError(null); return undefined; }
        const ctrl = new AbortController();
        const t = setTimeout(async () => {
            setChecking(true);
            try {
                const res = await fetch(`${SERVER_URL}/storyboard/preview`, {
                    method: 'POST', signal: ctrl.signal,
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table: csv, name: `${name || 'batch'}.csv`, order: orderMode }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `The check failed (${res.status}).`);
                setPreview(data);
                setCheckError(null);
            } catch (e) {
                if (e.name !== 'AbortError') setCheckError(e.message);
            } finally {
                if (!ctrl.signal.aborted) setChecking(false);
            }
        }, 600);
        return () => { clearTimeout(t); ctrl.abort(); };
    }, [csv, name, rows.length, authHeaders, orderMode]);

    // The table's row N (the header is row 1) is the editor's row N - 2.
    const at = useCallback((list) => {
        const by = new Map();
        for (const p of list || []) {
            if (!p.row) continue;
            const uid = rows[p.row - 2]?.uid;
            if (!uid) continue;
            if (!by.has(uid)) by.set(uid, []);
            by.get(uid).push(p);
        }
        return by;
    }, [rows]);
    const problemsBy = useMemo(() => at(preview?.problems), [at, preview]);
    const cautionsBy = useMemo(() => at(preview?.cautions), [at, preview]);
    const blockedBy = useMemo(() => new Map((preview?.blocked || []).map(b => [rows[b.row - 2]?.uid, b.waitsOn])), [preview, rows]);
    const jobsBy = useMemo(() => {
        const m = new Map();
        for (const j of preview?.jobs || []) { const uid = rows[j.row - 2]?.uid; if (uid) m.set(uid, (m.get(uid) || 0) + 1); }
        return m;
    }, [preview, rows]);
    const tableProblems = (preview?.problems || []).filter(p => !p.row || !rows[p.row - 2]);

    // ---- row operations
    // `replace`: the patch is the row's whole set of cells (a change of card).
    const onCells = useCallback((uid, patch, replace = false) => {
        setRows(rs => rs.map(r => {
            if (r.uid !== uid) return r;
            const cells = replace ? { ...patch } : { ...r.cells, ...patch };
            for (const k of Object.keys(cells)) if (cells[k] === undefined) delete cells[k];
            return { ...r, cells };
        }));
    }, []);
    // A renamed row: every input cell that named it follows.
    const renameRefs = useCallback((uid, oldId, newId) => {
        if (!oldId || !newId || oldId === newId) return;
        setRows(rs => rs.map(r => {
            if (r.uid === uid) return r;
            let changed = false;
            const cells = { ...r.cells };
            for (const [k, v] of Object.entries(cells)) {
                const ref = parseRef(v);
                if (ref.type === 'row' && ref.row === oldId && /^(image|mask|video|audio|model3d)\d*$/.test(k)) {
                    cells[k] = formatRef({ ...ref, row: newId });
                    changed = true;
                }
            }
            return changed ? { ...r, cells } : r;
        }));
    }, []);
    const setCellsWithRename = useCallback((uid, patch, replace) => {
        if (patch.id !== undefined) {
            const old = rows.find(r => r.uid === uid)?.cells.id;
            renameRefs(uid, old, patch.id);
        }
        onCells(uid, patch, replace);
    }, [rows, onCells, renameRefs]);

    const addRow = () => {
        const last = rows[rows.length - 1];
        const row = { uid: newUid(), cells: { id: freeId(rows), workflow: last?.cells.workflow || '' } };
        setRows(rs => [...rs, row]);
        setOpenUid(row.uid);
    };
    const removeRow = (uid) => setRows(rs => rs.filter(r => r.uid !== uid));
    const duplicateRow = (uid) => setRows(rs => {
        const i = rs.findIndex(r => r.uid === uid);
        const copy = { uid: newUid(), cells: { ...rs[i].cells, id: freeId(rs, rs[i].cells.id || 'row') } };
        const next = [...rs];
        next.splice(i + 1, 0, copy);
        return next;
    });
    const moveRow = (uid, step) => setRows(rs => {
        const i = rs.findIndex(r => r.uid === uid);
        const j = i + step;
        if (i < 0 || j < 0 || j >= rs.length) return rs;
        const next = [...rs];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
    });
    const toggle = (uid) => setOpenUid(u => (u === uid ? null : uid));

    // ---- files
    const importFile = async (f) => {
        if (!f) return;
        try {
            const { rows: imported, skipped } = tableFromCsv(await f.text());
            setRows(imported);
            setName(f.name.replace(/\.[^.]+$/, '') || 'batch');
            setSuite(null);
            setOpenUid(null);
            notify?.(`Opened ${f.name}: ${imported.length} row${imported.length === 1 ? '' : 's'}${skipped ? `, ${skipped} comment row${skipped === 1 ? '' : 's'} left out` : ''}.`);
        } catch (e) {
            notify?.(`Could not read ${f.name}: ${e.message}`, 'err');
        } finally {
            if (fileRef.current) fileRef.current.value = '';
        }
    };
    const exportFile = () => {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name || 'batch'}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const newBatch = () => {
        setConfirmNew(false);
        setRows([]);
        setName('batch');
        setSuite(null);
        setPreview(null);
        setOpenUid(null);
    };

    // ---- the test suite (tools/test-suite/library.suite.csv): opened, saved and
    // run from here, with no file to load. It runs through the library sweep,
    // which times every card and makes the examples, not through the queue.
    const SUITE = 'library';
    const [savedCsv, setSavedCsv] = useState(null);
    const openSuite = async () => {
        setConfirmNew(false);
        setSuiteBusy('open');
        try {
            const res = await fetch(`${SERVER_URL}/storyboard/suite/${SUITE}`, { headers: authHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'The test suite did not open.');
            const { rows: loaded } = tableFromCsv(data.table);
            setRows(loaded);
            setName(`${SUITE}.suite`);
            setSuite(SUITE);
            setSavedCsv(csvFromRows(loaded));
            setOpenUid(null);
            notify?.(`Opened the test suite: ${loaded.length} runs (${data.file}).`);
        } catch (e) { notify?.(e.message, 'err'); }
        finally { setSuiteBusy(null); }
    };
    // Replacing rows that are there asks first: confirmNew holds what comes next.
    const replaceRows = (action) => {
        if (rows.length && confirmNew !== action) { setConfirmNew(action); return; }
        if (action === 'suite') openSuite(); else newBatch();
    };
    const saveSuite = async () => {
        setSuiteBusy('save');
        try {
            const res = await fetch(`${SERVER_URL}/storyboard/suite/${suite}`, {
                method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ table: csv }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error([data.error, ...(data.errors || []).slice(0, 5)].join(' '));
            setSavedCsv(csv);
            notify?.(`Saved the test suite: ${data.runs} runs. Commit tools/test-suite/${suite}.suite.csv to keep it.`);
        } catch (e) { notify?.(e.message, 'err'); }
        finally { setSuiteBusy(null); }
    };
    // Runs the SAVED suite, so it is offered only when there is nothing unsaved.
    const runSuite = async () => {
        if (!confirmRun) { setConfirmRun(true); return; }
        setConfirmRun(false);
        setSuiteBusy('run');
        try {
            const res = await fetch(`${SERVER_URL}/admin/library-sweep/run`, {
                method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ suite }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error([data.error, ...(data.errors || []).slice(0, 5)].join(' '));
            notify?.(`The test suite is running: ${data.total ?? rows.length} runs. Follow it under Maintenance → Run the whole library.`);
        } catch (e) { notify?.(e.message, 'err'); }
        finally { setSuiteBusy(null); }
    };
    // Unknown counts as unsaved: after a reload the draft is not known to be on disk.
    const suiteUnsaved = !!suite && csv !== savedCsv;

    const queue = async () => {
        if (queueingRef.current) return;
        queueingRef.current = true;
        setQueueing(true);
        try {
            const res = await fetch(`${SERVER_URL}/storyboard/queue`, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ table: csv, name: `${name || 'batch'}.csv`, folder: name || 'batch', order: orderMode }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'The batch was not queued.');
            notify?.(data.restarting
                ? `Queued ${data.totalJobs} jobs. Starting the queue on ${data.startingWorkflowId}; the server restarts for a few seconds.`
                : `Queued ${data.totalJobs} jobs. Progress is in the list below.`);
        } catch (e) {
            notify?.(e.message, 'err');
        } finally {
            queueingRef.current = false;
            setQueueing(false);
        }
    };

    const problemCount = (preview?.problems?.length || 0) + (preview?.blocked?.length || 0);
    const canQueue = rows.length > 0 && preview && !checking && !checkError && problemCount === 0 && preview.totalJobs > 0;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <input className={`${FIELD} border-border w-48`} value={name} title="The file name, and the output folder"
                    onChange={e => setName(e.target.value.replace(/[\\/:*?"<>|]/g, ''))} />
                <Button size="sm" variant="secondary" icon={FilePlus2} onClick={() => replaceRows('new')}>
                    {confirmNew === 'new' ? 'Discard these rows?' : 'New batch'}
                </Button>
                <Button size="sm" variant="secondary" icon={FlaskConical} isLoading={suiteBusy === 'open'} onClick={() => replaceRows('suite')}>
                    {confirmNew === 'suite' ? 'Replace these rows with the test suite?' : 'Open the test suite'}
                </Button>
                {confirmNew && <Button size="sm" variant="ghost" onClick={() => setConfirmNew(false)}>Keep them</Button>}
                <Button size="sm" variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>Import .csv</Button>
                <input ref={fileRef} type="file" accept=".csv,.tsv,text/csv" className="hidden" onChange={e => importFile(e.target.files?.[0])} />
                <Button size="sm" variant="secondary" icon={Download} disabled={!rows.length} onClick={exportFile}>Export .csv</Button>
                <Button size="sm" variant="ghost" icon={RefreshCw} onClick={loadLists} title="Reload the cards and the assets folder">Refresh lists</Button>
            </div>
            {listsError && <p className="text-xs text-danger">{listsError}</p>}
            {assets?.truncated && <p className="text-xs text-warning">The assets folder has more files than the picker lists; type a path to use one it leaves out.</p>}

            <div className="space-y-2">
                {rows.map((row, i) => (
                    <RowItem key={row.uid} row={row} index={i} count={rows.length} rows={rows} cards={cards} cardById={cardById}
                        assets={assets} problems={problemsBy.get(row.uid) || []} cautions={cautionsBy.get(row.uid) || []}
                        jobs={jobsBy.get(row.uid) || 0} blocked={blockedBy.get(row.uid)}
                        open={openUid === row.uid} suite={!!suite} onToggle={toggle} onCells={setCellsWithRename}
                        onRemove={removeRow} onDuplicate={duplicateRow} onMove={moveRow} />
                ))}
                {!rows.length && (
                    <p className="text-sm text-muted">
                        No rows yet. Add one per job: for example a picture from words, then a video made from that
                        picture, by picking the first row as the second row's input.
                    </p>
                )}
                <Button size="sm" variant="secondary" icon={Plus} onClick={addRow} disabled={!cards.length}>Add a row</Button>
            </div>

            {rows.length > 0 && (
                <div className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        {checking ? (
                            <span className="flex items-center gap-1.5 text-muted"><Loader2 size={14} className="animate-spin" /> Checking…</span>
                        ) : checkError ? (
                            <span className="flex items-center gap-1.5 text-danger"><XCircle size={14} /> {checkError}</span>
                        ) : problemCount ? (
                            <span className="flex items-center gap-1.5 text-danger"><XCircle size={14} /> {preview.summary}</span>
                        ) : preview ? (
                            <span className="flex items-center gap-1.5 text-success">
                                <CheckCircle2 size={14} />
                                {preview.totalJobs} job{preview.totalJobs === 1 ? '' : 's'}, {preview.modelLoads} model load{preview.modelLoads === 1 ? '' : 's'}
                                {preview.restarts > 0 && <>, {preview.restarts} ComfyUI restart{preview.restarts === 1 ? '' : 's'}</>}, about {fmtDuration(preview.totalEstimatedSec)}
                            </span>
                        ) : null}
                        {!suite && rows.length > 1 && (
                            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer"
                                title="Unticked, the batch runs in the order that loads models the fewest times its inputs allow. Ticked, it runs in the table's order, each row only moved below the rows it uses.">
                                <input type="checkbox" checked={keepOrder} onChange={e => setKeepOrder(e.target.checked)} />
                                Keep the table&apos;s order
                            </label>
                        )}
                        {preview?.jobs?.length > 0 && (
                            <button type="button" className="ml-auto text-xs text-muted hover:text-foreground flex items-center gap-1" onClick={() => setShowOrder(s => !s)}>
                                <ListOrdered size={13} /> {showOrder ? 'Hide' : 'Show'} the run order
                            </button>
                        )}
                    </div>
                    {!suite && !problemCount && preview?.ordering?.changed && (
                        <p className="text-xs text-muted">
                            Reordered so models load {preview.modelLoads} time{preview.modelLoads === 1 ? '' : 's'} instead
                            of {preview.ordering.written.loads}
                            {preview.ordering.written.restarts !== preview.restarts && <> and ComfyUI restarts {preview.restarts} time{preview.restarts === 1 ? '' : 's'} instead of {preview.ordering.written.restarts}</>}
                            {preview.ordering.savedSec > 0 && <>: about {fmtDuration(preview.ordering.savedSec)} less</>}.
                            {' '}Every job still runs after the jobs whose results it uses.
                        </p>
                    )}
                    {tableProblems.map((p, i) => <p key={i} className="text-xs text-danger">{p.message}</p>)}
                    {(preview?.warnings || []).filter(w => !/^Row \d+/.test(w)).map((w, i) => (
                        <p key={i} className="text-xs text-warning flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{w}</p>
                    ))}
                    {showOrder && preview?.jobs?.length > 0 && (
                        <ol className="text-xs space-y-0.5 max-h-72 overflow-y-auto">
                            {preview.jobs.map(j => (
                                <li key={j.order} className="flex gap-2">
                                    <span className="text-muted tabular-nums w-6 shrink-0 text-right">{j.order + 1}</span>
                                    <span className="font-medium">{j.title}</span>
                                    <span className="text-muted truncate">{cardById.get(j.workflowId)?.title || j.workflowId}</span>
                                    {j.deps?.length > 0 && <span className="text-muted truncate">· after {j.deps.map(d => d.sourceTitle).join(', ')}</span>}
                                    {j.setup && (
                                        <span className={`shrink-0 ${j.setup === 'restart' ? 'text-warning' : 'text-muted'}`}
                                            title={j.setup === 'restart'
                                                ? 'This card runs with other speed-up flags, so ComfyUI restarts (about a minute) before its models load.'
                                                : 'The models of the job before are unloaded and this card loads its own.'}>
                                            · {j.setup === 'restart' ? 'restarts ComfyUI, loads' : 'loads'} {j.setupSec ? fmtDuration(j.setupSec) : ''}
                                        </span>
                                    )}
                                    <span className="ml-auto text-muted shrink-0">{fmtDuration(j.estimatedDurationSec)}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                    {suite ? (
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                            <Button size="sm" variant="secondary" icon={Save} isLoading={suiteBusy === 'save'}
                                disabled={!suiteUnsaved || checking || problemCount > 0} onClick={saveSuite}
                                title={problemCount ? 'Fix the problems first' : suiteUnsaved ? '' : 'Nothing to save'}>
                                {suiteUnsaved ? 'Save to the test suite' : 'Saved'}
                            </Button>
                            <Button size="sm" icon={Play} isLoading={suiteBusy === 'run'} disabled={suiteUnsaved || problemCount > 0 || !rows.length}
                                onClick={runSuite} title={suiteUnsaved ? 'Save first: the run reads the saved suite' : ''}>
                                {confirmRun ? `Start all ${rows.length} runs (about 4 h)?` : 'Run the test suite'}
                            </Button>
                            {confirmRun && <Button size="sm" variant="ghost" onClick={() => setConfirmRun(false)}>Not now</Button>}
                            <span className="text-xs text-muted">
                                The test suite (<span className="text-foreground">tools/test-suite/{suite}.suite.csv</span>) runs
                                through the library sweep in admin mode: every card is timed and its row becomes its example.
                                Its progress is under Maintenance.
                            </span>
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                            <Button size="sm" icon={Play} isLoading={queueing} disabled={!canQueue} onClick={queue}>
                                {preview?.totalJobs ? `Queue ${preview.totalJobs} job${preview.totalJobs === 1 ? '' : 's'}` : 'Queue'}
                            </Button>
                            <span className="text-xs text-muted">
                                One job at a time on the main lane, after the jobs already booked. Results go to the
                                output folder <span className="text-foreground">{name || 'batch'}</span>.
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default BatchEditor;
export { RowItem, InputPicker, SettingField };
