import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './i18n';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
