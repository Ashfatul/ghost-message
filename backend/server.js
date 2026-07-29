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
  origin: process.env.NODE_ENV === 'production' 
    ? false // Served from same origin in production
    : ['http://localhost:5173', 'http://127.0.0.1:5173'], // Vite dev server
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

// In-memory room state: roomId -> Map(socketId -> encryptedUsername)
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle joining a secure room
  socket.on('join-room', ({ roomId, encryptedUsername }) => {
    if (!roomId) return;
    
    socket.join(roomId);
    socket.roomId = roomId;
    socket.encryptedUsername = encryptedUsername;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    
    // Associate socket ID with the encrypted username
    rooms.get(roomId).set(socket.id, encryptedUsername);

    // Get current user list in this room
    const userMap = rooms.get(roomId);
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

    console.log(`User ${socket.id} joined room: ${roomId}`);
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
    const userMap = rooms.get(roomId);
    userMap.delete(socket.id);

    // If the room is now empty, delete it
    if (userMap.size === 0) {
      rooms.delete(roomId);
      console.log(`Room clean-up: Room ${roomId} deleted as it became empty.`);
    } else {
      // Broadcast updated user list
      const userList = Array.from(userMap.entries()).map(([id, encName]) => ({
        socketId: id,
        encryptedUsername: encName
      }));
      io.to(roomId).emit('room-users', userList);
      
      // Notify peers that this user left
      io.to(roomId).emit('peer-left', { socketId: socket.id });
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
