import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { SocketProvider, useSocket } from './context/SocketContext';
import SchedulerPage from './pages/Scheduler';
import DashboardPage from './pages/Dashboard';
import AdminConfig from './pages/AdminConfig';
import { LayoutDashboard, Calendar, Settings, WifiOff, Wand2, X, RotateCw, Moon, Play } from 'lucide-react';
import UsernameModal from './components/UsernameModal';
import AccessGate from './components/AccessGate';
import ThemeToggle from './components/ui/ThemeToggle';
import { SERVER_URL } from './utils/api';
import { accessHeaders, clearAccessToken } from './utils/access';
import { Link, useLocation } from 'react-router-dom';

/**
 * StudentLayout Component
 * 
 * Provides the main layout structure for student/user views.
 * Includes the navigation bar, username modal, and a consistent background.
 * Uses <Outlet> to render child routes (Scheduler, Dashboard).
 */
/**
 * Says so when the websocket has dropped. Without it the page keeps showing the
 * last state it received, which looks like a frozen queue rather than a lost
 * connection. socket.io reconnects on its own; bookings are refused meanwhile
 * (rather than queued) so a retry can't book twice.
 */
const ConnectionBanner = () => {
  const { connection } = useSocket();
  if (connection !== 'reconnecting') return null;
  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-500/15 border-b border-amber-500/30 text-amber-500 text-xs font-medium">
      <WifiOff size={13} className="shrink-0" />
      Connection lost — reconnecting. What you see may be out of date, and booking is paused until it comes back.
    </div>
  );
};

/**
 * Announces that the machine switched to another workflow. A tab left open
 * across a switch holds a form built for the previous workflow, so without this
 * the only hint was that booking behaved oddly — students had to reload.
 * The forms rebuild themselves; this says why they changed.
 */
const WorkflowSwitchBanner = () => {
  const { workflowChange, dismissWorkflowChange } = useSocket();
  if (!workflowChange) return null;
  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-primary/15 border-b border-primary/30 text-xs font-medium text-foreground">
      <Wand2 size={13} className="text-primary shrink-0" />
      <span className="flex-1">
        {workflowChange.id
          ? <>This machine now serves <strong>{workflowChange.name}</strong>. Your booking form has been updated to its settings — anything you had typed for the previous workflow is gone.</>
          : <>This machine stopped serving a workflow. Booking is paused until an admin starts one.</>}
      </span>
      <button
        onClick={() => window.location.reload()}
        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-primary/40 bg-primary/10 hover:bg-primary/20 text-foreground"
        title="Reload the page for a clean form"
      >
        <RotateCw size={12} /> Reload
      </button>
      <button
        onClick={dismissWorkflowChange}
        className="p-1 rounded text-muted hover:text-foreground hover:bg-white/5 shrink-0"
        title="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
};

/**
 * Counts down to this tab parking itself. Only shown to someone who is looking
 * at it — any click, key or scroll cancels it (see SocketContext).
 */
const IdleWarningBanner = () => {
  const { parkWarning } = useSocket();
  if (!parkWarning) return null;
  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-500/15 border-b border-amber-500/30 text-amber-500 text-xs font-medium">
      <Moon size={13} className="shrink-0" />
      This tab has been idle and nothing of yours is queued — it will pause in {parkWarning}s. Move the mouse or press a key to keep it.
    </div>
  );
};

/**
 * What a parked tab shows instead of the app. The point is that everything
 * heavy is unmounted: no socket, no job grid, no videos or 3D contexts. A
 * machine can be left with a dozen forgotten tabs and pay for none of them.
 */
const ParkedScreen = () => {
  const { resumeSession } = useSocket();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-surface border border-border flex items-center justify-center text-muted">
        <Moon size={26} />
      </div>
      <div className="space-y-1.5 max-w-md">
        <h2 className="text-lg font-bold tracking-tight">Tab paused</h2>
        <p className="text-sm text-muted">
          Nothing of yours was queued and this tab sat idle for five minutes, so it let go of the
          machine. Nothing was lost — your jobs and results are on the server.
        </p>
      </div>
      <button
        onClick={resumeSession}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary font-medium hover:opacity-90 transition-opacity"
      >
        <Play size={15} /> Resume
      </button>
    </div>
  );
};

const StudentLayout = () => {
  const { paused } = useSocket();
  return (
    <div className="h-screen bg-background text-foreground flex flex-col font-sans antialiased selection:bg-primary/20 selection:text-foreground relative">
      <UsernameModal />

      <nav className="bg-surface/50 backdrop-blur-md border-b border-border px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between sticky top-0 z-40 shrink-0">
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Stylized "Q" mark — ring on top, bold tilde wave underneath
              as the Q's bar. Reads as Q AND signals motion / queue /
              flow. Distinct from a magnifier (single straight handle)
              and from a letter-Q with a diagonal tail. Keep in sync
              with public/favicon.svg if you tweak. */}
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-surface border border-border rounded-lg sm:rounded-xl flex items-center justify-center">
            <svg viewBox="0 0 64 64" className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true">
              <circle cx="32" cy="24" r="13" fill="none" stroke="currentColor" strokeWidth="5"/>
              <path
                d="M 12 50 Q 22 38 32 50 T 52 50"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="hidden xs:block">
            <h1 className="text-base sm:text-lg font-bold tracking-tight leading-none">ComfyQ</h1>
            <p className="text-[10px] text-muted font-medium uppercase tracking-widest mt-0.5 sm:mt-1">Studio</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center space-x-1 bg-surface border border-border rounded-lg p-1">
            <NavLink to="/user" icon={Calendar} label="Timeline" end />
            <NavLink to="/user/dashboard" icon={LayoutDashboard} label="Session Dashboard" />
          </div>
          <Link
            to="/admin"
            title="Admin"
            aria-label="Admin"
            className="p-2 rounded-lg border border-border bg-surface hover:bg-surface/70 text-muted hover:text-foreground transition-colors"
          >
            <Settings size={16} />
          </Link>
          <ThemeToggle />
        </div>
      </nav>

      <ConnectionBanner />
      <WorkflowSwitchBanner />
      <IdleWarningBanner />

      <main className="flex-1 flex flex-col overflow-hidden relative">
        {paused ? <ParkedScreen /> : <Outlet />}
      </main>
    </div>
  );
};

/**
 * NavLink Component
 * 
 * A styled wrapper around React Router's Link component.
 * Handles active state styling based on current location.
 * 
 * @param {Object} props
 * @param {string} props.to - Target path
 * @param {Object} props.icon - Icon component from lucide-react
 * @param {string} props.label - Link text
 * @param {boolean} [props.end] - If true, matches path strictly (exact alignment)
 */
const NavLink = ({ to, icon: Icon, label, end = false }) => {
  const location = useLocation();
  const isActive = end ? location.pathname === to : location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      className={`flex items-center space-x-2 px-2 sm:px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${isActive
        ? 'bg-primary/15 text-foreground'
        : 'text-muted hover:text-foreground hover:bg-white/5'
        }`}
    >
      <Icon size={16} />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
};

/**
 * Main Application Component
 * 
 * Handles initial server connection, mode detection, and routing.
 * 
 * Flow:
 * 1. Checks server mode ('admin' or 'student') on mount via API.
 * 2. Checks whether this machine is locked with an access password
 *    (GET /access/status) — if so, and no valid token is stored, the
 *    AccessGate is shown instead of the student UI.
 * 3. Shows loading screen while connecting.
 * 4. Renders appropriate routes based on mode:
 *    - Admin Mode: Redirects root to /admin
 *    - Student Mode: Redirects root to /user, wraps user routes in SocketProvider
 * 
 * Routes:
 * - /admin: Configuration page (AdminConfig)  — never behind the access gate,
 *           so an admin can always reach the panel to change or lift it.
 * - /user: Main user interface (Scheduler, Dashboard)
 * - /: Smart redirect based on mode
 */
const App = () => {
  const [mode, setMode] = useState(null); // 'admin' | 'student' | null
  // null = not checked yet, true = may enter, false = show the gate.
  const [accessOk, setAccessOk] = useState(null);

  useEffect(() => {
    const checkMode = async (retries = 3) => {
      try {
        const res = await fetch(`${SERVER_URL}/admin/mode`);
        if (res.ok) {
          const data = await res.json();
          setMode(data.mode);
        } else {
          throw new Error("Server response not OK");
        }
      } catch (error) {
        if (retries > 0) {
          console.log(`[App] Retrying mode check... (${retries} left)`);
          setTimeout(() => checkMode(retries - 1), 1500);
        } else {
          console.error("Failed to check server mode after retries", error);
          setMode('student');
        }
      }
    };
    checkMode();
  }, []);

  // Is this machine reserved? A stored token from a previous session is
  // validated here too, so a password change on the server re-prompts.
  const checkAccess = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/access/status`, { headers: accessHeaders() });
      if (!res.ok) throw new Error('status check failed');
      const data = await res.json();
      if (data.locked && !data.valid) clearAccessToken();   // stale token
      setAccessOk(!data.locked || !!data.valid);
    } catch {
      // Can't ask — don't strand the user behind a gate we couldn't confirm.
      // Any real attempt to use the machine is still gated server-side.
      setAccessOk(true);
    }
  }, []);

  useEffect(() => { checkAccess(); }, [checkAccess]);

  // The socket was refused (or revoked mid-session) because the machine is
  // locked — drop the stale token and bring the gate back.
  const handleAccessDenied = useCallback(() => {
    clearAccessToken();
    setAccessOk(false);
  }, []);

  if (!mode || accessOk === null) {
    return (
      <div className="h-screen w-full bg-background flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-surface border border-border animate-pulse" />
        <p className="text-muted font-medium animate-pulse">Connecting to ComfyQ...</p>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        {/* Admin Route - Always accessible for configuration, but intended flow is based on mode */}
        <Route path="/admin" element={<AdminConfig currentMode={mode} />} />

        {/* User Routes - Only fully functional in student mode */}
        <Route path="/user" element={
          mode === 'student' ? (
            accessOk ? (
              <SocketProvider onAccessDenied={handleAccessDenied}>
                <StudentLayout />
              </SocketProvider>
            ) : (
              <div className="h-screen bg-background">
                <AccessGate onUnlocked={() => setAccessOk(true)} />
              </div>
            )
          ) : (
            // In Admin mode, /user redirects to /admin or shows a maintenance message
            <Navigate to="/admin" replace />
          )
        }>
          <Route index element={<SchedulerPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
        </Route>

        {/* Root Redirect */}
        <Route path="/" element={
          mode === 'admin' ? <Navigate to="/admin" replace /> : <Navigate to="/user" replace />
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;

