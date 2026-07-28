'use strict';

const { Server } = require('socket.io');
const db = require('../config/db');
const { verificarToken } = require('../utils/jwt');
const socketHub = require('./socketHub');

async function loadActiveUserFromToken(token) {
  const payload = verificarToken(token);
  const userId = Number(payload.sub ?? payload.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    const error = new Error('Token inválido');
    error.code = 'INVALID_TOKEN';
    throw error;
  }

  const [rows] = await db.pool.query(
    `SELECT id, email, nombre, area, is_admin, is_active
     FROM usuario
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  const user = rows[0];
  if (!user || Number(user.is_active) !== 1) {
    const error = new Error('Usuario inactivo o no encontrado');
    error.code = 'INACTIVE_USER';
    throw error;
  }

  return {
    ...payload,
    id: Number(user.id),
    sub: Number(user.id),
    email: user.email || payload.email || '',
    nombre: user.nombre || payload.nombre || '',
    area: user.area || payload.area || '',
    is_admin: Number(user.is_admin) === 1,
    is_active: true,
  };
}

function attachRealtime(app, httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || true,
      credentials: true,
    },
  });

  socketHub.setIO(io);
  app.set('io', io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
      if (!token) {
        const error = new Error('Token requerido');
        error.code = 'TOKEN_REQUIRED';
        throw error;
      }

      const user = await loadActiveUserFromToken(token);
      socket.user = user;
      return next();
    } catch (error) {
      const safeError = new Error('No autorizado');
      safeError.data = { code: error.code || 'AUTH_ERROR' };
      console.warn('[socket] conexión rechazada:', error.code || error.message);
      return next(safeError);
    }
  });

  io.on('connection', socket => {
    const userId = Number(socket.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      socket.disconnect(true);
      return;
    }

    const wasOnline = socketHub.getSocketIdsForUser(userId).length > 0;
    const room = socketHub.userRoom(userId);
    socketHub.addConnection(userId, socket.id);
    if (room) socket.join(room);

    if (!wasOnline) {
      io.emit('user:presence:update', {
        usuario_id: userId,
        online: true,
      });
    }

    socket.emit('realtime:ready', {
      user_id: userId,
      connected_users: socketHub.getConnectedUserIds().length,
    });

    socket.on('disconnect', () => {
      socketHub.removeConnection(userId, socket.id);
      if (!socketHub.getSocketIdsForUser(userId).length) {
        io.emit('user:presence:update', {
          usuario_id: userId,
          online: false,
        });
      }
    });
  });

  return io;
}

module.exports = {
  attachRealtime,
  loadActiveUserFromToken,
};
