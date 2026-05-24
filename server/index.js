import 'dotenv/config.js';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import jwt from 'jsonwebtoken';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import messageRoutes from './routes/messages.js';
import Message from './models/Message.js';
import User from './models/User.js';
import Conversation from './models/Conversation.js';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);

// Socket.io auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecret');
    socket.userId = decoded.id;
    socket.username = decoded.username;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

// Track online users: userId -> socketId
const onlineUsers = new Map();

io.on('connection', async (socket) => {
  console.log(`User connected: ${socket.username} (${socket.userId})`);
  onlineUsers.set(socket.userId, socket.id);

  // Mark user online
  const user = await User.findByIdAndUpdate(socket.userId, { isOnline: true, lastSeen: new Date() }, { new: true });

  // Broadcast updated online list
  io.emit('onlineUsers', Array.from(onlineUsers.keys()));

  // Join a private room for this user
  socket.join(socket.userId);

  // Handle sending a message
  socket.on('sendMessage', async ({ to, conversationId, cipherText, nonce }) => {
    try {
      const sender = await User.findById(socket.userId);
      const recipient = await User.findById(to);

      // Check if blocked
      if (sender.blockedUsers.includes(to) || recipient.blockedUsers.includes(socket.userId)) {
        socket.emit('messageError', 'Cannot send message to this user');
        return;
      }

      // Validate encrypted message
      if (!cipherText || !nonce) {
        socket.emit('messageError', 'Invalid encrypted message');
        return;
      }

      // Find or create conversation
      let conversation = await Conversation.findOne({
        participants: { $all: [socket.userId, to] },
        isActive: true,
      });

      if (!conversation) {
        conversation = await Conversation.create({
          participants: [socket.userId, to],
          unreadCount: new Map([[socket.userId, 0], [to, 0]]),
        });
      }

      // Store ONLY encrypted data
      const messageData = {
        conversation: conversation._id,
        sender: socket.userId,
        recipients: [to],
        cipherText, // Encrypted message
        nonce, // Encryption nonce
        // Don't store plaintext
        content: { text: '', images: [], files: [] },
        status: 'sent',
      };

      const message = await Message.create(messageData);
      const populated = await message.populate('sender', 'username avatar isOnline');

      // Update conversation
      conversation.lastMessage = message._id;
      conversation.lastMessageAt = new Date();

      // Increment unread count for recipient
      const currentCount = conversation.unreadCount.get(to.toString()) || 0;
      conversation.unreadCount.set(to.toString(), currentCount + 1);
      await conversation.save();

      // Send encrypted message to recipient
      io.to(to).emit('newMessage', populated);
      // Echo back to sender
      io.to(socket.userId).emit('newMessage', populated);
      // Notify recipient about new unread message in sidebar (don't decrypt here, just notify)
      io.to(to).emit('conversationUpdate', {
        conversationId: conversation._id,
        lastMessage: '[Encrypted message]', // Don't expose plaintext
        lastMessageAt: conversation.lastMessageAt,
        unreadCount: currentCount + 1,
      });
    } catch (err) {
      console.error('Message error:', err);
      socket.emit('messageError', err.message);
    }
  });

  // Handle message seen
  socket.on('markMessageSeen', async ({ messageId, conversationId }) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) return;

      // Add current user to seenBy if not already there
      const alreadySeen = message.seenBy.some((s) => s.user.toString() === socket.userId);
      if (!alreadySeen) {
        message.seenBy.push({ user: socket.userId, seenAt: new Date() });
        message.status = 'read';
        await message.save();

        // Notify sender about read receipt
        io.to(message.sender.toString()).emit('messageSeen', {
          messageId,
          seenBy: socket.userId,
          seenAt: new Date(),
        });
      }

      // Reset unread count
      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
        conversation.unreadCount.set(socket.userId.toString(), 0);
        await conversation.save();
      }
    } catch (err) {
      console.error('Mark seen error:', err);
    }
  });

  // Typing indicators
  socket.on('typing', ({ to }) => {
    io.to(to).emit('userTyping', { from: socket.userId, username: socket.username });
  });

  socket.on('stopTyping', ({ to }) => {
    io.to(to).emit('userStopTyping', { from: socket.userId });
  });

  // Block/Unblock users
  socket.on('blockUser', async ({ userId }) => {
    try {
      const user = await User.findById(socket.userId);
      if (!user.blockedUsers.includes(userId)) {
        user.blockedUsers.push(userId);
        await user.save();
        socket.emit('userBlocked', userId);
      }
    } catch (err) {
      console.error('Block error:', err);
    }
  });

  socket.on('unblockUser', async ({ userId }) => {
    try {
      const user = await User.findById(socket.userId);
      user.blockedUsers = user.blockedUsers.filter((id) => id.toString() !== userId);
      await user.save();
      socket.emit('userUnblocked', userId);
    } catch (err) {
      console.error('Unblock error:', err);
    }
  });

  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.username}`);
    onlineUsers.delete(socket.userId);
    await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastSeen: new Date() });
    io.emit('onlineUsers', Array.from(onlineUsers.keys()));
  });
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/chatapp')
  .then(() => {
    console.log('MongoDB connected');
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.error('MongoDB error:', err));