import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider, bootstrapTheme } from './context/ThemeContext'

// Apply the persisted (or system-preferred) theme to <html> BEFORE React
// renders, so we never paint a flash of the wrong palette.
bootstrapTheme();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
