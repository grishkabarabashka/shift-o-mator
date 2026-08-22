import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './ui/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой узел #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
