import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

// ThemeContext — single source of truth for light vs dark mode.
//
// Storage: `localStorage.comfyq_theme` = 'light' | 'dark'. If unset, we
// honor `prefers-color-scheme` on first visit, then persist whatever the
// user picks.
//
// DOM contract: the active mode is reflected as a class on <html>:
//   .dark   → dark mode (the polished default)
//   .light  → light mode (functional v0; some hardcoded slate/black/white
//            classes still need component-level cleanup — see overrides in
//            index.css)
// We apply the class via the bootstrap script in main.jsx BEFORE React
// hydrates, so there's no flash-of-unthemed-content.
//
// Why context + hook rather than a global store? Because the toggle is the
// only consumer that actually re-renders on theme change — the CSS does
// the rest. Context is the cheapest fit.

const STORAGE_KEY = 'comfyq_theme';
const ThemeContext = createContext(null);

function readStoredTheme() {
    if (typeof window === 'undefined') return 'dark';
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'light' || v === 'dark') return v;
    } catch { /* localStorage can throw in private mode */ }
    // First-visit: honor system preference.
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
}

function applyTheme(theme) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
}

// Run this BEFORE React renders to avoid a flash. Called from main.jsx.
export function bootstrapTheme() {
    applyTheme(readStoredTheme());
}

export const ThemeProvider = ({ children }) => {
    const [theme, setThemeState] = useState(readStoredTheme);

    useEffect(() => {
        applyTheme(theme);
        try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
    }, [theme]);

    const setTheme = useCallback((next) => {
        setThemeState(next === 'light' ? 'light' : 'dark');
    }, []);

    const toggleTheme = useCallback(() => {
        setThemeState(prev => prev === 'dark' ? 'light' : 'dark');
    }, []);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
    return ctx;
};
