import sodium from 'libsodium-wrappers-sumo';

const sodiumReady = (async () => {
  await sodium.ready;
})();

export async function ensureSodium() {
  await sodiumReady;
  return sodium;
}

/**
 * Derive encryption key from password using argon2i
 * @param {string} password - User password
 * @param {string} saltHex - Salt in hex format
 * @returns {Uint8Array} Derived key
 */
export async function deriveKeyFromPassword(password, saltHex) {
  await ensureSodium();

  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  if (!saltHex || typeof saltHex !== 'string') {
    throw new Error('Salt must be a hex string');
  }

  const salt = sodium.from_hex(saltHex);
  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_DEFAULT
  );

  if (!key || key.length === 0) {
    throw new Error('Failed to derive key from password');
  }

  return key;
}

/**
 * Decrypt private key using password
 * @param {string} encryptedPrivateKeyHex - Encrypted private key (hex)
 * @param {string} nonceHex - Nonce (hex)
 * @param {string} saltHex - Salt (hex)
 * @param {string} password - User password
 * @returns {string} Decrypted private key in hex format
 */
export async function decryptPrivateKey(encryptedPrivateKeyHex, nonceHex, saltHex, password) {
  await ensureSodium();

  if (!encryptedPrivateKeyHex || typeof encryptedPrivateKeyHex !== 'string') {
    throw new Error('Encrypted private key must be a hex string');
  }

  if (!nonceHex || typeof nonceHex !== 'string') {
    throw new Error('Nonce must be a hex string');
  }

  if (!saltHex || typeof saltHex !== 'string') {
    throw new Error('Salt must be a hex string');
  }

  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  const encryptedPrivateKey = sodium.from_hex(encryptedPrivateKeyHex);
  const nonce = sodium.from_hex(nonceHex);

  const key = await deriveKeyFromPassword(password, saltHex);

  const privateKey = sodium.crypto_secretbox_open_easy(encryptedPrivateKey, nonce, key);

  if (!privateKey || privateKey.length === 0) {
    throw new Error('Failed to decrypt private key. Check your password.');
  }

  return sodium.to_hex(privateKey);
}

/**
 * Encrypt message for recipient
 * @param {string} message - Plain text message
 * @param {string} recipientPublicKeyHex - Recipient's public key (hex)
 * @param {string} senderPrivateKeyHex - Sender's private key (hex)
 * @returns {Object} { cipherText, nonce } - Both in hex format
 */
export async function encryptMessage(message, recipientPublicKeyHex, senderPrivateKeyHex) {
  await ensureSodium();

  if (!message || typeof message !== 'string') {
    throw new Error('Message must be a non-empty string');
  }

  if (!recipientPublicKeyHex || typeof recipientPublicKeyHex !== 'string') {
    throw new Error('Recipient public key must be a hex string');
  }

  if (!senderPrivateKeyHex || typeof senderPrivateKeyHex !== 'string') {
    throw new Error('Sender private key must be a hex string');
  }

  const recipientPublicKey = sodium.from_hex(recipientPublicKeyHex);
  const senderPrivateKey = sodium.from_hex(senderPrivateKeyHex);
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);

  if (!nonce || nonce.length === 0) {
    throw new Error('Failed to generate nonce');
  }

  const messageBuffer = sodium.from_string(message);

  const cipherText = sodium.crypto_box_easy(messageBuffer, nonce, recipientPublicKey, senderPrivateKey);

  if (!cipherText || cipherText.length === 0) {
    throw new Error('Failed to encrypt message');
  }

  return {
    cipherText: sodium.to_hex(cipherText),
    nonce: sodium.to_hex(nonce),
  };
}

/**
 * Decrypt message from sender
 * @param {string} cipherTextHex - Encrypted message (hex)
 * @param {string} nonceHex - Nonce (hex)
 * @param {string} senderPublicKeyHex - Sender's public key (hex)
 * @param {string} recipientPrivateKeyHex - Recipient's private key (hex)
 * @returns {string} Decrypted message
 */
export async function decryptMessage(cipherTextHex, nonceHex, senderPublicKeyHex, recipientPrivateKeyHex) {
  await ensureSodium();

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

  const cipherText = sodium.from_hex(cipherTextHex);
  const nonce = sodium.from_hex(nonceHex);
  const senderPublicKey = sodium.from_hex(senderPublicKeyHex);
  const recipientPrivateKey = sodium.from_hex(recipientPrivateKeyHex);

  const decrypted = sodium.crypto_box_open_easy(cipherText, nonce, senderPublicKey, recipientPrivateKey);

  if (!decrypted || decrypted.length === 0) {
    throw new Error('Failed to decrypt message');
  }

  return sodium.to_string(decrypted);
}
