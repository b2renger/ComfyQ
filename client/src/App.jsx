import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import SchedulerPage from './pages/Scheduler';
import DashboardPage from './pages/Dashboard';
import AdminConfig from './pages/AdminConfig';
import { LayoutDashboard, Calendar, Settings } from 'lucide-react';
import UsernameModal from './components/UsernameModal';
import { SERVER_URL } from './utils/api';
import { Link, useLocation } from 'react-router-dom';

// Layout for the Student/User View
const StudentLayout = () => {
  return (
    <div className="h-screen bg-background text-white flex flex-col font-sans antialiased selection:bg-primary/20 selection:text-primary-light relative">
      <UsernameModal />

      <nav className="bg-surface/50 backdrop-blur-md border-b border-border px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between sticky top-0 z-40 shrink-0">
        <div className="flex items-center space-x-2 sm:space-x-3">
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-primary to-secondary rounded-lg sm:rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
            <span className="font-bold text-lg sm:text-xl text-white">C</span>
          </div>
          <div className="hidden xs:block">
            <h1 className="text-base sm:text-lg font-bold tracking-tight leading-none">ComfyQ</h1>
            <p className="text-[10px] text-muted font-medium text-primary uppercase tracking-widest mt-0.5 sm:mt-1">Studio</p>
          </div>
        </div>
        <div className="flex items-center space-x-1 bg-surface border border-border rounded-lg p-1">
          <NavLink to="/user" icon={Calendar} label="Timeline" end />
          <NavLink to="/user/dashboard" icon={LayoutDashboard} label="All Jobs" />
        </div>
      </nav>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none" />
        <Outlet />
      </main>
    </div>
  );
};

// NavLink Component
const NavLink = ({ to, icon: Icon, label, end = false }) => {
  const location = useLocation();
  const isActive = end ? location.pathname === to : location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      className={`flex items-center space-x-2 px-2 sm:px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${isActive
        ? 'bg-primary/10 text-primary-light'
        : 'text-muted hover:text-white hover:bg-white/5'
        }`}
    >
      <Icon size={16} />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
};

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
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary-dark animate-pulse shadow-lg shadow-primary/20" />
        <p className="text-slate-500 font-medium animate-pulse">Connecting to ComfyQ...</p>
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

