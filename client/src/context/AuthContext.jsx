import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { ensureSodium, decryptPrivateKey } from '../utils/crypto';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
axios.defaults.baseURL = API_BASE;

const AuthContext = createContext(null);

// ---------- session password helpers ----------
// sessionStorage is cleared automatically when the tab/browser closes.
// The encrypted key + nonce already live in localStorage (via the user object)
// and are safe there — they're useless without the password.
const SESSION_PW_KEY = '__session_pw';
const cachePassword      = (pw) => sessionStorage.setItem(SESSION_PW_KEY, pw);
const getCachedPassword  = ()   => sessionStorage.getItem(SESSION_PW_KEY);
const clearCachedPassword = ()  => sessionStorage.removeItem(SESSION_PW_KEY);
// ----------------------------------------------

export function AuthProvider({ children }) {
  const [user, setUser]             = useState(null);
  const [token, setToken]           = useState(localStorage.getItem('token'));
  const [loading, setLoading]       = useState(true);
  const [privateKey, setPrivateKey] = useState(null);
  const [publicKey, setPublicKey]   = useState(null);

  // Runs on mount and whenever token changes (e.g. after login/logout).
  // On a page refresh: token is still in localStorage, so we re-hydrate the
  // user and attempt to re-decrypt the private key from the session-cached pw.
  useEffect(() => {
    (async () => {
      await ensureSodium();

      if (token) {
        const stored = localStorage.getItem('user');
        if (stored) {
          const parsedUser = JSON.parse(stored);
          setUser(parsedUser);
          setPublicKey(parsedUser.publicKey);
          axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

          // Re-decrypt private key after a page refresh
          const cachedPw = getCachedPassword();
          if (cachedPw && parsedUser.encryptedPrivateKey && parsedUser.privateKeyNonce) {
            try {
              const decrypted = await decryptPrivateKey(
                parsedUser.encryptedPrivateKey,
                parsedUser.privateKeyNonce,
                cachedPw
              );
              setPrivateKey(decrypted);
            } catch (err) {
              // Cached password is stale or corrupt — force re-login
              console.warn('Could not re-decrypt private key on refresh:', err);
              clearCachedPassword();
            }
          }
        }
      }

      setLoading(false);
    })();
  }, [token]);

  const signup = async (username, email, password) => {
    const { data } = await axios.post('/api/auth/signup', { username, email, password });

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;

    // Cache password so private key survives refreshes for this session
    cachePassword(password);

    setToken(data.token);
    setUser(data.user);
    setPublicKey(data.user.publicKey);

    // Decrypt and load private key into memory right after signup
    if (data.user.encryptedPrivateKey && data.user.privateKeyNonce) {
      try {
        const decrypted = await decryptPrivateKey(
          data.user.encryptedPrivateKey,
          data.user.privateKeyNonce,
          password
        );
        setPrivateKey(decrypted);
      } catch (err) {
        console.error('Failed to decrypt private key after signup:', err);
      }
    }

    return data;
  };

  const login = async (username, password) => {
    const { data } = await axios.post('/api/auth/login', { username, password });

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;

    // Cache password so private key survives refreshes for this session
    cachePassword(password);

    setToken(data.token);
    setUser(data.user);
    setPublicKey(data.user.publicKey);

    // Decrypt private key in the browser — keep in React state only
    if (data.user.encryptedPrivateKey && data.user.privateKeyNonce) {
      try {
        const decrypted = await decryptPrivateKey(
          data.user.encryptedPrivateKey,
          data.user.privateKeyNonce,
          password
        );
        setPrivateKey(decrypted);
      } catch (err) {
        console.error('Failed to decrypt private key:', err);
        throw new Error('Failed to decrypt private key. Check your password.');
      }
    }

    return data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];

    clearCachedPassword(); // wipe session password cache
    setToken(null);
    setUser(null);
    setPrivateKey(null); // wipe from memory
    setPublicKey(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, token, loading, privateKey, publicKey, signup, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);