'use strict';

const connectedUsers = new Map();

let ioInstance = null;

function normalizeUserId(userId) {
  const parsed = Number(userId);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function userRoom(userId) {
  const normalized = normalizeUserId(userId);
  return normalized ? `user:${normalized}` : null;
}

function setIO(io) {
  ioInstance = io;
  return ioInstance;
}

function getIO() {
  return ioInstance;
}

function addConnection(userId, socketId) {
  const normalized = normalizeUserId(userId);
  if (!normalized || !socketId) return null;
  if (!connectedUsers.has(normalized)) {
    connectedUsers.set(normalized, new Set());
  }
  connectedUsers.get(normalized).add(String(socketId));
  return connectedUsers.get(normalized);
}

function removeConnection(userId, socketId) {
  const normalized = normalizeUserId(userId);
  if (!normalized || !socketId) return false;
  const sockets = connectedUsers.get(normalized);
  if (!sockets) return false;
  sockets.delete(String(socketId));
  if (!sockets.size) {
    connectedUsers.delete(normalized);
  }
  return true;
}

function getSocketIdsForUser(userId) {
  const normalized = normalizeUserId(userId);
  if (!normalized) return [];
  const sockets = connectedUsers.get(normalized);
  return sockets ? Array.from(sockets) : [];
}

function getConnectedUserIds() {
  return Array.from(connectedUsers.keys());
}

function emitToUser(userId, eventName, payload) {
  const io = getIO();
  const room = userRoom(userId);
  if (!io || !room || !eventName) return 0;
  io.to(room).emit(eventName, payload);
  return getSocketIdsForUser(userId).length;
}

function emitToUsers(userIds, eventName, payload) {
  const uniqueIds = Array.from(
    new Set((userIds || []).map(normalizeUserId).filter(Boolean))
  );
  let sent = 0;
  uniqueIds.forEach(userId => {
    sent += emitToUser(userId, eventName, payload);
  });
  return sent;
}

module.exports = {
  addConnection,
  connectedUsers,
  emitToUser,
  emitToUsers,
  getConnectedUserIds,
  getIO,
  getSocketIdsForUser,
  removeConnection,
  setIO,
  userRoom,
};
