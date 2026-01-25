import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import SchedulerPage from './pages/Scheduler';
import DashboardPage from './pages/Dashboard';
import { LayoutDashboard, Calendar, User } from 'lucide-react';
import UsernameModal from './components/UsernameModal';

const App = () => {
  return (
    <SocketProvider>
      <Router>
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
              <NavLink to="/" icon={Calendar} label="Timeline" />
              <NavLink to="/dashboard" icon={LayoutDashboard} label="Admin" />
            </div>
          </nav>

          <main className="flex-1 flex flex-col overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none" />
            <Routes>
              <Route path="/" element={<SchedulerPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
            </Routes>
          </main>
        </div>
      </Router>
    </SocketProvider>
  );
};

const NavLink = ({ to, icon: Icon, label }) => (
  <Link
    to={to}
    className="flex items-center space-x-2 px-2 sm:px-4 py-2 rounded-md text-sm font-medium text-muted hover:text-white hover:bg-white/5 transition-all duration-200"
  >
    <Icon size={16} />
    <span className="hidden sm:inline">{label}</span>
  </Link>
);

export default App;
