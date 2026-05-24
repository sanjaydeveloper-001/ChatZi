const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const signToken = (user) =>
  jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET || 'supersecret', {
    expiresIn: '7d',
  });

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { username, email, password, fullName } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ message: 'Username, email and password required' });

    const existsUsername = await User.findOne({ username });
    const existsEmail = await User.findOne({ email });
    if (existsUsername) return res.status(409).json({ message: 'Username already taken' });
    if (existsEmail) return res.status(409).json({ message: 'Email already registered' });

    const user = await User.create({ username, email, password, fullName, status: 'online', isActive: true });
    const token = signToken(user);
    res.status(201).json({ 
      token, 
      user: { 
        _id: user._id, 
        username: user.username, 
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        isOnline: user.isOnline,
      } 
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    // Update last seen
    user.lastSeen = new Date();
    user.isOnline = true;
    user.status = 'online';
    await user.save();

    const token = signToken(user);
    res.json({ 
      token, 
      user: { 
        _id: user._id, 
        username: user.username, 
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        isOnline: user.isOnline,
      } 
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;