import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import App from './App.tsx';
import './i18n';
import store from './state/store.ts';
import { SyncManager } from '@/data/repositories/supabase/syncManager.ts';

void (() => {
  SyncManager.getInstance();
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div>Loading...</div>}>
      <Provider store={store}>
        <App />,
      </Provider>
    </Suspense>
  </StrictMode>,
);
