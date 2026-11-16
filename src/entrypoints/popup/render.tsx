import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/globals.css';
import App from './App';

export function mountPopup() {
  // The loading surface lives outside this root, so React can initialize the
  // theme and read settings without clearing the popup's first visible frame.
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
