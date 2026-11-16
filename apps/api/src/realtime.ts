import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyToken } from './auth';
import type { Notify } from './services/notify';

/**
 * Socket.IO with JWT auth. Dispatchers and admins join "ops" and see the whole fleet;
 * a driver joins only "vehicle:<id>" and receives their own tour's events.
 */
export function createRealtime(server: HttpServer, secret: string, vehicleOfDriver: (userId: string) => Promise<string | null>) {
  const io = new Server(server, { path: '/socket.io', cors: { origin: false } });
  io.use((socket, next) => {
    const user = verifyToken(String(socket.handshake.auth?.token ?? ''), secret);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });
  io.on('connection', async (socket) => {
    const user = socket.data.user;
    if (user.role === 'DRIVER') {
      const vehicleId = await vehicleOfDriver(user.id);
      if (vehicleId) socket.join(`vehicle:${vehicleId}`);
    } else socket.join('ops');
  });
  return io;
}

export function socketNotify(getIo: () => Server | undefined): Notify {
  const emit = (event: string, payload: unknown, vehicleId?: string) => {
    const io = getIo();
    if (!io) return;
    const rooms = vehicleId ? ['ops', `vehicle:${vehicleId}`] : ['ops'];
    io.to(rooms).emit(event, payload);
  };
  return {
    position: (p) => emit('vehicle:position', p, p.vehicleId),
    stop: (s) => emit('stop:updated', s, s.vehicleId),
    tour: (t) => emit('tour:updated', t, t.vehicleId),
    orders: (c) => emit('orders:changed', c),
    eta: (p) => emit('tour:eta', p, p.vehicleId),
  };
}
