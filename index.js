const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const authRoutes = require('./routes/auth');
const meetingRoutes = require('./routes/meetings');
const hostRoutes = require('./routes/host');
const Meeting = require('./models/Meeting');

const app = express();
const server = http.createServer(app);

// ✅ FIXED CORS CONFIGURATION
const corsOptions = {
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('/*path', cors(corsOptions));
const io = socketIo(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  }
});

// Make io accessible to routes
app.set('io', io);

// Middleware
app.use(express.json());

// MongoDB Atlas connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    console.log(`✅ MongoDB Atlas connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error('❌ MongoDB Atlas connection error:', error.message);
    console.log('🔄 Retrying connection in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
};

// Connect to MongoDB Atlas
connectDB();

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('🔴 MongoDB disconnected');
});

// Make io available to routes via middleware
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/host', hostRoutes);

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Test endpoint to verify MongoDB connection
app.get('/api/test-db', async (req, res) => {
  try {
    const status = mongoose.connection.readyState;
    const statusMap = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    res.json({
      mongodb: statusMap[status] || 'unknown',
      readyState: status,
      host: mongoose.connection.host || 'unknown'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Store users in rooms
const users = {};
const socketToRoom = {};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🟢 New client connected:', socket.id);

  socket.on('join-room', ({ roomId, userId, userName, role }) => {
    console.log(`👤 ${userName} (${userId}) joining room: ${roomId} as ${role || 'participant'}`);
    
    socket.join(roomId);
    socketToRoom[socket.id] = roomId;
    
    if (!users[roomId]) {
      users[roomId] = [];
    }
    
    const existingUser = users[roomId].find(u => u.userId === userId);
    if (!existingUser) {
      users[roomId].push({
        socketId: socket.id,
        userId,
        userName,
        role: role || 'participant'
      });
    }
    
    socket.to(roomId).emit('user-connected', {
      socketId: socket.id,
      userId,
      userName,
      role: role || 'participant'
    });
    
    socket.emit('existing-users', users[roomId].filter(u => u.socketId !== socket.id));
    
    console.log(`👥 Users in room ${roomId}:`, users[roomId].length);
  });

  socket.on('offer', ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit('offer', {
      offer,
      fromSocketId: socket.id
    });
  });

  socket.on('answer', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('answer', {
      answer,
      fromSocketId: socket.id
    });
  });

  socket.on('ice-candidate', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('ice-candidate', {
      candidate,
      fromSocketId: socket.id
    });
  });

  socket.on('toggle-audio', ({ roomId, isMuted }) => {
    socket.to(roomId).emit('user-audio-toggle', {
      socketId: socket.id,
      isMuted
    });
  });

  socket.on('toggle-video', ({ roomId, isVideoOff }) => {
    socket.to(roomId).emit('user-video-toggle', {
      socketId: socket.id,
      isVideoOff
    });
  });

  socket.on('mute-all', ({ roomId }) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    if (room) {
      room.forEach(socketId => {
        if (socketId !== socket.id) {
          io.to(socketId).emit('participant-muted', { 
            userId: users[roomId]?.find(u => u.socketId === socketId)?.userId,
            mutedBy: socket.id 
          });
        }
      });
    }
  });

  socket.on('remove-participant', ({ roomId, participantId }) => {
    const participant = users[roomId]?.find(u => u.userId === participantId);
    if (participant) {
      io.to(participant.socketId).emit('participant-removed', { 
        userId: participantId,
        removedBy: socket.id 
      });
      
      users[roomId] = users[roomId].filter(u => u.userId !== participantId);
      socket.to(roomId).emit('user-disconnected', participant.socketId);
    }
  });

  socket.on('make-cohost', async ({ roomId, participantId }) => {
    try {
      const meeting = await Meeting.findOne({ roomId });
      if (!meeting) return;

      const participant = meeting.participants.find(
        p => p.userId?.toString() === participantId
      );
      
      if (participant) {
        participant.role = 'co-host';
        await meeting.save();
        
        const userInRoom = users[roomId]?.find(u => u.userId === participantId);
        if (userInRoom) {
          userInRoom.role = 'co-host';
        }
        
        io.to(roomId).emit('participant-role-updated', {
          userId: participantId,
          newRole: 'co-host'
        });
      }
    } catch (error) {
      console.error('Make cohost error:', error);
    }
  });

  socket.on('remove-cohost', async ({ roomId, participantId }) => {
    try {
      const meeting = await Meeting.findOne({ roomId });
      if (!meeting) return;

      const participant = meeting.participants.find(
        p => p.userId?.toString() === participantId
      );
      
      if (participant) {
        participant.role = 'participant';
        await meeting.save();
        
        const userInRoom = users[roomId]?.find(u => u.userId === participantId);
        if (userInRoom) {
          userInRoom.role = 'participant';
        }
        
        io.to(roomId).emit('participant-role-updated', {
          userId: participantId,
          newRole: 'participant'
        });
      }
    } catch (error) {
      console.error('Remove cohost error:', error);
    }
  });

  socket.on('end-meeting', ({ roomId }) => {
    io.to(roomId).emit('meeting-ended', {
      endedBy: socket.id
    });
    
    const room = io.sockets.adapter.rooms.get(roomId);
    if (room) {
      room.forEach(socketId => {
        const clientSocket = io.sockets.sockets.get(socketId);
        if (clientSocket) {
          clientSocket.leave(roomId);
        }
      });
    }
    
    delete users[roomId];
  });

  socket.on('update-meeting-settings', ({ roomId, ...settings }) => {
    io.to(roomId).emit('meeting-settings-updated', settings);
  });

  socket.on('disconnect', () => {
    console.log('🔴 Client disconnected:', socket.id);
    
    const roomId = socketToRoom[socket.id];
    if (roomId && users[roomId]) {
      users[roomId] = users[roomId].filter(u => u.socketId !== socket.id);
      socket.to(roomId).emit('user-disconnected', socket.id);
      
      if (users[roomId].length === 0) {
        delete users[roomId];
        console.log(`🗑️ Room ${roomId} deleted (empty)`);
      } else {
        console.log(`👥 Users remaining in room ${roomId}:`, users[roomId].length);
      }
    }
    delete socketToRoom[socket.id];
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Client URL: ${process.env.CLIENT_URL || 'http://localhost:3000'}`);
});