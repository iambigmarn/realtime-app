const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Enable CORS for all origins (localhost development)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Serve static files from client directory
const path = require('path');
app.use(express.static(path.join(__dirname, '../client')));

// Store room data: { roomId: { users: Set<socketId>, locations: Map<socketId, {lat, lng}> } }
const rooms = new Map();

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // User joins a room
  socket.on('join-room', (roomId) => {
    // Leave previous room if any
    if (socket.roomId) {
      leaveRoom(socket.id, socket.roomId);
    }

    // Join new room
    socket.join(roomId);
    socket.roomId = roomId;

    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Set(),
        locations: new Map()
      });
    }

    const room = rooms.get(roomId);
    room.users.add(socket.id);

    console.log(`User ${socket.id} joined room ${roomId}`);

    // Notify others in the room about the new user
    socket.to(roomId).emit('user-joined', { userId: socket.id });

    // Send current room state to the new user
    socket.emit('room-state', {
      users: Array.from(room.users).filter(id => id !== socket.id),
      locations: Array.from(room.locations.entries()).map(([id, loc]) => ({
        userId: id,
        lat: loc.lat,
        lng: loc.lng
      }))
    });
  });

  // Forward WebRTC signaling messages (offer, answer, ICE candidates)
  socket.on('webrtc-signal', (data) => {
    const { roomId, from, to, signal } = data;

    // Validate room membership
    if (socket.roomId !== roomId) {
      console.warn(`User ${socket.id} tried to signal in room ${roomId} but is in ${socket.roomId}`);
      return;
    }

    // Forward signal to target user (or broadcast if 'to' is not specified)
    if (to) {
      io.to(to).emit('webrtc-signal', {
        roomId,
        from: socket.id,
        signal
      });
    } else {
      // Broadcast to all others in the room
      socket.to(roomId).emit('webrtc-signal', {
        roomId,
        from: socket.id,
        signal
      });
    }
  });

  // Handle location updates
  socket.on('location-update', (data) => {
    const { roomId, lat, lng } = data;

    // Validate room membership
    if (socket.roomId !== roomId) {
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    // Update location for this user
    room.locations.set(socket.id, { lat, lng });

    // Broadcast location to others in the room
    socket.to(roomId).emit('location-update', {
      roomId,
      userId: socket.id,
      lat,
      lng
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);

    if (socket.roomId) {
      leaveRoom(socket.id, socket.roomId);

      // Notify others in the room
      io.to(socket.roomId).emit('user-left', { userId: socket.id });
    }
  });

  // Helper function to clean up room data
  function leaveRoom(socketId, roomId) {
    const room = rooms.get(roomId);
    if (room) {
      room.users.delete(socketId);
      room.locations.delete(socketId);

      // Clean up empty rooms
      if (room.users.size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} deleted (empty)`);
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
const os = require('os');

// Get local network IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Server accessible on network at http://${localIP}:${PORT}`);
  console.log(`Socket.IO server ready for connections`);
});
