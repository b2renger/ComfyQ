import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import SchedulerPage from './pages/Scheduler';
import DashboardPage from './pages/Dashboard';
import AdminConfig from './pages/AdminConfig';
import { LayoutDashboard, Calendar, Settings } from 'lucide-react';
import UsernameModal from './components/UsernameModal';
import ThemeToggle from './components/ui/ThemeToggle';
import { SERVER_URL } from './utils/api';
import { Link, useLocation } from 'react-router-dom';

/**
 * StudentLayout Component
 * 
 * Provides the main layout structure for student/user views.
 * Includes the navigation bar, username modal, and a consistent background.
 * Uses <Outlet> to render child routes (Scheduler, Dashboard).
 */
const StudentLayout = () => {
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

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <Outlet />
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
 * 2. Shows loading screen while connecting.
 * 3. Renders appropriate routes based on mode:
 *    - Admin Mode: Redirects root to /admin
 *    - Student Mode: Redirects root to /user, wraps user routes in SocketProvider
 * 
 * Routes:
 * - /admin: Configuration page (AdminConfig)
 * - /user: Main user interface (Scheduler, Dashboard)
 * - /: Smart redirect based on mode
 */
const App = () => {
  const [mode, setMode] = useState(null); // 'admin' | 'student' | null

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

  if (!mode) {
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
            <SocketProvider>
              <StudentLayout />
            </SocketProvider>
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

