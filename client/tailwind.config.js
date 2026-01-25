/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "#09090b", // Zinc-950
                surface: "#18181b",    // Zinc-900
                border: "#27272a",     // Zinc-800
                primary: "#6366f1",    // Indigo-500
                "primary-hover": "#4f46e5",
                secondary: "#a855f7",  // Purple-500
                success: "#10b981",    // Emerald-500
                warning: "#f59e0b",    // Amber-500
                danger: "#ef4444",     // Red-500
                muted: "#a1a1aa",      // Zinc-400
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
            }
        },
    },
    plugins: [],
}
