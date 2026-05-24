/**
 * Vite + libsodium-wrappers Test
 * Run this in browser console after npm run dev starts successfully
 */

// Test 1: Import and initialize
console.log('Test 1: Testing sodium initialization...');
try {
  import('./utils/crypto.js').then(crypto => {
    crypto.ensureSodium().then(() => {
      console.log('✅ TEST 1 PASSED: Sodium initialized successfully!');
    }).catch(err => {
      console.error('❌ TEST 1 FAILED:', err.message);
    });
  });
} catch (err) {
  console.error('❌ TEST 1 FAILED:', err.message);
}

// Test 2: Check that sodium.ready is resolved
setTimeout(() => {
  console.log('Test 2: Verifying sodium is ready...');
  
  import('libsodium-wrappers').then(sodium => {
    sodium.ready.then(() => {
      console.log('✅ TEST 2 PASSED: libsodium-wrappers loaded and ready!');
      console.log('   Sodium constants available:');
      console.log('   - crypto_box_PUBLICKEYBYTES:', sodium.crypto_box_PUBLICKEYBYTES);
      console.log('   - crypto_box_SECRETKEYBYTES:', sodium.crypto_box_SECRETKEYBYTES);
      console.log('   - crypto_box_NONCEBYTES:', sodium.crypto_box_NONCEBYTES);
    }).catch(err => {
      console.error('❌ TEST 2 FAILED:', err.message);
    });
  }).catch(err => {
    console.error('❌ TEST 2 FAILED:', err.message);
  });
}, 500);

// Test 3: Verify crypto functions exist
setTimeout(() => {
  console.log('Test 3: Verifying crypto functions...');
  try {
    import('./utils/crypto.js').then(crypto => {
      const functions = [
        'ensureSodium',
        'deriveKeyFromPassword',
        'decryptPrivateKey',
        'encryptMessage',
        'decryptMessage'
      ];
      
      const missing = functions.filter(fn => typeof crypto[fn] !== 'function');
      
      if (missing.length === 0) {
        console.log('✅ TEST 3 PASSED: All crypto functions available!');
        console.log('   Functions:', functions.join(', '));
      } else {
        console.error('❌ TEST 3 FAILED: Missing functions:', missing.join(', '));
      }
    });
  } catch (err) {
    console.error('❌ TEST 3 FAILED:', err.message);
  }
}, 1000);

console.log('Tests started... Check console for results in 1-2 seconds');
