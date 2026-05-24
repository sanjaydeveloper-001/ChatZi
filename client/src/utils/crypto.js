/**
 * src/utils/crypto.js  (CLIENT — React + Vite + ESModules)
 *
 * SIMPLIFIED private key encryption using crypto_generichash instead of Argon2.
 *
 * ─── WHAT CHANGED ────────────────────────────────────────────────────────────
 *
 * REMOVED:
 *   - crypto_pwhash / Argon2 — was crashing in browser/Vite
 *   - deriveKeyFromPassword(password, saltHex) — gone
 *   - saltHex parameter from decryptPrivateKey — no longer needed
 *   - All Buffer usage — Buffer does not exist in the browser
 *
 * NEW FLOW:
 *   encryptPrivateKey:  key = crypto_generichash(32, from_string(password))
 *   decryptPrivateKey:  key = crypto_generichash(32, from_string(password))
 *
 * KEPT:
 *   - crypto_box_easy / open_easy for messages (true E2EE unchanged)
 *   - All sodium helpers: from_hex, to_hex, from_string, to_string
 *   - Explicit byte lengths on all randombytes_buf calls
 *
 * ─── INSTALL ─────────────────────────────────────────────────────────────────
 *   npm install libsodium-wrappers@0.7.13
 * ─────────────────────────────────────────────────────────────────────────────
 */

import sodium from 'libsodium-wrappers';

// ─── Singleton initialization ─────────────────────────────────────────────────
// sodium.ready is already a Promise — no IIFE wrapper needed
const sodiumReady = sodium.ready;

/**
 * Ensure sodium WASM is initialized. Returns the sodium module.
 * @returns {Promise<typeof sodium>}
 */
export async function ensureSodium() {
  await sodiumReady;
  return sodium;
}

// ─── Internal helper ──────────────────────────────────────────────────────────

/**
 * Hash a password into a 32-byte key using BLAKE2b (crypto_generichash).
 * Deterministic: same password → same key, every time.
 * No salt, no Argon2, no randombytes — stable in all environments.
 *
 * @param {string} password
 * @returns {Promise<Uint8Array>} 32-byte key
 */
async function hashPasswordToKey(password) {
  const na = await ensureSodium();

  if (!password || typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  // from_string() → Uint8Array (NO Buffer — Buffer not available in browser)
  const key = na.crypto_generichash(32, na.from_string(password));

  if (!key || key.length !== 32) {
    throw new Error('Password hashing produced an invalid key');
  }

  return key;
}

// ─── Private key encryption / decryption ─────────────────────────────────────

/**
 * Encrypt a private key with the user's password.
 * Called on the SERVER during signup — exported here for symmetry/testing.
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

  const key             = await hashPasswordToKey(password);
  const nonce           = na.randombytes_buf(na.crypto_secretbox_NONCEBYTES); // 24 bytes
  const privateKeyBytes = na.from_hex(privateKeyHex);  // Uint8Array — NOT Buffer

  const encryptedBytes = na.crypto_secretbox_easy(privateKeyBytes, nonce, key);

  return {
    encryptedPrivateKey: na.to_hex(encryptedBytes),
    nonce:               na.to_hex(nonce),
  };
}

/**
 * Decrypt the user's private key after login.
 * NOTE: No saltHex parameter — salt was removed from this simplified flow.
 *
 * @param {string} encryptedPrivateKeyHex - From server login response (hex)
 * @param {string} nonceHex              - From server login response (hex)
 * @param {string} password              - User's plaintext password
 * @returns {Promise<string>} Decrypted private key as hex string (store in memory only)
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

  // Return as hex string for storage in React state (memory only, never localStorage)
  return na.to_hex(privateKey);
}

// ─── Message encryption / decryption ─────────────────────────────────────────

/**
 * Encrypt a UTF-8 message. True E2EE — server never sees plaintext.
 *
 * @param {string} message               - Plaintext message
 * @param {string} recipientPublicKeyHex - Recipient public key (hex)
 * @param {string} senderPrivateKeyHex   - Sender private key (hex, from memory)
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
  const messageBytes       = na.from_string(message); // Uint8Array — NOT Buffer

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
 * Decrypt a message. Returns plaintext only in the browser — never sent to server.
 *
 * @param {string} cipherTextHex          - Encrypted message (hex)
 * @param {string} nonceHex               - Nonce (hex)
 * @param {string} senderPublicKeyHex     - Sender public key (hex)
 * @param {string} recipientPrivateKeyHex - Recipient private key (hex, from memory)
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

  return na.to_string(decrypted); // to_string() works in browser; Buffer does NOT
}