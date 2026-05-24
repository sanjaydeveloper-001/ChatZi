const router = require('express').Router();
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');

// GET /api/messages/:userId - Get or create conversation
router.get('/:userId', auth, async (req, res) => {
  try {
    const otherUser = await User.findById(req.params.userId);
    if (!otherUser) return res.status(404).json({ message: 'User not found' });

    // Check if user is blocked
    const currentUser = await User.findById(req.user.id);
    if (currentUser.blockedUsers.includes(req.params.userId)) {
      return res.status(403).json({ message: 'This user is blocked' });
    }

    // Find or create conversation
    let conversation = await Conversation.findOne({
      participants: { $all: [req.user.id, req.params.userId] },
      isActive: true,
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.user.id, req.params.userId],
        unreadCount: new Map([[req.user.id, 0], [req.params.userId, 0]]),
      });
    }

    // Get messages
    const messages = await Message.find({ conversation: conversation._id })
      .sort({ createdAt: 1 })
      .populate('sender', 'username avatar isOnline')
      .populate('seenBy.user', 'username');

    res.json({ conversation: conversation._id, messages });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/messages/send - Send a message
router.post('/send', auth, async (req, res) => {
  try {
    const { conversationId, to, content } = req.body;
    
    if (!to || !content) {
      return res.status(400).json({ message: 'Recipient and content required' });
    }

    const recipient = await User.findById(to);
    if (!recipient) return res.status(404).json({ message: 'User not found' });

    const sender = await User.findById(req.user.id);
    if (sender.blockedUsers.includes(to)) {
      return res.status(403).json({ message: 'You have blocked this user' });
    }
    if (recipient.blockedUsers.includes(req.user.id)) {
      return res.status(403).json({ message: 'This user has blocked you' });
    }

    // Find or create conversation
    let conversation = await Conversation.findOne({
      participants: { $all: [req.user.id, to] },
      isActive: true,
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.user.id, to],
        unreadCount: new Map([[req.user.id, 0], [to, 0]]),
      });
    }

    // Create message
    const message = await Message.create({
      conversation: conversation._id,
      sender: req.user.id,
      recipients: [to],
      content: typeof content === 'string' ? { text: content } : content,
      status: 'sent',
    });

    // Update conversation
    conversation.lastMessage = message._id;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    const populatedMessage = await message.populate('sender', 'username avatar isOnline');

    res.status(201).json(populatedMessage);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/messages/:messageId/read - Mark message as read
router.put('/:messageId/read', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Check if user is a recipient
    if (!message.recipients.includes(req.user.id)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Add user to seenBy if not already there
    const alreadySeen = message.seenBy.some((s) => s.user.toString() === req.user.id);
    if (!alreadySeen) {
      message.seenBy.push({ user: req.user.id, seenAt: new Date() });
      message.status = 'read';
      await message.save();
    }

    res.json(message);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/messages/:messageId - Soft delete message
router.delete('/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    if (message.sender.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    message.isDeleted = true;
    await message.save();

    res.json({ message: 'Message deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;