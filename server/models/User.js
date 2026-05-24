import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3 },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, minlength: 6 },
    fullName: { type: String, default: '' },
    avatar: { type: String, default: null },
    bio: { type: String, default: '' },
    status: { type: String, enum: ['online', 'offline', 'away'], default: 'offline' },
    isActive: { type: Boolean, default: true },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // E2EE encryption keys
    publicKey: { type: String, default: null }, // Public key (hex string)
    encryptedPrivateKey: { type: String, default: null }, // Encrypted private key (hex string)
    privateKeyNonce: { type: String, default: null }, // Nonce for private key encryption (hex string)
    privateKeySalt: { type: String, default: null }, // Salt for password derivation (hex string)
    notifications: [
      {
        type: { type: String, enum: ['message', 'typing', 'blocked'], default: 'message' },
        from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        message: String,
        read: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    preferences: {
      notifications: { type: Boolean, default: true },
      typingIndicator: { type: Boolean, default: true },
      readReceipts: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

export default mongoose.model('User', userSchema);