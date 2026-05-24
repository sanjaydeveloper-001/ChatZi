import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { generateKeyPair, encryptPrivateKey, getSodiumStatus, ensureSodium } from '../utils/crypto.js';

const router = Router();

const signToken = (user) =>
  jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET || 'supersecret', {
    expiresIn: '7d',
  });

// GET /api/auth/status - Diagnostic endpoint
router.get('/status', async (req, res) => {
  try {
    await ensureSodium();
    const status = getSodiumStatus();
    res.json({ ok: true, sodiumStatus: status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { username, email, password, fullName } = req.body;
    
    console.log('[AUTH] Signup attempt for:', { username, email });
    
    // Validate inputs
    if (!username || typeof username !== 'string' || username.trim() === '') {
      console.log('[AUTH] Invalid username provided');
      return res.status(400).json({ message: 'Valid username required' });
    }
    
    if (!email || typeof email !== 'string' || email.trim() === '') {
      console.log('[AUTH] Invalid email provided');
      return res.status(400).json({ message: 'Valid email required' });
    }
    
    if (!password || typeof password !== 'string' || password.length < 6) {
      console.log('[AUTH] Invalid password provided');
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    console.log('[AUTH] Input validation passed');

    const existsUsername = await User.findOne({ username });
    const existsEmail = await User.findOne({ email });
    if (existsUsername) {
      console.log('[AUTH] Username already exists:', username);
      return res.status(409).json({ message: 'Username already taken' });
    }
    if (existsEmail) {
      console.log('[AUTH] Email already exists:', email);
      return res.status(409).json({ message: 'Email already registered' });
    }

    console.log('[AUTH] Generating keypair...');
    // Generate keypair for E2EE
    let keypair;
    try {
      keypair = await generateKeyPair();
      console.log('[AUTH] Keypair generated successfully');
    } catch (keyPairErr) {
      console.error('[AUTH] Keypair generation failed:', keyPairErr.message, keyPairErr.stack);
      return res.status(500).json({ message: 'Keypair generation failed: ' + keyPairErr.message });
    }
    
    if (!keypair || !keypair.publicKey || !keypair.privateKey) {
      console.error('[AUTH] Keypair validation failed');
      return res.status(500).json({ message: 'Generated keypair is invalid' });
    }

    const { publicKey, privateKey } = keypair;
    console.log('[AUTH] Public key generated:', publicKey.substring(0, 16) + '...');

    console.log('[AUTH] Encrypting private key...');
    // Encrypt private key with user's password
    let encryptedData;
    try {
      encryptedData = await encryptPrivateKey(privateKey, password);
      console.log('[AUTH] Private key encrypted successfully');
    } catch (encryptErr) {
      console.error('[AUTH] Private key encryption failed:', encryptErr.message, encryptErr.stack);
      return res.status(500).json({ message: 'Private key encryption failed: ' + encryptErr.message });
    }

    if (!encryptedData || !encryptedData.encryptedPrivateKey || !encryptedData.nonce || !encryptedData.salt) {
      console.error('[AUTH] Encrypted data validation failed');
      return res.status(500).json({ message: 'Encryption produced invalid data' });
    }

    const { encryptedPrivateKey, nonce, salt } = encryptedData;
    console.log('[AUTH] Encrypted data validated');

    console.log('[AUTH] Creating user in database...');
    const user = await User.create({
      username,
      email,
      password,
      fullName,
      status: 'online',
      isActive: true,
      // Store encryption keys
      publicKey,
      encryptedPrivateKey,
      privateKeyNonce: nonce,
      privateKeySalt: salt,
    });

    console.log('[AUTH] User created:', user._id);

    const token = signToken(user);
    console.log('[AUTH] Signup successful for:', username);
    
    res.status(201).json({
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        isOnline: user.isOnline,
        publicKey: user.publicKey,
      },
    });
  } catch (err) {
    console.error('[AUTH] Signup error:', err.message, err.stack);
    res.status(500).json({ message: 'Signup failed: ' + err.message });
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
        publicKey: user.publicKey, // Send public key to frontend
        // Return encrypted private key and decryption materials
        encryptedPrivateKey: user.encryptedPrivateKey,
        privateKeyNonce: user.privateKeyNonce,
        privateKeySalt: user.privateKeySalt,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;