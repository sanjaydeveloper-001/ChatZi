import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

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
  const { user, logout } = useAuth();
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
  const [activeNav, setActiveNav] = useState('messages'); // 'home', 'messages', 'settings'

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Load all users
  useEffect(() => {
    axios.get('/api/users').then(({ data }) => setUsers(data));
  }, []);

  // Load conversation
  useEffect(() => {
    if (!selectedUser) return;
    axios.get(`/api/messages/${selectedUser._id}`).then(({ data }) => {
      setMessages(data.messages);
      // Mark messages as seen when they become visible
      // Use Intersection Observer to detect when messages scroll into view
      setTimeout(() => {
        markUnseenMessagesAsSeen(data.messages, data.conversation);
      }, 500);
    });
  }, [selectedUser, socket, user._id]);

  // Socket: receive messages
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (msg) => {
      if (
        selectedUser &&
        (msg.sender._id === selectedUser._id || msg.sender._id === user._id ||
          msg.recipients.includes(selectedUser._id) || msg.recipients.includes(user._id))
      ) {
        setMessages((prev) => {
          // avoid duplicates
          if (prev.find((m) => m._id === msg._id)) return prev;
          return [...prev, msg];
        });
        // Increment new message counter if not at bottom
        if (!shouldAutoScroll) {
          setNewMessageCount((prev) => prev + 1);
        }
        // Mark message as seen if from other user
        if (msg.sender._id === selectedUser._id && msg.status !== 'read') {
          setTimeout(() => {
            // Mark locally
            markMessageAsSeenLocally(msg._id);
            // Notify sender
            socket?.emit('markMessageSeen', { messageId: msg._id, conversationId: msg.conversation });
          }, 500);
        }
      } else if (msg.sender._id !== user._id) {
        // If message is from a different user and not in current conversation, increment unread
        setUnreadCounts((prev) => ({
          ...prev,
          [msg.sender._id]: (prev[msg.sender._id] || 0) + 1,
        }));
      }
    };

    const handleTyping = ({ from, username }) => {
      // Update global typing status for sidebar
      setTypingUsers((prev) => ({
        ...prev,
        [from]: username,
      }));
      // Also update current conversation typing if applicable
      if (selectedUser && from === selectedUser._id) {
        setTypingInfo(username);
      }
    };

    const handleStopTyping = ({ from }) => {
      // Remove from global typing status
      setTypingUsers((prev) => {
        const updated = { ...prev };
        delete updated[from];
        return updated;
      });
      // Also update current conversation typing if applicable
      if (selectedUser && from === selectedUser._id) {
        setTypingInfo(null);
      }
    };

    const handleMessageSeen = ({ messageId, seenBy, seenAt }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === messageId
            ? {
                ...msg,
                seenBy: [...(msg.seenBy || []), { user: seenBy, seenAt }],
                status: 'read',
              }
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
  }, [socket, selectedUser, user._id, shouldAutoScroll]);

  // Handle manual scroll - detect if user is at bottom
  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    // If user is within 100px of the bottom, enable auto-scroll
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShouldAutoScroll(isAtBottom);
    // Reset new message counter when user scrolls to bottom
    if (isAtBottom) {
      setNewMessageCount(0);
    }
  };

  // Scroll to bottom and reset counter
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setNewMessageCount(0);
    setShouldAutoScroll(true);
  };

  // Auto-scroll only when at bottom
  useEffect(() => {
    if (!shouldAutoScroll) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingInfo, shouldAutoScroll]);

  // Reset auto-scroll and message counter when switching conversations
  useEffect(() => {
    setShouldAutoScroll(true);
    setNewMessageCount(0);
  }, [selectedUser]);

  const handleSelectUser = (u) => {
    setSelectedUser(u);
    setMessages([]);
    setTypingInfo(null);
    // Clear unread count for this user
    setUnreadCounts((prev) => ({
      ...prev,
      [u._id]: 0,
    }));
  };

  // Helper function to mark a message as seen
  const markMessageAsSeenLocally = (messageId) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg._id === messageId && msg.sender._id !== user._id
          ? {
              ...msg,
              seenBy: [...(msg.seenBy || []), { user: user._id, seenAt: new Date() }],
              status: 'read',
            }
          : msg
      )
    );
  };

  // Helper function to mark unseen messages from other user as seen
  const markUnseenMessagesAsSeen = (messagesToMark, conversationId) => {
    messagesToMark.forEach((msg) => {
      // Only mark messages from other user that haven't been seen by current user
      if (msg.sender._id !== user._id && msg.status !== 'read') {
        markMessageAsSeenLocally(msg._id);
        // Notify sender
        socket?.emit('markMessageSeen', { messageId: msg._id, conversationId });
      }
    });
  };

  const handleSend = () => {
    if (!text.trim() || !selectedUser || !socket) return;
    socket.emit('sendMessage', { to: selectedUser._id, content: text.trim() });
    setText('');
    socket.emit('stopTyping', { to: selectedUser._id });
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

  // Group messages by date for dividers
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
      if (e.target === e.currentTarget && menuOpen) {
        setMenuOpen(false);
      }
    }}>
      {/* Backdrop Overlay */}
      {menuOpen && (
        <div 
          className="menu-backdrop" 
          onClick={() => setMenuOpen(false)}
        ></div>
      )}

      {/* Hamburger Menu for Mobile */}
      <div className="mobile-menu-toggle">
        <button 
          className="hamburger-btn" 
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>

      {/* Navigation Sidebar */}
      <nav className="nav-sidebar">
        <div className="nav-logo">P.</div>
        
        <div className="nav-menu">
          <button 
            className={`nav-btn ${activeNav === 'home' ? 'active' : ''}`}
            onClick={() => setActiveNav('home')}
            title="Home"
          >
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
            </svg>
          </button>

          <button 
            className={`nav-btn ${activeNav === 'messages' ? 'active' : ''}`}
            onClick={() => setActiveNav('messages')}
            title="Messages"
          >
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
          </button>

          <button 
            className={`nav-btn ${activeNav === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveNav('settings')}
            title="Settings"
          >
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l1.72-1.34c.15-.12.19-.34.1-.51l-1.63-2.83c-.12-.22-.37-.29-.59-.22l-2.03.81c-.42-.32-.88-.58-1.38-.77L14.4 2.1c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.3 2.34c-.5.19-.95.45-1.38.77l-2.03-.81c-.22-.09-.47 0-.59.22L2.74 7.13c-.1.16-.06.39.1.51l1.72 1.34c-.05.3-.07.62-.07.94s.02.64.07.94l-1.72 1.34c-.15.12-.19.34-.1.51l1.63 2.83c.12.22.37.29.59.22l2.03-.81c.42.32.88.58 1.38.77l.3 2.34c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.3-2.34c.5-.19.96-.45 1.38-.77l2.03.81c.22.09.47 0 .59-.22l1.63-2.83c.1-.16.06-.39-.1-.51l-1.72-1.34zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </button>
        </div>

        {/* Account Bar at Bottom */}
        <div className="nav-account">
          <button 
            className="account-btn"
            title={user.username}
          >
            <div className="account-avatar">{getInitial(user.username)}</div>
          </button>
          <button className="logout-nav-btn" onClick={logout} title="Logout">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
            </svg>
          </button>
        </div>
      </nav>

      {/* Hamburger Menu for Mobile */}
      <div className="mobile-menu-toggle">
        <button 
          className="hamburger-btn" 
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          <span></span>
          <span></span>
          <span></span>
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
                onClick={() => {
                  handleSelectUser(u);
                  setMenuOpen(false);
                }}
              >
                <div className="user-avatar">
                  {getInitial(u.username)}
                  {isOnline && <div className="online-dot" />}
                </div>
                <div className="user-info">
                  <div className="user-name">{u.username}</div>
                  <div className={`user-status ${isOnline ? 'online' : ''}`}>
                    {isTyping ? (
                      <span className="typing-status">typing...</span>
                    ) : (
                      isOnline ? 'online' : 'offline'
                    )}
                  </div>
                </div>
                {unreadCount > 0 && (
                  <div className="unread-badge">{unreadCount}</div>
                )}
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
            {/* Chat Header */}
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

            {/* Messages */}
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
                      <div className="message-content">{item.msg.content?.text || item.msg.content}</div>
                      <div className="message-footer">
                        <span className="message-time">{formatTime(item.msg.createdAt)}</span>
                        {item.msg.sender._id === user._id && (
                          <svg className={`message-seen ${item.msg.seenBy?.some(s => s.user?._id === selectedUser._id || s.user === selectedUser._id) ? 'seen' : 'unseen'}`} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M1 12l5 5 8-8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M9 12l5 5 8-8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>
                )
              )}

              {typingInfo && (
                <div className="typing-indicator">{typingInfo} is typing...</div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Scroll to bottom button */}
            {newMessageCount > 0 && (
              <button className="scroll-to-bottom-btn" onClick={scrollToBottom}>
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7 10l5 5 5-5z" />
                </svg>
                <span className="new-message-badge">{newMessageCount}</span>
              </button>
            )}

            {/* Input */}
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
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}