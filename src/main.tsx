import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { PreferencesProvider } from '@/state/preferences';
import '@/styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <PreferencesProvider>
      <App />
    </PreferencesProvider>
  </StrictMode>,
);
