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
 * @param {Buffer} salt - Salt buffer (optional, generates new if not provided)
 * @returns {Object} { key, salt } - Derived key and salt
 */
async function deriveKeyFromPassword(password, salt = null) {
  await ensureSodium();

  try {
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string');
    }

    if (password.length === 0) {
      throw new Error('Password cannot be empty');
    }

    // Generate salt if not provided
    if (!salt) {
      try {
        salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
        if (!salt || salt.length === 0) {
          throw new Error('Failed to generate salt');
        }
      } catch (saltErr) {
        console.error('[CRYPTO] Salt generation failed:', saltErr);
        throw new Error('Unable to generate salt: ' + saltErr.message);
      }
    }

    // Validate salt
    if (!Buffer.isBuffer(salt) && !(salt instanceof Uint8Array)) {
      throw new Error('Salt must be a Buffer or Uint8Array');
    }

    if (salt.length !== sodium.crypto_pwhash_SALTBYTES) {
      throw new Error(`Salt must be exactly ${sodium.crypto_pwhash_SALTBYTES} bytes`);
    }

    // Derive key
    let key;
    try {
      key = sodium.crypto_pwhash(
        sodium.crypto_secretbox_KEYBYTES,
        password,
        salt,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_DEFAULT
      );
    } catch (keyErr) {
      console.error('[CRYPTO] Key derivation failed:', keyErr);
      throw new Error('Failed to derive key: ' + keyErr.message);
    }

    if (!key || key.length === 0) {
      throw new Error('Key derivation produced empty result');
    }

    return { key, salt };
  } catch (err) {
    console.error('[CRYPTO] deriveKeyFromPassword error:', err.message);
    throw err;
  }
}

/**
 * Encrypt private key with password-derived key
 * @param {Buffer|string} privateKey - Private key to encrypt (hex string or Buffer)
 * @param {string} password - User password
 * @returns {Object} { encryptedPrivateKey, nonce, salt } - All as hex strings
 */
async function encryptPrivateKey(privateKey, password) {
  await ensureSodium();

  try {
    // Validate private key
    if (!privateKey) {
      throw new Error('Private key is required');
    }

    if (typeof privateKey !== 'string' && !Buffer.isBuffer(privateKey) && !(privateKey instanceof Uint8Array)) {
      throw new Error('Private key must be a hex string, Buffer, or Uint8Array');
    }

    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string');
    }

    // Convert hex string to Buffer if needed
    let keyBuffer;
    try {
      if (typeof privateKey === 'string') {
        if (privateKey.length === 0) {
          throw new Error('Private key hex string cannot be empty');
        }
        keyBuffer = Buffer.from(privateKey, 'hex');
      } else {
        keyBuffer = privateKey;
      }
    } catch (bufErr) {
      throw new Error('Failed to convert private key: ' + bufErr.message);
    }

    if (!keyBuffer || keyBuffer.length === 0) {
      throw new Error('Private key buffer is empty or invalid');
    }

    // Derive password-based key
    const { key, salt } = await deriveKeyFromPassword(password);

    // Generate nonce
    let nonce;
    try {
      nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    } catch (nonceErr) {
      console.error('[CRYPTO] Nonce generation failed:', nonceErr);
      throw new Error('Failed to generate nonce: ' + nonceErr.message);
    }

    if (!nonce || nonce.length === 0) {
      throw new Error('Failed to generate nonce - result is empty');
    }

    // Encrypt
    let encryptedPrivateKey;
    try {
      encryptedPrivateKey = sodium.crypto_secretbox_easy(keyBuffer, nonce, key);
    } catch (encryptErr) {
      console.error('[CRYPTO] Encryption failed:', encryptErr);
      throw new Error('Encryption operation failed: ' + encryptErr.message);
    }

    if (!encryptedPrivateKey || encryptedPrivateKey.length === 0) {
      throw new Error('Failed to encrypt private key - result is empty');
    }

    // Convert to hex
    return {
      encryptedPrivateKey: sodium.to_hex(encryptedPrivateKey),
      nonce: sodium.to_hex(nonce),
      salt: sodium.to_hex(salt),
    };
  } catch (err) {
    console.error('[CRYPTO] encryptPrivateKey error:', err.message);
    throw err;
  }
}

/**
 * Decrypt private key with password
 * @param {string} encryptedPrivateKeyHex - Encrypted private key (hex)
 * @param {string} nonceHex - Nonce (hex)
 * @param {string} saltHex - Salt (hex)
 * @param {string} password - User password
 * @returns {Buffer} Decrypted private key
 */
async function decryptPrivateKey(encryptedPrivateKeyHex, nonceHex, saltHex, password) {
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
  const salt = sodium.from_hex(saltHex);

  const { key } = await deriveKeyFromPassword(password, salt);

  const privateKey = sodium.crypto_secretbox_open_easy(encryptedPrivateKey, nonce, key);

  if (!privateKey || privateKey.length === 0) {
    throw new Error('Failed to decrypt private key. Check your password.');
  }

  return privateKey;
}

/**
 * Generate keypair for user
 * @returns {Object} { publicKey, privateKey } - Both as hex strings
 */
async function generateKeyPair() {
  await ensureSodium();

  try {
    let keyPair;
    try {
      keyPair = sodium.crypto_box_keypair();
    } catch (pairErr) {
      console.error('[CRYPTO] crypto_box_keypair failed:', pairErr);
      throw new Error('Key pair generation failed: ' + pairErr.message);
    }

    if (!keyPair) {
      throw new Error('Key pair generation returned null');
    }

    if (!keyPair.publicKey) {
      throw new Error('Key pair is missing publicKey');
    }

    if (!keyPair.privateKey) {
      throw new Error('Key pair is missing privateKey');
    }

    if (keyPair.publicKey.length === 0) {
      throw new Error('Generated public key is empty');
    }

    if (keyPair.privateKey.length === 0) {
      throw new Error('Generated private key is empty');
    }

    const result = {
      publicKey: sodium.to_hex(keyPair.publicKey),
      privateKey: sodium.to_hex(keyPair.privateKey),
    };

    if (!result.publicKey || result.publicKey.length === 0) {
      throw new Error('Public key hex conversion failed');
    }

    if (!result.privateKey || result.privateKey.length === 0) {
      throw new Error('Private key hex conversion failed');
    }

    return result;
  } catch (err) {
    console.error('[CRYPTO] generateKeyPair error:', err.message);
    throw err;
  }
}

/**
 * Encrypt message using sender private key and recipient public key
 * @param {string} message - Message to encrypt
 * @param {string} recipientPublicKeyHex - Recipient public key (hex)
 * @param {string} senderPrivateKeyHex - Sender private key (hex)
 * @returns {Object} { cipherText, nonce } - Both as hex strings
 */
async function encryptMessage(message, recipientPublicKeyHex, senderPrivateKeyHex) {
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

  // Convert message to Buffer
  const messageBuffer = Buffer.from(message, 'utf-8');

  // Encrypt using crypto_box_easy
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
 * Decrypt message using recipient private key and sender public key
 * @param {string} cipherTextHex - Encrypted message (hex)
 * @param {string} nonceHex - Nonce (hex)
 * @param {string} senderPublicKeyHex - Sender public key (hex)
 * @param {string} recipientPrivateKeyHex - Recipient private key (hex)
 * @returns {string} Decrypted message
 */
async function decryptMessage(cipherTextHex, nonceHex, senderPublicKeyHex, recipientPrivateKeyHex) {
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

  return Buffer.from(decrypted).toString('utf-8');
}

/**
 * Diagnostic function to check if sodium is properly initialized
 * @returns {Object} Status information
 */
function getSodiumStatus() {
  return {
    sodiumLoaded: !!sodium,
    ready: sodium && sodium.ready ? true : false,
    constants: {
      crypto_box_PUBLICKEYBYTES: sodium.crypto_box_PUBLICKEYBYTES,
      crypto_box_SECRETKEYBYTES: sodium.crypto_box_SECRETKEYBYTES,
      crypto_secretbox_KEYBYTES: sodium.crypto_secretbox_KEYBYTES,
      crypto_secretbox_NONCEBYTES: sodium.crypto_secretbox_NONCEBYTES,
      crypto_pwhash_SALTBYTES: sodium.crypto_pwhash_SALTBYTES,
    }
  };
}

export {
  deriveKeyFromPassword,
  encryptPrivateKey,
  decryptPrivateKey,
  generateKeyPair,
  encryptMessage,
  decryptMessage,
  getSodiumStatus,
};
