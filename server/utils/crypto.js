/**
 * server/utils/crypto.js
 *
 * SIMPLIFIED private key encryption using crypto_generichash instead of Argon2.
 *
 * ─── WHAT CHANGED ────────────────────────────────────────────────────────────
 *
 * REMOVED:
 *   - crypto_pwhash (Argon2) — was causing salt generation crashes
 *   - deriveKeyFromPassword() — no longer needed
 *   - salt generation / storage — no longer needed
 *   - privateKeySalt field — remove from User model and login response
 *
 * NEW FLOW:
 *   encryptPrivateKey:  hash = crypto_generichash(32, password) → use as key
 *   decryptPrivateKey:  hash = crypto_generichash(32, password) → decrypt
 *
 * KEPT:
 *   - crypto_box_easy / crypto_box_open_easy for messages (true E2EE)
 *   - crypto_secretbox_easy / open_easy for private key storage
 *   - All sodium.from_hex() instead of Buffer.from() (fixes WASM crash)
 *   - All sodium.from_string() / to_string() instead of Buffer (browser safe)
 *
 * ─── INSTALL ─────────────────────────────────────────────────────────────────
 *   npm install libsodium-wrappers@0.7.13
 * ─────────────────────────────────────────────────────────────────────────────
 */

import sodium from 'libsodium-wrappers';

// ─── Singleton initialization ─────────────────────────────────────────────────
const sodiumReady = sodium.ready;

/**
 * Ensure sodium WASM is initialized. Returns the sodium module.
 * Always await this before using any sodium function.
 * @returns {Promise<typeof sodium>}
 */
export async function ensureSodium() {
  await sodiumReady;
  return sodium;
}

// ─── Key pair ─────────────────────────────────────────────────────────────────

/**
 * Generate a Curve25519 key pair for E2EE messaging.
 * @returns {Promise<{ publicKey: string, privateKey: string }>} Both as hex strings
 */
export async function generateKeyPair() {
  const na = await ensureSodium();

  const keyPair = na.crypto_box_keypair();

  if (!keyPair || !keyPair.publicKey || !keyPair.privateKey) {
    throw new Error('Key pair generation failed');
  }

  return {
    publicKey:  na.to_hex(keyPair.publicKey),
    privateKey: na.to_hex(keyPair.privateKey),
  };
}

// ─── Private key encryption / decryption ─────────────────────────────────────

/**
 * Hash a password into a 32-byte symmetric key using crypto_generichash (BLAKE2b).
 * Simple, stable, and browser/Node safe — no salt, no Argon2, no randombytes needed.
 *
 * @param {string} password
 * @returns {Uint8Array} 32-byte key
 */
async function hashPasswordToKey(password) {
  const na = await ensureSodium();

  if (!password || typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  // crypto_generichash(outputBytes, input) → Uint8Array
  // Using from_string() — never Buffer, works in both Node and browser
  const key = na.crypto_generichash(32, na.from_string(password));

  if (!key || key.length !== 32) {
    throw new Error('Password hashing produced invalid key');
  }

  return key;
}

/**
 * Encrypt a private key using a password-derived key (crypto_secretbox_easy).
 * Stores: encryptedPrivateKey + nonce. No salt needed.
 *
 * @param {string} privateKeyHex - Private key as hex string
 * @param {string} password      - User's plaintext password
 * @returns {Promise<{ encryptedPrivateKey: string, nonce: string }>}
 */
export async function encryptPrivateKey(privateKeyHex, password) {
  const na = await ensureSodium();

  if (!privateKeyHex || typeof privateKeyHex !== 'string') {
    throw new Error('Private key must be a hex string');
  }
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  // Step 1: derive a 32-byte key from the password
  const key = await hashPasswordToKey(password);

  // Step 2: generate a random nonce — always pass explicit byte length
  const nonce = na.randombytes_buf(na.crypto_secretbox_NONCEBYTES); // 24 bytes

  // Step 3: convert private key hex → Uint8Array (NOT Buffer.from — fixes WASM crash)
  const privateKeyBytes = na.from_hex(privateKeyHex);

  // Step 4: encrypt
  const encryptedBytes = na.crypto_secretbox_easy(privateKeyBytes, nonce, key);

  return {
    encryptedPrivateKey: na.to_hex(encryptedBytes),
    nonce:               na.to_hex(nonce),
  };
}

/**
 * Decrypt a private key using the same password hash.
 *
 * @param {string} encryptedPrivateKeyHex - Encrypted private key (hex)
 * @param {string} nonceHex              - Nonce (hex)
 * @param {string} password              - User's plaintext password
 * @returns {Promise<Uint8Array>} Decrypted private key bytes
 */
export async function decryptPrivateKey(encryptedPrivateKeyHex, nonceHex, password) {
  const na = await ensureSodium();

  if (!encryptedPrivateKeyHex || typeof encryptedPrivateKeyHex !== 'string') {
    throw new Error('Encrypted private key must be a hex string');
  }
  if (!nonceHex || typeof nonceHex !== 'string') {
    throw new Error('Nonce must be a hex string');
  }
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  const key            = await hashPasswordToKey(password);
  const encryptedBytes = na.from_hex(encryptedPrivateKeyHex);
  const nonce          = na.from_hex(nonceHex);

  const privateKey = na.crypto_secretbox_open_easy(encryptedBytes, nonce, key);

  if (!privateKey || privateKey.length === 0) {
    throw new Error('Decryption failed — wrong password or corrupted data');
  }

  return privateKey; // Uint8Array
}

// ─── Message encryption / decryption ─────────────────────────────────────────

/**
 * Encrypt a UTF-8 message using sender's private key + recipient's public key.
 * Uses crypto_box_easy (Curve25519 + XSalsa20-Poly1305). True E2EE.
 *
 * @param {string} message               - Plaintext message
 * @param {string} recipientPublicKeyHex - Recipient public key (hex)
 * @param {string} senderPrivateKeyHex   - Sender private key (hex)
 * @returns {Promise<{ cipherText: string, nonce: string }>}
 */
export async function encryptMessage(message, recipientPublicKeyHex, senderPrivateKeyHex) {
  const na = await ensureSodium();

  if (!message || typeof message !== 'string') {
    throw new Error('Message must be a non-empty string');
  }
  if (!recipientPublicKeyHex || typeof recipientPublicKeyHex !== 'string') {
    throw new Error('Recipient public key must be a hex string');
  }
  if (!senderPrivateKeyHex || typeof senderPrivateKeyHex !== 'string') {
    throw new Error('Sender private key must be a hex string');
  }

  const recipientPublicKey = na.from_hex(recipientPublicKeyHex);
  const senderPrivateKey   = na.from_hex(senderPrivateKeyHex);
  const nonce              = na.randombytes_buf(na.crypto_box_NONCEBYTES); // 24 bytes
  const messageBytes       = na.from_string(message); // Uint8Array, not Buffer

  const cipherText = na.crypto_box_easy(messageBytes, nonce, recipientPublicKey, senderPrivateKey);

  if (!cipherText || cipherText.length === 0) {
    throw new Error('Message encryption failed');
  }

  return {
    cipherText: na.to_hex(cipherText),
    nonce:      na.to_hex(nonce),
  };
}

/**
 * Decrypt a message using recipient's private key + sender's public key.
 *
 * @param {string} cipherTextHex          - Encrypted message (hex)
 * @param {string} nonceHex               - Nonce (hex)
 * @param {string} senderPublicKeyHex     - Sender public key (hex)
 * @param {string} recipientPrivateKeyHex - Recipient private key (hex)
 * @returns {Promise<string>} Decrypted UTF-8 message
 */
export async function decryptMessage(cipherTextHex, nonceHex, senderPublicKeyHex, recipientPrivateKeyHex) {
  const na = await ensureSodium();

  if (!cipherTextHex || typeof cipherTextHex !== 'string') {
    throw new Error('Cipher text must be a hex string');
  }
  if (!nonceHex || typeof nonceHex !== 'string') {
    throw new Error('Nonce must be a hex string');
  }
  if (!senderPublicKeyHex || typeof senderPublicKeyHex !== 'string') {
    throw new Error('Sender public key must be a hex string');
  }
  if (!recipientPrivateKeyHex || typeof recipientPrivateKeyHex !== 'string') {
    throw new Error('Recipient private key must be a hex string');
  }

  const cipherText          = na.from_hex(cipherTextHex);
  const nonce               = na.from_hex(nonceHex);
  const senderPublicKey     = na.from_hex(senderPublicKeyHex);
  const recipientPrivateKey = na.from_hex(recipientPrivateKeyHex);

  const decrypted = na.crypto_box_open_easy(cipherText, nonce, senderPublicKey, recipientPrivateKey);

  if (!decrypted || decrypted.length === 0) {
    throw new Error('Message decryption failed — wrong keys or corrupted data');
  }

  return na.to_string(decrypted);
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

/**
 * @returns {Promise<Object>}
 */
export async function getSodiumStatus() {
  const na = await ensureSodium();
  return {
    sodiumLoaded: true,
    ready: true,
    constants: {
      crypto_box_PUBLICKEYBYTES:   na.crypto_box_PUBLICKEYBYTES,   // 32
      crypto_box_SECRETKEYBYTES:   na.crypto_box_SECRETKEYBYTES,   // 32
      crypto_box_NONCEBYTES:       na.crypto_box_NONCEBYTES,       // 24
      crypto_secretbox_KEYBYTES:   na.crypto_secretbox_KEYBYTES,   // 32
      crypto_secretbox_NONCEBYTES: na.crypto_secretbox_NONCEBYTES, // 24
      crypto_generichash_BYTES:    na.crypto_generichash_BYTES,    // 32
    },
  };
}