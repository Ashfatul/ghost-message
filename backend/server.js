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

// In-memory room state: roomId -> { creatorId, users: Map(socketId -> encryptedUsername), selfDestruct }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle joining a secure room
  socket.on('join-room', ({ roomId, encryptedUsername, isCreator }) => {
    if (!roomId) return;
    
    socket.join(roomId);
    socket.roomId = roomId;
    socket.encryptedUsername = encryptedUsername;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        creatorId: socket.id,
        users: new Map(),
        selfDestruct: 30 // default 30s
      });
    }
    
    const room = rooms.get(roomId);
    // If the joining user is marked as creator, update creator ID (e.g. on reconnect)
    if (isCreator) {
      room.creatorId = socket.id;
    }
    
    // Associate socket ID with the encrypted username
    room.users.set(socket.id, encryptedUsername);

    // Get current user list in this room
    const userMap = room.users;
    const userList = Array.from(userMap.entries()).map(([id, encName]) => ({
      socketId: id,
      encryptedUsername: encName
    }));

    // Broadcast updated user list to everyone in the room
    io.to(roomId).emit('room-users', userList);

    // Notify peers that a new user joined
    socket.to(roomId).emit('peer-joined', {
      socketId: socket.id,
      encryptedUsername
    });

    // Send room configuration back to the joining user
    socket.emit('room-info', {
      isCreator: socket.id === room.creatorId,
      selfDestruct: room.selfDestruct
    });

    console.log(`User ${socket.id} joined room: ${roomId} (isCreator: ${socket.id === room.creatorId})`);
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
  socket.on('update-settings', ({ roomId, selfDestruct }) => {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room && room.creatorId === socket.id) {
      room.selfDestruct = selfDestruct;
      // Broadcast settings-updated to all other peers in the room
      socket.to(roomId).emit('settings-updated', { selfDestruct });
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
    handleUserRemoval(socket);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    handleUserRemoval(socket);
  });
});

// Helper function to remove user from rooms list and notify peers
function handleUserRemoval(socket) {
  const roomId = socket.roomId;
  if (!roomId) return;

  socket.leave(roomId);
  socket.roomId = null;

  if (rooms.has(roomId)) {
    const room = rooms.get(roomId);
    const userMap = room.users;
    userMap.delete(socket.id);

    // If the room is now empty, delete it
    if (userMap.size === 0) {
      rooms.delete(roomId);
      console.log(`Room clean-up: Room ${roomId} deleted as it became empty.`);
    } else {
      // If the disconnecting user was the creator, assign a remaining user as creator
      let newCreatorAssigned = false;
      if (room.creatorId === socket.id) {
        const remainingKeys = Array.from(userMap.keys());
        if (remainingKeys.length > 0) {
          room.creatorId = remainingKeys[0];
          newCreatorAssigned = true;
          console.log(`Room ${roomId}: assigned new creator socket ${room.creatorId}`);
        }
      }

      // 1. Notify peers that this user left (before list update to resolve nickname)
      io.to(roomId).emit('peer-left', { socketId: socket.id });

      // 2. Broadcast updated user list
      const userList = Array.from(userMap.entries()).map(([id, encName]) => ({
        socketId: id,
        encryptedUsername: encName
      }));
      io.to(roomId).emit('room-users', userList);

      // 3. Notify the new creator if one was assigned
      if (newCreatorAssigned && room.creatorId) {
        io.to(room.creatorId).emit('room-info', {
          isCreator: true,
          selfDestruct: room.selfDestruct
        });
      }
    }
  }
}

// Serve Frontend in Production
if (process.env.NODE_ENV === 'production' || process.env.SERVE_FRONTEND === 'true') {
  const frontendBuildPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(frontendBuildPath));
  
  // Catch-all route to serve Index.html for React router support
  app.get('*', (req, res) => {
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
