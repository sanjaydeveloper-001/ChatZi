import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { encryptMessage, decryptMessage } from '../utils/crypto';

function getInitial(name) {
  return name ? name[0].toUpperCase() : '?';
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString();
}

export default function Chat() {
  const { user, logout, privateKey } = useAuth();
  const { socket, onlineUsers } = useSocket();

  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typingInfo, setTypingInfo] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [typingUsers, setTypingUsers] = useState({});
  const [activeNav, setActiveNav] = useState('messages');
  const [decryptedMessages, setDecryptedMessages] = useState({});

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Load all users
  useEffect(() => {
    axios.get('/api/users').then(({ data }) => setUsers(data));
  }, []);

  // Load conversation and decrypt messages
  useEffect(() => {
    if (!selectedUser || !privateKey) return;

    (async () => {
      try {
        const { data } = await axios.get(`/api/messages/${selectedUser._id}`);
        setMessages(data.messages);

        const decrypted = {};
        for (const msg of data.messages) {
          if (msg.cipherText && msg.nonce) {
            try {
              // For messages sent by current user, use selectedUser's public key as sender
              // For messages received, use the sender's public key
              const senderIsMe = msg.sender._id === user._id;
              const senderPublicKey = senderIsMe
                ? selectedUser.publicKey
                : users.find((u) => u._id === msg.sender._id)?.publicKey;

              if (senderPublicKey) {
                const decryptedText = await decryptMessage(
                  msg.cipherText,
                  msg.nonce,
                  senderPublicKey,
                  privateKey
                );
                decrypted[msg._id] = decryptedText;
              }
            } catch (err) {
              console.error(`Failed to decrypt message ${msg._id}:`, err);
              decrypted[msg._id] = null; // mark as failed — don't leave undefined
            }
          }
        }
        setDecryptedMessages(decrypted);

        setTimeout(() => {
          markUnseenMessagesAsSeen(data.messages, data.conversation);
        }, 500);
      } catch (err) {
        console.error('Failed to load conversation:', err);
      }
    })();
  }, [selectedUser, privateKey, users]);

  // Socket: receive messages
  useEffect(() => {
    if (!socket || !privateKey || !users.length) return;

    const handleNewMessage = async (msg) => {
      try {
        let decryptedText = null;

        if (msg.cipherText && msg.nonce) {
          const senderIsMe = msg.sender._id === user._id;
          const senderPublicKey = senderIsMe
            ? selectedUser?.publicKey
            : users.find((u) => u._id === msg.sender._id)?.publicKey;

          if (senderPublicKey) {
            try {
              decryptedText = await decryptMessage(
                msg.cipherText,
                msg.nonce,
                senderPublicKey,
                privateKey
              );
            } catch (err) {
              console.error('Decryption failed for incoming message:', err);
            }
          }
        }

        const isInCurrentConversation =
          selectedUser &&
          (msg.sender._id === selectedUser._id ||
            msg.sender._id === user._id ||
            msg.recipients?.includes(selectedUser._id) ||
            msg.recipients?.includes(user._id));

        if (isInCurrentConversation) {
          setDecryptedMessages((prev) => ({
            ...prev,
            [msg._id]: decryptedText, // null if failed, string if success
          }));

          setMessages((prev) => {
            if (prev.find((m) => m._id === msg._id)) return prev;
            return [...prev, msg];
          });

          if (!shouldAutoScroll) {
            setNewMessageCount((prev) => prev + 1);
          }

          if (msg.sender._id === selectedUser._id && msg.status !== 'read') {
            setTimeout(() => {
              markMessageAsSeenLocally(msg._id);
              socket?.emit('markMessageSeen', {
                messageId: msg._id,
                conversationId: msg.conversation,
              });
            }, 500);
          }
        } else if (msg.sender._id !== user._id) {
          setUnreadCounts((prev) => ({
            ...prev,
            [msg.sender._id]: (prev[msg.sender._id] || 0) + 1,
          }));
        }
      } catch (err) {
        console.error('handleNewMessage error:', err);
      }
    };

    const handleTyping = ({ from, username }) => {
      setTypingUsers((prev) => ({ ...prev, [from]: username }));
      if (selectedUser && from === selectedUser._id) setTypingInfo(username);
    };

    const handleStopTyping = ({ from }) => {
      setTypingUsers((prev) => {
        const updated = { ...prev };
        delete updated[from];
        return updated;
      });
      if (selectedUser && from === selectedUser._id) setTypingInfo(null);
    };

    const handleMessageSeen = ({ messageId, seenBy, seenAt }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === messageId
            ? { ...msg, seenBy: [...(msg.seenBy || []), { user: seenBy, seenAt }], status: 'read' }
            : msg
        )
      );
    };

    socket.on('newMessage', handleNewMessage);
    socket.on('userTyping', handleTyping);
    socket.on('userStopTyping', handleStopTyping);
    socket.on('messageSeen', handleMessageSeen);

    return () => {
      socket.off('newMessage', handleNewMessage);
      socket.off('userTyping', handleTyping);
      socket.off('userStopTyping', handleStopTyping);
      socket.off('messageSeen', handleMessageSeen);
    };
  }, [socket, selectedUser, user._id, shouldAutoScroll, privateKey, users]);

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShouldAutoScroll(isAtBottom);
    if (isAtBottom) setNewMessageCount(0);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setNewMessageCount(0);
    setShouldAutoScroll(true);
  };

  useEffect(() => {
    if (!shouldAutoScroll) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingInfo, shouldAutoScroll]);

  useEffect(() => {
    setShouldAutoScroll(true);
    setNewMessageCount(0);
  }, [selectedUser]);

  const handleSelectUser = (u) => {
    setSelectedUser(u);
    setMessages([]);
    setDecryptedMessages({});
    setTypingInfo(null);
    setUnreadCounts((prev) => ({ ...prev, [u._id]: 0 }));
  };

  /**
   * FIX: getMessageText — safe fallback chain.
   *
   * Priority:
   *   1. Decrypted text from cache (string)
   *   2. Legacy content.text string (old messages)
   *   3. Placeholder string
   *
   * NEVER returns msg.content (the object) — that was the crash.
   */
  const getMessageText = (msg) => {
    // 1. Successfully decrypted
    const cached = decryptedMessages[msg._id];
    if (typeof cached === 'string' && cached.length > 0) {
      return cached;
    }

    // 2. Decryption was attempted but failed (null in cache) — show placeholder
    if (msg._id in decryptedMessages && cached === null) {
      return '[Unable to decrypt]';
    }

    // 3. Legacy plaintext message (content.text is a string)
    if (typeof msg.content?.text === 'string' && msg.content.text.length > 0) {
      return msg.content.text;
    }

    // 4. Final safe fallback — NEVER return msg.content (it's an object → crash)
    return '[Encrypted message]';
  };

  const markMessageAsSeenLocally = (messageId) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg._id === messageId && msg.sender._id !== user._id
          ? { ...msg, seenBy: [...(msg.seenBy || []), { user: user._id, seenAt: new Date() }], status: 'read' }
          : msg
      )
    );
  };

  const markUnseenMessagesAsSeen = (messagesToMark, conversationId) => {
    messagesToMark.forEach((msg) => {
      if (msg.sender._id !== user._id && msg.status !== 'read') {
        markMessageAsSeenLocally(msg._id);
        socket?.emit('markMessageSeen', { messageId: msg._id, conversationId });
      }
    });
  };

  const handleSend = async () => {
    if (!text.trim() || !selectedUser || !socket || !privateKey) {
      alert('Cannot send message. Please check your encryption keys.');
      return;
    }

    try {
      const { data: keyData } = await axios.get(`/api/users/${selectedUser._id}/public-key`);
      const recipientPublicKey = keyData.publicKey;

      const { cipherText, nonce } = await encryptMessage(text.trim(), recipientPublicKey, privateKey);

      socket.emit('sendMessage', { to: selectedUser._id, cipherText, nonce });

      setText('');
      socket.emit('stopTyping', { to: selectedUser._id });
    } catch (err) {
      console.error('Failed to send encrypted message:', err);
      alert('Failed to send message: ' + err.message);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTyping = (e) => {
    setText(e.target.value);
    if (!socket || !selectedUser) return;
    socket.emit('typing', { to: selectedUser._id });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stopTyping', { to: selectedUser._id });
    }, 1500);
  };

  // Group messages by date
  const groupedMessages = [];
  let lastDate = null;
  messages.forEach((msg) => {
    const dateLabel = formatDateLabel(msg.createdAt);
    if (dateLabel !== lastDate) {
      groupedMessages.push({ type: 'divider', label: dateLabel });
      lastDate = dateLabel;
    }
    groupedMessages.push({ type: 'msg', msg });
  });

  return (
    <div className="chat-layout" onClick={(e) => {
      if (e.target === e.currentTarget && menuOpen) setMenuOpen(false);
    }}>
      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}

      {/* Nav Sidebar */}
      <nav className="nav-sidebar">
        <div className="nav-logo">P.</div>
        <div className="nav-menu">
          <button className={`nav-btn ${activeNav === 'home' ? 'active' : ''}`} onClick={() => setActiveNav('home')} title="Home">
            <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
          </button>
          <button className={`nav-btn ${activeNav === 'messages' ? 'active' : ''}`} onClick={() => setActiveNav('messages')} title="Messages">
            <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
          </button>
          <button className={`nav-btn ${activeNav === 'settings' ? 'active' : ''}`} onClick={() => setActiveNav('settings')} title="Settings">
            <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l1.72-1.34c.15-.12.19-.34.1-.51l-1.63-2.83c-.12-.22-.37-.29-.59-.22l-2.03.81c-.42-.32-.88-.58-1.38-.77L14.4 2.1c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.3 2.34c-.5.19-.95.45-1.38.77l-2.03-.81c-.22-.09-.47 0-.59.22L2.74 7.13c-.1.16-.06.39.1.51l1.72 1.34c-.05.3-.07.62-.07.94s.02.64.07.94l-1.72 1.34c-.15.12-.19.34-.1.51l1.63 2.83c.12.22.37.29.59.22l2.03-.81c.42.32.88.58 1.38.77l.3 2.34c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.3-2.34c.5-.19.96-.45 1.38-.77l2.03.81c.22.09.47 0 .59-.22l1.63-2.83c.1-.16.06-.39-.1-.51l-1.72-1.34zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          </button>
        </div>
        <div className="nav-account">
          <button className="account-btn" title={user.username}>
            <div className="account-avatar">{getInitial(user.username)}</div>
          </button>
          <button className="logout-nav-btn" onClick={logout} title="Logout">
            <svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
          </button>
        </div>
      </nav>

      {/* Mobile toggle */}
      <div className="mobile-menu-toggle">
        <button className="hamburger-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          <span /><span /><span />
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">Pulse<span>.</span></div>
          <button className="logout-btn" onClick={logout}>logout</button>
        </div>
        <div className="sidebar-me">
          <div className="user-avatar" style={{ width: 28, height: 28, fontSize: 12 }}>
            {getInitial(user.username)}
          </div>
          <div>
            <div className="sidebar-me-label">You</div>
            <div className="sidebar-me-name">{user.username}</div>
          </div>
        </div>
        <div className="sidebar-section-label">Users ({users.length})</div>
        <div className="user-list">
          {users.map((u) => {
            const isOnline = onlineUsers.includes(u._id);
            const unreadCount = unreadCounts[u._id] || 0;
            const isTyping = typingUsers[u._id];
            return (
              <div
                key={u._id}
                className={`user-item ${selectedUser?._id === u._id ? 'active' : ''}`}
                onClick={() => { handleSelectUser(u); setMenuOpen(false); }}
              >
                <div className="user-avatar">
                  {getInitial(u.username)}
                  {isOnline && <div className="online-dot" />}
                </div>
                <div className="user-info">
                  <div className="user-name">{u.username}</div>
                  <div className={`user-status ${isOnline ? 'online' : ''}`}>
                    {isTyping ? <span className="typing-status">typing...</span> : isOnline ? 'online' : 'offline'}
                  </div>
                </div>
                {unreadCount > 0 && <div className="unread-badge">{unreadCount}</div>}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Chat Area */}
      <main className="chat-area">
        {!selectedUser ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <div className="chat-empty-text">Select a conversation</div>
            <div className="chat-empty-sub">Choose a user from the sidebar to start chatting</div>
          </div>
        ) : (
          <>
            <div className="chat-header">
              <div className="user-avatar">
                {getInitial(selectedUser.username)}
                {onlineUsers.includes(selectedUser._id) && <div className="online-dot" />}
              </div>
              <div className="chat-header-info">
                <div className="chat-header-name">{selectedUser.username}</div>
                <div className={`chat-header-status ${onlineUsers.includes(selectedUser._id) ? 'online' : ''}`}>
                  {onlineUsers.includes(selectedUser._id) ? '● online' : '○ offline'}
                </div>
              </div>
            </div>

            <div className="messages-area" ref={messagesContainerRef} onScroll={handleScroll}>
              {groupedMessages.map((item, i) =>
                item.type === 'divider' ? (
                  <div key={`div-${i}`} className="date-divider">{item.label}</div>
                ) : (
                  <div
                    key={item.msg._id}
                    className={`message-wrapper ${item.msg.sender._id === user._id ? 'out' : 'in'}`}
                  >
                    <div className="message-bubble">
                      {/* FIX: getMessageText() always returns a string — never an object */}
                      <div className="message-content">{getMessageText(item.msg)}</div>
                      <div className="message-footer">
                        <span className="message-time">{formatTime(item.msg.createdAt)}</span>
                        {item.msg.sender._id === user._id && (
                          <svg
                            className={`message-seen ${
                              item.msg.seenBy?.some(
                                (s) => s.user?._id === selectedUser._id || s.user === selectedUser._id
                              ) ? 'seen' : 'unseen'
                            }`}
                            viewBox="0 0 24 24"
                          >
                            <path d="M1 12l5 5 8-8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M9 12l5 5 8-8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>
                )
              )}
              {typingInfo && <div className="typing-indicator">{typingInfo} is typing...</div>}
              <div ref={messagesEndRef} />
            </div>

            {newMessageCount > 0 && (
              <button className="scroll-to-bottom-btn" onClick={scrollToBottom}>
                <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
                <span className="new-message-badge">{newMessageCount}</span>
              </button>
            )}

            <div className="chat-input-area">
              <textarea
                className="chat-input"
                placeholder={`Message ${selectedUser.username}...`}
                value={text}
                onChange={handleTyping}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <button className="send-btn" onClick={handleSend} disabled={!text.trim()}>
                <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}