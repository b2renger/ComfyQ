import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// Simple icon button that toggles between light and dark mode.
// Lives in the main app nav (StudentLayout) and the AdminConfig header.
const ThemeToggle = ({ className = '' }) => {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === 'dark';
    return (
        <button
            type="button"
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`p-2 rounded-lg border border-border bg-surface hover:bg-surface/70 text-muted hover:text-foreground transition-colors ${className}`}
        >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
    );
};

export default ThemeToggle;
