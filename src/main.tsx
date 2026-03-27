import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { SettingsProvider } from './contexts/SettingsContext'

// Reload automatico se il SW ha invalidato un chunk JS dopo un nuovo deploy
window.addEventListener('unhandledrejection', (e) => {
  if (/failed to fetch dynamically imported module/i.test(e?.reason?.message || '')) {
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
)
