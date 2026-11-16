import type { ReactNode } from 'react';
import { Track } from './pages/Track';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LiveProvider } from './context/LiveContext';
import type { Role } from './lib/types';
import { Dashboard } from './pages/Dashboard';
import { Dispatch } from './pages/Dispatch';
import { Driver } from './pages/Driver';
import { Fleet } from './pages/Fleet';
import { Live } from './pages/Live';
import { Login } from './pages/Login';
import { Orders } from './pages/Orders';

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={user.role === 'DRIVER' ? '/driver' : '/'} replace />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/track/:token" element={<Track />} />
      <Route path="/driver" element={<RequireRole roles={['DRIVER']}><Driver /></RequireRole>} />
      <Route element={<RequireRole roles={['ADMIN', 'DISPATCHER']}><Layout /></RequireRole>}>
        <Route index element={<Dashboard />} />
        <Route path="dispatch" element={<Dispatch />} />
        <Route path="live" element={<Live />} />
        <Route path="orders" element={<Orders />} />
        <Route path="fleet" element={<Fleet />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <LiveProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </LiveProvider>
    </AuthProvider>
  );
}
