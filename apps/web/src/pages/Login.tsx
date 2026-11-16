import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ErrorNote } from '../components/ui';
import { useAuth } from '../context/AuthContext';

const DEMO = [
  { email: 'dispo@tourwerk.de', role: 'Dispatcher' },
  { email: 'admin@tourwerk.de', role: 'Admin' },
  { email: 'fahrer1@tourwerk.de', role: 'Driver (HH-TW 101)' },
];

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email.trim(), password);
      navigate(user.role === 'DRIVER' ? '/driver' : '/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-slate-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <svg className="absolute inset-0 h-full w-full opacity-30" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M${60 + i * 30} 760 C ${200 + i * 40} ${560 - i * 60}, ${120 + i * 70} ${300 - i * 20}, ${520 - i * 20} ${60 + i * 50}`} fill="none" stroke={['#0d9488', '#2563eb', '#c2410c', '#7c3aed', '#be185d'][i]} strokeWidth="3" strokeDasharray="1 14" strokeLinecap="round" />
          ))}
        </svg>
        <div className="relative flex items-center gap-3">
          <svg viewBox="0 0 32 32" className="h-10 w-10" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#0d9488" />
            <path d="M8 22 L14 10 L18 18 L24 8" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xl font-semibold">Tourwerk</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Plan every delivery in milliseconds. Follow every van in real time.</h2>
          <p className="mt-4 text-slate-300">A C++ route optimizer with capacity and time windows, live tracking over WebSockets and delivery KPIs for the whole depot.</p>
        </div>
        <div className="relative text-xs text-slate-500">Depot Hamburg-Billbrook · 6 vehicles</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4" aria-label="Sign in">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-slate-500">Use your Tourwerk account.</p>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">
            <div className="mb-1.5 font-medium text-slate-600">Demo accounts · password Tourwerk2026!</div>
            {DEMO.map((d) => (
              <button type="button" key={d.email} className="block w-full rounded px-1 py-0.5 text-left hover:bg-slate-100" onClick={() => (setEmail(d.email), setPassword('Tourwerk2026!'))}>
                <span className="font-mono text-slate-700">{d.email}</span> – {d.role}
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
