import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { queryClient } from './api/queryClient.ts';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import './ui/theme.css';
import './ui/grid.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    {/* Outermost, so a throw from the providers themselves still shows something. The
        boundary inside the shell (App.tsx) keeps the chrome alive for the far commoner
        case of one screen failing. */}
    <ErrorBoundary title="Something went wrong">
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
