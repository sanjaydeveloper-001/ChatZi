#!/usr/bin/env node

/**
 * Test Script: Verify Sodium Installation and Crypto Functions
 * Run from: w:\WORKS\ChatZi\server
 * Command: node test-crypto-setup.js
 */

import sodium from 'libsodium-wrappers-sumo';

console.log('\n' + '='.repeat(60));
console.log('SODIUM INITIALIZATION TEST');
console.log('='.repeat(60));

// Test 1: Check if sodium is loaded
console.log('\n[TEST 1] Checking if sodium is loaded...');
if (!sodium) {
  console.error('❌ FAILED: Sodium is not loaded');
  process.exit(1);
}
console.log('✅ PASSED: Sodium loaded');

// Test 2: Initialize sodium
console.log('\n[TEST 2] Initializing sodium...');
(async () => {
  try {
    await sodium.ready;
    console.log('✅ PASSED: Sodium initialized');
    
    // Test 3: Check constants
    console.log('\n[TEST 3] Checking sodium constants...');
    const constants = {
      'crypto_box_PUBLICKEYBYTES': sodium.crypto_box_PUBLICKEYBYTES,
      'crypto_box_SECRETKEYBYTES': sodium.crypto_box_SECRETKEYBYTES,
      'crypto_secretbox_KEYBYTES': sodium.crypto_secretbox_KEYBYTES,
      'crypto_secretbox_NONCEBYTES': sodium.crypto_secretbox_NONCEBYTES,
      'crypto_pwhash_SALTBYTES': sodium.crypto_pwhash_SALTBYTES,
    };
    
    console.log('\nConstants:');
    let allValid = true;
    for (const [name, value] of Object.entries(constants)) {
      const isValid = value > 0;
      const status = isValid ? '✅' : '❌';
      console.log(`  ${status} ${name}: ${value}`);
      if (!isValid) allValid = false;
    }
    
    if (!allValid) {
      console.error('\n❌ FAILED: Some constants are invalid');
      process.exit(1);
    }
    console.log('\n✅ PASSED: All constants are valid');
    
    // Test 4: Generate keypair
    console.log('\n[TEST 4] Testing generateKeyPair...');
    try {
      const keyPair = sodium.crypto_box_keypair();
      if (!keyPair || !keyPair.publicKey || !keyPair.privateKey) {
        console.error('❌ FAILED: Key pair generation produced invalid result');
        process.exit(1);
      }
      
      const pubKeyHex = sodium.to_hex(keyPair.publicKey);
      const privKeyHex = sodium.to_hex(keyPair.privateKey);
      
      console.log(`  ✅ Public key (hex): ${pubKeyHex.substring(0, 32)}...`);
      console.log(`  ✅ Private key (hex): ${privKeyHex.substring(0, 32)}...`);
      console.log('✅ PASSED: Key pair generation works');
      
      // Test 5: Random bytes
      console.log('\n[TEST 5] Testing random number generation...');
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      if (!nonce || nonce.length === 0) {
        console.error('❌ FAILED: Nonce generation failed');
        process.exit(1);
      }
      console.log(`  ✅ Nonce: ${sodium.to_hex(nonce)}`);
      console.log('✅ PASSED: Random number generation works');
      
      // Test 6: Password hashing
      console.log('\n[TEST 6] Testing password hashing...');
      const password = 'test_password_123';
      const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
      
      try {
        const key = sodium.crypto_pwhash(
          sodium.crypto_secretbox_KEYBYTES,
          password,
          salt,
          sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
          sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
          sodium.crypto_pwhash_ALG_DEFAULT
        );
        
        if (!key || key.length === 0) {
          console.error('❌ FAILED: Key derivation produced empty result');
          process.exit(1);
        }
        
        console.log(`  ✅ Derived key: ${sodium.to_hex(key).substring(0, 32)}...`);
        console.log('✅ PASSED: Password hashing works');
        
        // Test 7: Encryption/Decryption
        console.log('\n[TEST 7] Testing encryption/decryption...');
        const plaintext = 'Hello, E2EE World!';
        const encryptionNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        
        const ciphertext = sodium.crypto_secretbox_easy(
          Buffer.from(plaintext),
          encryptionNonce,
          key
        );
        
        if (!ciphertext || ciphertext.length === 0) {
          console.error('❌ FAILED: Encryption failed');
          process.exit(1);
        }
        
        const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, encryptionNonce, key);
        
        if (!decrypted) {
          console.error('❌ FAILED: Decryption failed');
          process.exit(1);
        }
        
        const decryptedText = Buffer.from(decrypted).toString('utf-8');
        
        if (decryptedText !== plaintext) {
          console.error(`❌ FAILED: Decrypted text doesn't match (got: ${decryptedText})`);
          process.exit(1);
        }
        
        console.log(`  ✅ Plaintext: ${plaintext}`);
        console.log(`  ✅ Encrypted: ${sodium.to_hex(ciphertext).substring(0, 32)}...`);
        console.log(`  ✅ Decrypted: ${decryptedText}`);
        console.log('✅ PASSED: Encryption/Decryption works');
        
        // All tests passed
        console.log('\n' + '='.repeat(60));
        console.log('🎉 ALL TESTS PASSED! 🎉');
        console.log('='.repeat(60));
        console.log('\nSodium is properly installed and all crypto functions work!\n');
        process.exit(0);
        
      } catch (hashErr) {
        console.error('❌ FAILED: Password hashing error:', hashErr.message);
        process.exit(1);
      }
    } catch (keyErr) {
      console.error('❌ FAILED: Key generation error:', keyErr.message);
      process.exit(1);
    }
  } catch (initErr) {
    console.error('❌ FAILED: Sodium initialization error:', initErr.message);
    process.exit(1);
  }
})();
