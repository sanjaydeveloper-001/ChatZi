import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { ensureSodium, decryptPrivateKey } from '../utils/crypto';

// Configure axios baseURL
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
axios.defaults.baseURL = API_BASE;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [privateKey, setPrivateKey] = useState(null); // Private key stored ONLY in memory
  const [publicKey, setPublicKey] = useState(null); // Public key for encryption

  useEffect(() => {
    (async () => {
      await ensureSodium();
      if (token) {
        const stored = localStorage.getItem('user');
        if (stored) setUser(JSON.parse(stored));
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      }
      setLoading(false);
    })();
  }, [token]);

  const signup = async (username, email, password) => {
    const { data } = await axios.post('/api/auth/signup', { username, email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    setToken(data.token);
    setUser(data.user);
    setPublicKey(data.user.publicKey); // Store public key
    // Don't store private key on signup - it will be retrieved on login
    return data;
  };

  const login = async (username, password) => {
    const { data } = await axios.post('/api/auth/login', { username, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    
    setToken(data.token);
    setUser(data.user);
    setPublicKey(data.user.publicKey); // Store public key

    // Decrypt private key using password and store in memory only
    if (data.user.encryptedPrivateKey && data.user.privateKeyNonce && data.user.privateKeySalt) {
      try {
        const decrypted = await decryptPrivateKey(
          data.user.encryptedPrivateKey,
          data.user.privateKeyNonce,
          data.user.privateKeySalt,
          password
        );
        setPrivateKey(decrypted); // Store only in memory
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
    setToken(null);
    setUser(null);
    setPrivateKey(null); // Clear private key from memory
    setPublicKey(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, privateKey, publicKey, signup, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);