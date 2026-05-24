const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

// GET /api/users — all users except self with conversation info
router.get('/', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    const users = await User.find({ _id: { $ne: req.user.id } })
      .select('-password')
      .lean();

    // Add conversation info and blocked status
    const usersWithConversations = await Promise.all(
      users.map(async (user) => {
        const conversation = await Conversation.findOne({
          participants: { $all: [req.user.id, user._id] },
          isActive: true,
        }).populate('lastMessage');

        return {
          ...user,
          isBlocked: currentUser.blockedUsers.includes(user._id),
          lastMessage: conversation?.lastMessage?.content?.text || '',
          lastMessageAt: conversation?.lastMessageAt,
          unreadCount: conversation?.unreadCount?.get(req.user.id.toString()) || 0,
        };
      })
    );

    res.json(usersWithConversations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/users/:userId/block — block a user
router.post('/:userId/block', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    const userToBlock = await User.findById(req.params.userId);

    if (!userToBlock) return res.status(404).json({ message: 'User not found' });

    if (currentUser.blockedUsers.includes(req.params.userId)) {
      return res.status(400).json({ message: 'User already blocked' });
    }

    currentUser.blockedUsers.push(req.params.userId);
    await currentUser.save();

    res.json({ message: 'User blocked successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/users/:userId/unblock — unblock a user
router.post('/:userId/unblock', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    const userToUnblock = await User.findById(req.params.userId);

    if (!userToUnblock) return res.status(404).json({ message: 'User not found' });

    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      (id) => id.toString() !== req.params.userId
    );
    await currentUser.save();

    res.json({ message: 'User unblocked successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/blocked - Get blocked users
router.get('/blocked', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id).populate('blockedUsers', '-password');
    res.json(currentUser.blockedUsers || []);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;