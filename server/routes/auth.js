/**
 * server/routes/auth.js
 *
 * CHANGES from previous version:
 *   - decryptPrivateKey() now takes (encryptedHex, nonceHex, password) — NO saltHex
 *   - encryptPrivateKey() returns { encryptedPrivateKey, nonce } — NO salt
 *   - User.create() no longer stores privateKeySalt
 *   - Login response no longer sends privateKeySalt
 *   - getSodiumStatus() awaited correctly (it is now async)
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import {
  generateKeyPair,
  encryptPrivateKey,
  getSodiumStatus,
  ensureSodium,
} from '../utils/crypto.js';

const router = Router();

const signToken = (user) =>
  jwt.sign(
    { id: user._id, username: user.username },
    process.env.JWT_SECRET || 'supersecret',
    { expiresIn: '7d' }
  );

// GET /api/auth/status — diagnostic
router.get('/status', async (req, res) => {
  try {
    await ensureSodium();
    const status = await getSodiumStatus(); // async — must await
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

    if (!username || typeof username !== 'string' || username.trim() === '') {
      return res.status(400).json({ message: 'Valid username required' });
    }
    if (!email || typeof email !== 'string' || email.trim() === '') {
      return res.status(400).json({ message: 'Valid email required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existsUsername = await User.findOne({ username });
    const existsEmail    = await User.findOne({ email });
    if (existsUsername) return res.status(409).json({ message: 'Username already taken' });
    if (existsEmail)    return res.status(409).json({ message: 'Email already registered' });

    // 1. Generate keypair
    console.log('[AUTH] Generating keypair...');
    let keypair;
    try {
      keypair = await generateKeyPair();
      console.log('[AUTH] Keypair generated');
    } catch (err) {
      console.error('[AUTH] Keypair generation failed:', err.message);
      return res.status(500).json({ message: 'Keypair generation failed: ' + err.message });
    }

    const { publicKey, privateKey } = keypair;

    // 2. Encrypt private key — returns { encryptedPrivateKey, nonce } (no salt)
    console.log('[AUTH] Encrypting private key...');
    let encryptedData;
    try {
      encryptedData = await encryptPrivateKey(privateKey, password);
      console.log('[AUTH] Private key encrypted');
    } catch (err) {
      console.error('[AUTH] Encryption failed:', err.message);
      return res.status(500).json({ message: 'Private key encryption failed: ' + err.message });
    }

    const { encryptedPrivateKey, nonce } = encryptedData; // no salt anymore

    // 3. Save user — privateKeySalt field no longer stored
    const user = await User.create({
      username,
      email,
      password,
      fullName,
      status:             'online',
      isActive:           true,
      publicKey,
      encryptedPrivateKey,
      privateKeyNonce:    nonce,
      // privateKeySalt intentionally omitted
    });

    console.log('[AUTH] User created:', user._id);

    const token = signToken(user);
    res.status(201).json({
      token,
      user: {
        _id:      user._id,
        username: user.username,
        email:    user.email,
        fullName: user.fullName,
        avatar:   user.avatar,
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

    user.lastSeen = new Date();
    user.isOnline = true;
    user.status   = 'online';
    await user.save();

    const token = signToken(user);
    res.json({
      token,
      user: {
        _id:      user._id,
        username: user.username,
        email:    user.email,
        fullName: user.fullName,
        avatar:   user.avatar,
        isOnline: user.isOnline,
        publicKey:           user.publicKey,
        encryptedPrivateKey: user.encryptedPrivateKey,
        privateKeyNonce:     user.privateKeyNonce,
        // privateKeySalt removed — no longer part of the flow
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;