import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // E2EE encrypted message content
    cipherText: { type: String, default: '' }, // Encrypted message (hex string)
    nonce: { type: String, default: '' }, // Nonce for encryption (hex string)
    // Legacy fields (can be removed in future)
    content: {
      text: { type: String, default: '' },
      images: [String],
      files: [String],
      emoji: { type: String, default: null },
    },
    status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
    seenBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        seenAt: { type: Date, default: Date.now },
      },
    ],
    isEdited: { type: Boolean, default: false },
    editHistory: [
      {
        oldContent: String,
        editedAt: { type: Date, default: Date.now },
      },
    ],
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('Message', messageSchema);