const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configure CORS for both Express and Socket.io
const corsOptions = {
  origin: (origin, callback) => {
    // In development, allow any origin (such as local IP for mobile devices)
    if (!origin || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Socket.io Server Setup
const io = new Server(server, {
  cors: corsOptions,
  maxHttpBufferSize: 1e7 // Increase limit to 10MB to support encrypted file sharing chunks
});

// In-memory room state: roomId -> { creatorId, users: Map(sessionId -> { sessionId, socketId, encryptedUsername, status, deviceType, disconnectTimer }), selfDestruct, seenTimeout }
const rooms = new Map();

function getRoomUserList(room) {
  return Array.from(room.users.values()).map(u => ({
    sessionId: u.sessionId,
    socketId: u.socketId,
    encryptedUsername: u.encryptedUsername,
    status: u.status,
    deviceType: u.deviceType
  }));
}

io.on('connection', (socket) => {
  console.log(`User connected socket: ${socket.id}`);

  // Handle joining a secure room
  socket.on('join-room', ({ roomId, encryptedUsername, isCreator, sessionId, deviceType }) => {
    if (!roomId) return;
    
    socket.join(roomId);
    socket.roomId = roomId;
    const finalSessionId = sessionId || socket.id;
    socket.sessionId = finalSessionId;
    socket.encryptedUsername = encryptedUsername;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        creatorId: socket.id,
        users: new Map(),
        selfDestruct: 30, // default 30s
        seenTimeout: false // default OFF
      });
    }
    
    const room = rooms.get(roomId);
    
    // Check if user session already exists in room (e.g. reconnect after app switch / temporary network drop)
    if (room.users.has(finalSessionId)) {
      const existingUser = room.users.get(finalSessionId);
      if (existingUser.disconnectTimer) {
        clearTimeout(existingUser.disconnectTimer);
        existingUser.disconnectTimer = null;
      }
      existingUser.socketId = socket.id;
      existingUser.encryptedUsername = encryptedUsername;
      existingUser.status = 'active';
      if (deviceType) existingUser.deviceType = deviceType;
    } else {
      room.users.set(finalSessionId, {
        sessionId: finalSessionId,
        socketId: socket.id,
        encryptedUsername,
        status: 'active',
        deviceType: deviceType || 'Desktop',
        disconnectTimer: null
      });
    }

    if (isCreator) {
      room.creatorId = socket.id;
    }

    // Broadcast updated user list to everyone in the room
    const userList = getRoomUserList(room);
    io.to(roomId).emit('room-users', userList);

    // Notify peers that a new user joined
    socket.to(roomId).emit('peer-joined', {
      socketId: socket.id,
      sessionId: finalSessionId,
      encryptedUsername
    });

    // Send room configuration back to the joining user
    socket.emit('room-info', {
      isCreator: socket.id === room.creatorId,
      selfDestruct: room.selfDestruct,
      seenTimeout: room.seenTimeout
    });

    console.log(`User ${finalSessionId} (socket ${socket.id}) joined room: ${roomId} (isCreator: ${socket.id === room.creatorId})`);
  });

  // Relay encrypted messages to other peers in the room
  socket.on('send-message', ({ roomId, encryptedPayload }) => {
    if (!roomId || !encryptedPayload) return;
    
    // Broadcast message to everyone in the room except the sender
    socket.to(roomId).emit('receive-message', {
      senderId: socket.id,
      encryptedPayload
    });
  });

  // Relay settings updates from creator
  socket.on('update-settings', ({ roomId, selfDestruct, seenTimeout }) => {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room && room.creatorId === socket.id) {
      if (selfDestruct !== undefined) room.selfDestruct = selfDestruct;
      if (seenTimeout !== undefined) room.seenTimeout = seenTimeout;

      // Broadcast settings-updated to all other peers in the room
      socket.to(roomId).emit('settings-updated', {
        selfDestruct: room.selfDestruct,
        seenTimeout: room.seenTimeout
      });
    }
  });

  // Handle peer app state change (tab switch / minimize / return)
  socket.on('app-state-change', ({ roomId, isBackgrounded, deviceType }) => {
    if (!roomId || !socket.sessionId) return;
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.sessionId)) {
      const user = room.users.get(socket.sessionId);
      user.status = isBackgrounded ? 'backgrounded' : 'active';
      if (deviceType) user.deviceType = deviceType;

      socket.to(roomId).emit('peer-app-state', {
        socketId: socket.id,
        sessionId: socket.sessionId,
        isBackgrounded,
        deviceType: user.deviceType
      });

      const userList = getRoomUserList(room);
      io.to(roomId).emit('room-users', userList);
    }
  });

  // Relay typing status to other peers
  socket.on('typing', ({ roomId, isTyping }) => {
    if (!roomId) return;
    
    socket.to(roomId).emit('peer-typing', {
      senderId: socket.id,
      isTyping
    });
  });

  // Handle peer leaving explicitly
  socket.on('leave-room', () => {
    if (socket.roomId && socket.sessionId) {
      handleUserRemoval(socket.roomId, socket.sessionId);
    }
  });

  // Handle socket disconnection
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id} (sessionId: ${socket.sessionId})`);
    if (socket.roomId && socket.sessionId) {
      handleSocketDisconnect(socket.roomId, socket.sessionId, socket.id);
    }
  });
});

// Helper function to handle temporary disconnect (app backgrounding / socket drop)
function handleSocketDisconnect(roomId, sessionId, socketId) {
  if (!rooms.has(roomId)) return;
  const room = rooms.get(roomId);
  if (!room.users.has(sessionId)) return;

  const user = room.users.get(sessionId);
  if (user.socketId === socketId) {
    user.status = 'backgrounded';

    // Broadcast that peer app state is backgrounded
    io.to(roomId).emit('peer-app-state', {
      socketId,
      sessionId,
      isBackgrounded: true,
      deviceType: user.deviceType,
      reason: 'disconnect'
    });

    const userList = getRoomUserList(room);
    io.to(roomId).emit('room-users', userList);

    // Set grace period (45 seconds) for reconnection before removing user completely
    if (user.disconnectTimer) clearTimeout(user.disconnectTimer);
    user.disconnectTimer = setTimeout(() => {
      console.log(`Grace period expired for user ${sessionId} in room ${roomId}. Removing user.`);
      handleUserRemoval(roomId, sessionId);
    }, 45000);
  }
}

// Helper function to remove user from room and notify peers
function handleUserRemoval(roomId, sessionId) {
  if (!roomId || !sessionId || !rooms.has(roomId)) return;
  const room = rooms.get(roomId);
  if (!room.users.has(sessionId)) return;

  const user = room.users.get(sessionId);
  if (user.disconnectTimer) {
    clearTimeout(user.disconnectTimer);
    user.disconnectTimer = null;
  }

  const socketId = user.socketId;
  room.users.delete(sessionId);

  // If the room is now empty, delete it
  if (room.users.size === 0) {
    rooms.delete(roomId);
    console.log(`Room clean-up: Room ${roomId} deleted as it became empty.`);
  } else {
    // If the disconnecting user was the creator, assign a remaining user as creator
    let newCreatorAssigned = false;
    if (room.creatorId === socketId) {
      const remainingUsers = Array.from(room.users.values());
      if (remainingUsers.length > 0) {
        room.creatorId = remainingUsers[0].socketId;
        newCreatorAssigned = true;
        console.log(`Room ${roomId}: assigned new creator socket ${room.creatorId}`);
      }
    }

    // 1. Notify peers that this user left
    io.to(roomId).emit('peer-left', { socketId, sessionId });

    // 2. Broadcast updated user list
    const userList = getRoomUserList(room);
    io.to(roomId).emit('room-users', userList);

    // 3. Notify the new creator if one was assigned
    if (newCreatorAssigned && room.creatorId) {
      io.to(room.creatorId).emit('room-info', {
        isCreator: true,
        selfDestruct: room.selfDestruct,
        seenTimeout: room.seenTimeout
      });
    }
  }
}

// Serve Frontend in Production with Anti-Cache headers for index.html / sw.js
if (process.env.NODE_ENV === 'production' || process.env.SERVE_FRONTEND === 'true') {
  const frontendBuildPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(frontendBuildPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
  
  // Catch-all route to serve Index.html for React router support
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(frontendBuildPath, 'index.html'));
  });
} else {
  // Simple health check endpoint for local development
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Ghost Message backend is running' });
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ghost Message Relay Server listening on port ${PORT}`);
});
