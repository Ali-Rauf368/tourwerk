import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'M3 12h4v8H3zM10 4h4v16h-4zM17 9h4v11h-4z' },
  { to: '/dispatch', label: 'Dispatch', icon: 'M4 18 9 8l4 7 3-5 4 8M4 18h16' },
  { to: '/live', label: 'Live map', icon: 'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' },
  { to: '/orders', label: 'Orders', icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/fleet', label: 'Fleet', icon: 'M3 16V7h11v9M14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { connected } = useLive();
  return (
    <div className="min-h-screen md:flex">
      <aside className="flex flex-col bg-slate-900 text-slate-300 md:sticky md:top-0 md:h-screen md:w-60">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#0d9488" />
            <path d="M8 22 L14 10 L18 18 L24 8" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <div className="font-semibold tracking-tight text-white">Tourwerk</div>
            <div className="text-[11px] text-slate-400">Depot Hamburg-Billbrook</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={n.icon} /></svg>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-white/10 px-5 py-4 text-sm md:block">
          <div className="flex items-center gap-2 text-xs">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            {connected ? 'Live connection' : 'Connecting…'}
          </div>
          <div className="mt-3 font-medium text-white">{user?.name}</div>
          <div className="text-xs text-slate-400">{user?.role === 'ADMIN' ? 'Administrator' : 'Dispatcher'}</div>
          <button className="mt-3 text-xs text-slate-400 underline-offset-2 hover:text-white hover:underline" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
}
