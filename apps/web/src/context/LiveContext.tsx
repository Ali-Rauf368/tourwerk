import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Position, Prediction } from '../lib/types';
import { useAuth } from './AuthContext';

export interface FeedItem {
  id: number;
  at: Date;
  kind: 'delivered' | 'failed' | 'arrived' | 'tour' | 'orders' | 'risk';
  text: string;
  tourId?: string;
}

interface LiveState {
  connected: boolean;
  positions: Record<string, Position>;
  /** Latest arrival forecast per running tour (pushed by the ETA engine). */
  forecasts: Record<string, Prediction>;
  feed: FeedItem[];
  /** Increments whenever server data changed in a way lists should refetch. */
  version: number;
}

const LiveContext = createContext<LiveState>({ connected: false, positions: {}, forecasts: {}, feed: [], version: 0 });

/** One Socket.IO connection for the whole app; pages read positions, the event feed and a refetch signal. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [connected, setConnected] = useState(false);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [forecasts, setForecasts] = useState<Record<string, Prediction>>({});
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [version, setVersion] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket'] });
    const push = (item: Omit<FeedItem, 'id' | 'at'>) => setFeed((f) => [{ ...item, id: ++seq.current, at: new Date() }, ...f].slice(0, 60));
    // Batch refetch signals so a burst of stop events triggers one reload.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        setVersion((v) => v + 1);
      }, 400);
    };

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('vehicle:position', (p: Position) => setPositions((all) => ({ ...all, [p.vehicleId]: p })));
    socket.on('stop:updated', (s: { tourId: string; status: string; failReason?: string; orderId: string }) => {
      if (s.status === 'DELIVERED') push({ kind: 'delivered', text: 'Delivered', tourId: s.tourId });
      else if (s.status === 'FAILED') push({ kind: 'failed', text: `Failed – ${s.failReason ?? 'unknown'}`, tourId: s.tourId });
      bump();
    });
    socket.on('tour:updated', (t: { id: string; status: string }) => {
      push({ kind: 'tour', text: t.status === 'COMPLETED' ? 'Tour completed' : 'Tour started', tourId: t.id });
      bump();
    });
    socket.on('orders:changed', bump);
    const atRisk = new Map<string, number>(); // tourId -> late stops last reported, to announce only changes
    socket.on('tour:eta', (p: Prediction) => {
      setForecasts((all) => ({ ...all, [p.tourId]: p }));
      const before = atRisk.get(p.tourId) ?? 0;
      if (p.late > before) push({ kind: 'risk', text: `${p.late} stop${p.late > 1 ? 's' : ''} forecast to miss the window`, tourId: p.tourId });
      atRisk.set(p.tourId, p.late);
    });
    return () => {
      if (pending) clearTimeout(pending);
      socket.disconnect();
    };
  }, [token]);

  return <LiveContext.Provider value={{ connected, positions, forecasts, feed, version }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
