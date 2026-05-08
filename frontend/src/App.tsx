import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider }        from '@tanstack/react-query';
import { LoginPage }    from './pages/LoginPage';
import { CallbackPage } from './pages/CallbackPage';
import { GamePage }     from './pages/GamePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:              1,
      refetchOnWindowFocus: false,
      staleTime:          30_000,
    },
  },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = sessionStorage.getItem('access_token');
  if (!token) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/"         element={<LoginPage />} />
          <Route path="/callback" element={<CallbackPage />} />
          <Route path="/game"     element={
            <RequireAuth><GamePage /></RequireAuth>
          } />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
