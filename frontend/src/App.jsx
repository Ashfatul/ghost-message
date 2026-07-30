import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  generateKey, 
  importKey, 
  encryptText, 
  decryptText, 
  encryptFile, 
  decryptFile 
} from './utils/crypto';

// Default list of random hacker/phantom nicknames
const defaultGhostNames = ["Ghost", "Phantom", "Specter", "Wraith", "Apparition", "Shadow", "Spook", "Spirit", "Banshee", "Cryptic", "Cipher"];

const generateRandomGhostName = () => {
  const name = defaultGhostNames[Math.floor(Math.random() * defaultGhostNames.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${name}_${num}`;
};

const avatars = ["👽", "👻", "🤖", "🎃", "👾", "🤡", "👹", "👺", "💀", "😺", "🦊", "🐉", "🦉", "🦄"];
export const getAvatarForSocket = (socketId) => {
  if (!socketId) return "👻";
  let hash = 0;
  for (let i = 0; i < socketId.length; i++) {
    hash = socketId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatars[Math.abs(hash) % avatars.length];
};


// Sub-component for individual message bubbles handling E2EE self-destruction
function MessageBubble({ msg, isGrouped, onDestroy, onImageClick, isImageFile, onReply }) {
  const [timeLeft, setTimeLeft] = useState(msg.selfDestruct || null);
  const [isExpiring, setIsExpiring] = useState(false);
  const [showTime, setShowTime] = useState(false);

  useEffect(() => {
    if (!msg.selfDestruct) return;

    // Determine initial time left based on timestamp
    const elapsedSeconds = Math.floor((Date.now() - new Date(msg.timestamp).getTime()) / 1000);
    const initialTimeLeft = Math.max(0, msg.selfDestruct - elapsedSeconds);
    setTimeLeft(initialTimeLeft);

    if (initialTimeLeft <= 0) {
      setIsExpiring(true);
      const destroyTimeout = setTimeout(() => {
        onDestroy();
      }, 500);
      return () => clearTimeout(destroyTimeout);
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setIsExpiring(true);
          setTimeout(() => {
            onDestroy();
          }, 500);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [msg.selfDestruct, msg.timestamp, onDestroy]);

  const formatTimeLeft = (sec) => {
    if (sec >= 3600) return `${Math.ceil(sec / 3600)}h`;
    if (sec >= 60) return `${Math.ceil(sec / 60)}m`;
    return `${sec}s`;
  };

  return (
    <div className={`message-bubble-wrapper ${msg.isSelf ? 'self' : 'peer'} ${isExpiring ? 'dissolving' : ''} ${isGrouped ? 'grouped' : ''}`}>
      {!isGrouped && (
        <div className="message-meta">
          <span className="message-sender-avatar">{getAvatarForSocket(msg.senderId)}</span>
          <span className="message-sender">{msg.isSelf ? 'You' : msg.senderName}</span>
        </div>
      )}
      <div className="message-row">
        {msg.isSelf && (
          <button 
            className="btn-reply-bubble" 
            onClick={onReply}
            title="Reply to this message"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
            </svg>
          </button>
        )}
        <div 
          className="message-bubble"
          onClick={() => setShowTime(!showTime)}
          style={{ cursor: 'pointer' }}
          title="Click to show/hide timestamp"
        >
          {msg.selfDestruct && timeLeft !== null && (
            <div 
              className="self-destruct-progress-bar" 
              style={{ width: `${(timeLeft / msg.selfDestruct) * 100}%` }}
            />
          )}

          {msg.replyTo && (
            <div className="message-reply-quote">
              <span className="reply-quote-sender">
                {getAvatarForSocket(msg.replyTo.senderId)} {msg.replyTo.senderName}
              </span>
              <span className="reply-quote-text">{msg.replyTo.text}</span>
            </div>
          )}
          
          <div className="message-bubble-body">
            <div className="message-text">
              {msg.text}
              {showTime && (
                <span className="message-time-inline">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>

            {msg.selfDestruct && timeLeft !== null && (
              <span className="self-destruct-indicator-inside" title="Self-destructing message">
                {formatTimeLeft(timeLeft)}
              </span>
            )}
          </div>

          {msg.file && (
            isImageFile(msg.file.type) ? (
              <div 
                className="encrypted-image-preview"
                onClick={(e) => {
                  e.stopPropagation();
                  onImageClick(msg.file.url, msg.file.name);
                }}
              >
                <img src={msg.file.url} alt={msg.file.name} />
              </div>
            ) : (
              <div className="file-attachment-card" onClick={(e) => e.stopPropagation()}>
                <span className="file-icon">📁</span>
                <div className="file-info">
                  <div className="file-name" title={msg.file.name}>{msg.file.name}</div>
                  <div className="file-size">{msg.file.type || 'Binary file'}</div>
                </div>
                <a 
                  href={msg.file.url} 
                  download={msg.file.name} 
                  className="btn-download"
                >
                  Download
                </a>
              </div>
            )
          )}
        </div>

        {!msg.isSelf && (
          <button 
            className="btn-reply-bubble" 
            onClick={onReply}
            title="Reply to this message"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function App() {
  // Navigation states
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  
  // Parse current room information
  const roomPathMatch = currentPath.match(/^\/room\/([^\/]+)/);
  const roomId = roomPathMatch ? roomPathMatch[1] : null;
  const encryptionKeyB64 = currentHash.startsWith('#') ? currentHash.slice(1) : '';
  
  // App states
  const [nickname, setNickname] = useState(() => {
    return localStorage.getItem('ghost_nickname') || generateRandomGhostName();
  });
  const [hasJoined, setHasJoined] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // 'connecting', 'connected', 'disconnected'
  
  // Chat states
  const [roomUsers, setRoomUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [typingUsers, setTypingUsers] = useState({}); // socketId -> nickname
  
  // UI states
  const [copySuccess, setCopySuccess] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [destructTimeInput, setDestructTimeInput] = useState(() => {
    return localStorage.getItem('ghost_destruct_time') || '30';
  });
  const [isCreator, setIsCreator] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('ghost_sound_enabled') !== 'false';
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [replyingTo, setReplyingTo] = useState(null);
  
  // Refs
  const socketRef = useRef(null);
  const cryptoKeyRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  const objectUrlsRef = useRef([]);
  const roomUsersRef = useRef([]);
  const prevMessagesCountRef = useRef(0);
  const textareaRef = useRef(null);
  
  const destructTimeInputRef = useRef(destructTimeInput);

  // Sync state changes with localStorage and refs
  useEffect(() => {
    localStorage.setItem('ghost_destruct_time', destructTimeInput);
    destructTimeInputRef.current = destructTimeInput;
  }, [destructTimeInput]);

  useEffect(() => {
    localStorage.setItem('ghost_sound_enabled', String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    roomUsersRef.current = roomUsers;
  }, [roomUsers]);

  // Handle unread count resets when window is focused
  useEffect(() => {
    const handleFocus = () => {
      setUnreadCount(0);
    };
    window.addEventListener('focus', handleFocus);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setUnreadCount(0);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Update window title with unread indicator
  useEffect(() => {
    if (roomId && hasJoined) {
      if (unreadCount > 0) {
        document.title = `(${unreadCount}) 👻 Ghost Chat`;
      } else {
        document.title = '👻 Ghost Chat';
      }
    } else {
      document.title = 'Ghost Message - E2EE Chat';
    }
  }, [unreadCount, roomId, hasJoined]);

  // Web Audio chime generator to play message notification sound
  const playNotificationSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } catch (e) {
      console.error("Failed to play sound:", e);
    }
  };

  const deleteMessage = (id) => {
    setMessages((prev) => prev.filter(m => m.id !== id));
  };

  // Room information parsed at the top

  // Synchronize browser history / URL updates
  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
      setCurrentHash(window.location.hash);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);



  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, []);

  // In column-reverse layout, the browser naturally anchors to the bottom.
  // We no longer need manual scrollIntoView calls.

  // Navigate helper
  const navigate = (path, hash = '') => {
    window.history.pushState(null, '', `${path}${hash}`);
    setCurrentPath(path);
    setCurrentHash(hash);
  };

  // Socket Connection and Event Handling
  useEffect(() => {
    // Only connect if user entered room and nickname is finalized
    if (!roomId || !encryptionKeyB64 || !hasJoined) {
      // Clean up previous connection if any
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnectionStatus('disconnected');
      }
      return;
    }

    setConnectionStatus('connecting');

    const initConnection = async () => {
      try {
        // Request HTML5 notification permission if not asked
        if (window.Notification && Notification.permission === 'default') {
          Notification.requestPermission();
        }

        // 1. Import E2EE encryption key
        cryptoKeyRef.current = await importKey(encryptionKeyB64);
        
        // 2. Encrypt our nickname
        const encNamePayload = await encryptText(nickname, cryptoKeyRef.current);
        
        // 3. Connect to the signaling socket server
        const socket = io(window.location.origin, {
          transports: ['websocket'],
          reconnectionAttempts: 5,
          timeout: 10000
        });
        
        socketRef.current = socket;

        // 4. Setup listeners
        socket.on('connect', () => {
          setConnectionStatus('connected');
          
          // Send join signal with creator status checking from sessionStorage
          socket.emit('join-room', {
            roomId,
            encryptedUsername: encNamePayload,
            isCreator: sessionStorage.getItem(`creator_${roomId}`) === 'true'
          });
        });

        socket.on('connect_error', () => {
          setConnectionStatus('disconnected');
        });

        socket.on('disconnect', () => {
          setConnectionStatus('disconnected');
        });

        // Handle room configuration information from server
        socket.on('room-info', ({ isCreator: serverIsCreator, selfDestruct }) => {
          if (serverIsCreator) {
            sessionStorage.setItem(`creator_${roomId}`, 'true');
            setIsCreator(true);
          }
          if (selfDestruct !== undefined) {
            setDestructTimeInput(selfDestruct === null ? '' : String(selfDestruct));
          }
        });

        // Handle setting updates broadcasted from creator
        socket.on('settings-updated', ({ selfDestruct }) => {
          setDestructTimeInput(selfDestruct === null ? '' : String(selfDestruct));
        });

        // Handle user list updates
        socket.on('room-users', async (userList) => {
          const decryptedList = await Promise.all(
            userList.map(async (u) => {
              try {
                if (u.socketId === socket.id) {
                  return { socketId: u.socketId, nickname: nickname };
                }
                const decName = await decryptText(
                  u.encryptedUsername.iv,
                  u.encryptedUsername.ciphertext,
                  cryptoKeyRef.current
                );
                return { socketId: u.socketId, nickname: decName };
              } catch (err) {
                return { socketId: u.socketId, nickname: "Anonymous Peer" };
              }
            })
          );
          setRoomUsers(decryptedList);
        });

        // Handle new peer joining
        socket.on('peer-joined', async ({ socketId, encryptedUsername }) => {
          try {
            const decName = await decryptText(
              encryptedUsername.iv,
              encryptedUsername.ciphertext,
              cryptoKeyRef.current
            );
            
            setMessages((prev) => [...prev, {
              id: Math.random().toString(36).substring(2, 9),
              type: 'system',
              text: `👻 ${decName} joined the secure channel.`,
              timestamp: new Date().toISOString()
            }]);
          } catch (err) {
            console.error("Decryption error on peer join:", err);
          }
        });

        // Handle peer leaving (uses roomUsersRef to ensure nickname resolves correctly)
        socket.on('peer-left', ({ socketId }) => {
          const peer = roomUsersRef.current.find(u => u.socketId === socketId);
          const peerName = peer ? peer.nickname : "A peer";
          
          setMessages((prev) => [...prev, {
            id: Math.random().toString(36).substring(2, 9),
            type: 'system',
            text: `💤 ${peerName} disconnected.`,
            timestamp: new Date().toISOString()
          }]);
          
          setRoomUsers((prev) => prev.filter(u => u.socketId !== socketId));
          
          // Clear typing status if they were typing
          setTypingUsers((prev) => {
            const next = { ...prev };
            delete next[socketId];
            return next;
          });
        });

        // Handle typing state
        socket.on('peer-typing', ({ senderId, isTyping }) => {
          setRoomUsers((currentUsers) => {
            const peer = currentUsers.find(u => u.socketId === senderId);
            if (!peer) return currentUsers;
            
            setTypingUsers((prev) => {
              const next = { ...prev };
              if (isTyping) {
                next[senderId] = peer.nickname;
              } else {
                delete next[senderId];
              }
              return next;
            });
            
            return currentUsers;
          });
        });

        // Handle message receipt
        socket.on('receive-message', async ({ senderId, encryptedPayload }) => {
          try {
            // Decrypt the payload
            const payloadStr = await decryptText(
              encryptedPayload.iv,
              encryptedPayload.ciphertext,
              cryptoKeyRef.current
            );
            
            const payload = JSON.parse(payloadStr);
            
            let fileInfo = null;
            if (payload.type === 'file' && payload.file) {
              const decrypted = await decryptFile(
                payload.file.iv,
                payload.file.ciphertext,
                cryptoKeyRef.current
              );
              
              fileInfo = {
                name: decrypted.name,
                type: decrypted.type,
                url: decrypted.url
              };
              
              // Keep track of decrypted file URL to revoke later
              objectUrlsRef.current.push(decrypted.url);
            }
            
            // Push Notification & Sound Logic
            if (document.visibilityState !== 'visible' || !document.hasFocus()) {
              setUnreadCount((prev) => prev + 1);
              if (window.Notification && Notification.permission === 'granted') {
                const notification = new Notification(`💬 New Message from ${payload.senderName || 'Anonymous'}`, {
                  body: payload.text || (payload.file ? '📁 Shared a secure file' : ''),
                });
                notification.onclick = () => {
                  window.focus();
                  notification.close();
                };
              }
            }

            if (localStorage.getItem('ghost_sound_enabled') !== 'false') {
              playNotificationSound();
            }

            setMessages((prev) => [...prev, {
              id: Math.random().toString(36).substring(2, 9),
              senderId,
              senderName: payload.senderName || 'Anonymous',
              type: payload.type,
              text: payload.text,
              file: fileInfo,
              timestamp: payload.timestamp || new Date().toISOString(),
              selfDestruct: payload.selfDestruct || null,
              isSelf: false,
              replyTo: payload.replyTo || null
            }]);
          } catch (err) {
            console.error("Message decryption failed:", err);
            setMessages((prev) => [...prev, {
              id: Math.random().toString(36).substring(2, 9),
              type: 'system',
              text: '⚠️ Received an undecryptable message (encryption key mismatch).',
              timestamp: new Date().toISOString()
            }]);
          }
        });

      } catch (err) {
        console.error("Initialization error:", err);
        setConnectionStatus('disconnected');
      }
    };

    initConnection();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setRoomUsers([]);
      setMessages([]);
      setTypingUsers({});
      isTypingRef.current = false;
    };
  }, [roomId, encryptionKeyB64, hasJoined]);

  // Action: Create Secure Room
  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    
    // Save nickname
    localStorage.setItem('ghost_nickname', nickname);
    
    // Generate secure keys
    const randomRoomId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    const key = await generateKey();
    
    // Setup creator in sessionStorage and local state
    sessionStorage.setItem(`creator_${randomRoomId}`, 'true');
    setIsCreator(true);
    
    navigate(`/room/${randomRoomId}`, `#${key}`);
    setHasJoined(true);
  };

  // Action: Join existing room
  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    
    localStorage.setItem('ghost_nickname', nickname);
    // Sync local isCreator state from sessionStorage if they had opened/created it in the same tab session
    setIsCreator(sessionStorage.getItem(`creator_${roomId}`) === 'true');
    setHasJoined(true);
  };

  // Action: Copy room link
  const handleCopyLink = () => {
    const fullUrl = window.location.href;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  };

  // Action: Leaving room
  const handleLeaveRoom = () => {
    if (socketRef.current) {
      socketRef.current.emit('leave-room');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setHasJoined(false);
    navigate('/');
  };

  // Trigger typing notification
  const handleInputChange = (e) => {
    setInputText(e.target.value);
    
    // Auto-adjust textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(120, textareaRef.current.scrollHeight)}px`;
    }

    if (!socketRef.current || connectionStatus !== 'connected') return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socketRef.current.emit('typing', { roomId, isTyping: true });
    }

    // Debounce: clear typing after 1.5 seconds of silence
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      socketRef.current.emit('typing', { roomId, isTyping: false });
    }, 1500);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  // Action: Send Message (Text & File)
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if ((!inputText.trim() && !attachment) || connectionStatus !== 'connected') return;

    // Reset typing state immediately
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    isTypingRef.current = false;
    socketRef.current.emit('typing', { roomId, isTyping: false });

    setFileUploading(true);

    const activeTimer = parseInt(destructTimeInput) || null;

    try {
      const payload = {
        senderName: nickname,
        timestamp: new Date().toISOString(),
        selfDestruct: activeTimer,
        replyTo: replyingTo ? {
          id: replyingTo.id,
          senderId: replyingTo.senderId,
          senderName: replyingTo.senderName,
          text: replyingTo.text
        } : null
      };

      let localFileInfo = null;

      if (attachment) {
        // Encrypt file using Web Crypto API
        const encryptedFilePayload = await encryptFile(attachment, cryptoKeyRef.current);
        
        payload.type = 'file';
        payload.text = inputText.trim() || `Shared file: ${attachment.name}`;
        payload.file = encryptedFilePayload;

        const fileUrl = URL.createObjectURL(attachment);
        objectUrlsRef.current.push(fileUrl);

        localFileInfo = {
          name: attachment.name,
          type: attachment.type,
          url: fileUrl
        };
      } else {
        payload.type = 'text';
        payload.text = inputText.trim();
      }

      // Encrypt full message payload
      const encryptedMsgPayload = await encryptText(JSON.stringify(payload), cryptoKeyRef.current);

      // Emit to server
      socketRef.current.emit('send-message', {
        roomId,
        encryptedPayload: encryptedMsgPayload
      });

      // Add to local message history
      setMessages((prev) => [...prev, {
        id: Math.random().toString(36).substring(2, 9),
        senderId: socketRef.current.id,
        senderName: nickname,
        type: payload.type,
        text: payload.text,
        file: localFileInfo,
        timestamp: payload.timestamp,
        selfDestruct: activeTimer,
        isSelf: true,
        replyTo: payload.replyTo || null
      }]);

      // Clear input form and replyingTo state
      setInputText('');
      setAttachment(null);
      setReplyingTo(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

    } catch (err) {
      console.error("Failed to encrypt and send message:", err);
      alert("Failed to secure and encrypt message. Please check connection.");
    } finally {
      setFileUploading(false);
    }
  };

  // Action: Focus text input on reply click
  const handleReplyClick = (msg) => {
    setReplyingTo(msg);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Handle file input selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // 5MB limit check
    if (file.size > 5 * 1024 * 1024) {
      alert("Security Limit: Ephemeral files are capped at 5MB to guarantee instant memory-safe transfer.");
      return;
    }
    setAttachment(file);
  };

  // Remove selected file attachment
  const handleRemoveAttachment = () => {
    setAttachment(null);
  };

  // Check if file is image for preview
  const isImageFile = (type) => {
    return type && type.startsWith('image/');
  };

  // Format File Size
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Render: Lobby Screen
  const renderLobby = () => {
    return (
      <div className="lobby-container">
        <div className="lobby-card">
          <div className="brand-header">
            <div className="ghost-logo">👻</div>
            <h1 className="brand-name">Ghost Message</h1>
            <p className="brand-tagline">100% Zero-Knowledge Ephemeral Communication</p>
          </div>

          <div className="features-list">
            <div className="feature-item">
              <div className="feature-icon">🔒</div>
              <div className="feature-text">
                <h4>End-to-End Encrypted</h4>
                <p>Web Crypto AES-256-GCM. The key is in your URL hash and is never sent to the server.</p>
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon">☁️</div>
              <div className="feature-text">
                <h4>No Logs, No Data</h4>
                <p>Pure memory relay. Sockets forward messages and discard them. Zero persistent storage.</p>
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon">📱</div>
              <div className="feature-text">
                <h4>Privacy First Design</h4>
                <p>No phone numbers, no emails, no IP trackers. Close the tab to destroy your session history.</p>
              </div>
            </div>
          </div>

          <form className="setup-form" onSubmit={handleCreateRoom}>
            <div className="input-group">
              <label className="input-label" htmlFor="lobby-nick">Your Nickname</label>
              <input
                id="lobby-nick"
                className="custom-input"
                type="text"
                placeholder="E.g., CryptoGhost"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                required
              />
            </div>
            <button className="btn-primary" type="submit">
              ✨ Create Secure Channel
            </button>
          </form>
        </div>
      </div>
    );
  };

  // Render: Room Join Gate
  const renderJoinGate = () => {
    return (
      <div className="lobby-container">
        <div className="lobby-card">
          <div className="brand-header">
            <div className="ghost-logo">👁️‍🗨️</div>
            <h1 className="brand-name">Enter Secure Channel</h1>
            <p className="brand-tagline">You have been invited to a private encrypted chat room</p>
          </div>

          <div className="features-list">
            <div className="feature-item">
              <div className="feature-icon">🔐</div>
              <div className="feature-text">
                <h4>Verification Confirmed</h4>
                <p>URL hash key detected. Browser is ready to perform local end-to-end decryption.</p>
              </div>
            </div>
          </div>

          <form className="setup-form" onSubmit={handleJoinRoom}>
            <div className="input-group">
              <label className="input-label" htmlFor="join-nick">Your Chat Nickname</label>
              <input
                id="join-nick"
                className="custom-input"
                type="text"
                placeholder="E.g., GuestGhost"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                required
              />
            </div>
            <button className="btn-primary btn-accent" type="submit">
              🛡️ Join Securely
            </button>
          </form>
        </div>
      </div>
    );
  };

  // Render: Main Chat Panel
  const renderChat = () => {
    const isConnected = connectionStatus === 'connected';
    
    // Compile typing text
    const typingList = Object.values(typingUsers);
    let typingText = '';
    if (typingList.length === 1) {
      typingText = `${typingList[0]} is typing`;
    } else if (typingList.length > 1) {
      typingText = `${typingList.length} peers are typing`;
    }

    return (
      <div className="chat-wrapper">
        {/* Mobile sidebar drawer overlay */}
        <div 
          className={`sidebar-overlay ${mobileSidebarOpen ? 'open' : ''}`} 
          onClick={() => setMobileSidebarOpen(false)}
        />

        {/* Sidebar */}
        <div className={`chat-sidebar ${mobileSidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <div className="sidebar-logo">👻</div>
            <div className="sidebar-title">
              <h2>Ghost Message</h2>
              <span>
                <span className={`pulse-dot ${isConnected ? '' : 'disconnected'}`}></span>
                {connectionStatus === 'connected' ? 'SECURE CHANNEL ACTIVE' : 
                 connectionStatus === 'connecting' ? 'ESTABLISHING HANDSHAKE' : 'DISCONNECTED'}
              </span>
            </div>
          </div>

          <div className="user-list-section">
            <h3>
              Active Peers
              <span className="user-count-badge">{roomUsers.length}</span>
            </h3>
            <div className="user-list-scroll">
              {[...roomUsers]
                .sort((a, b) => {
                  if (a.socketId === socketRef.current?.id) return -1;
                  if (b.socketId === socketRef.current?.id) return 1;
                  return a.nickname.localeCompare(b.nickname);
                })
                .map((user) => (
                  <div 
                    key={user.socketId} 
                    className={`user-list-item ${user.socketId === socketRef.current?.id ? 'self' : ''}`}
                  >
                    <span className="user-avatar-icon">{getAvatarForSocket(user.socketId)}</span>
                    <span>{user.nickname}</span>
                  </div>
                ))
              }
            </div>
          </div>

          <div className="room-link-card">
            <h3>Invite Peer</h3>
            <div className="room-link-box">
              <input 
                className="room-link-input" 
                type="text" 
                value={window.location.href} 
                readOnly 
              />
              <button 
                className={`btn-icon ${copySuccess ? 'copied' : ''}`}
                onClick={handleCopyLink}
                title="Copy Room Link"
              >
                {copySuccess ? '✓' : '🔗'}
              </button>
            </div>
          </div>

          {/* E2EE Ephemeral Self-Destruct & Sound Settings */}
          <div className="room-link-card security-settings-card">
            <h3>🛡️ Settings</h3>
            {isCreator ? (
              <div className="sidebar-field-group">
                <label className="input-label" htmlFor="destruct-time-input">Self-Destruct (seconds)</label>
                <input 
                  id="destruct-time-input"
                  className="custom-input sidebar-input" 
                  type="number" 
                  min="0"
                  placeholder="0 to disable (Never)"
                  value={destructTimeInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDestructTimeInput(val);
                    if (socketRef.current && connectionStatus === 'connected') {
                      socketRef.current.emit('update-settings', {
                        roomId,
                        selfDestruct: val === '' ? null : parseInt(val)
                      });
                    }
                  }}
                />
              </div>
            ) : (
              <div className="sidebar-field-group">
                <span className="input-label">Self-Destruct (Set by Creator)</span>
                <div className="destruct-status-badge">
                  {destructTimeInput && parseInt(destructTimeInput) > 0 ? (
                    <span>⏱️ Auto-delete: {destructTimeInput}s</span>
                  ) : (
                    <span>🔓 Auto-delete: Off</span>
                  )}
                </div>
              </div>
            )}
            
            <div className="sidebar-field-group" style={{ marginTop: '0.5rem' }}>
              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={soundEnabled} 
                  onChange={(e) => setSoundEnabled(e.target.checked)} 
                />
                <span>Notification Sound</span>
              </label>
            </div>
          </div>

          <div className="sidebar-footer">
            <button className="btn-secondary btn-leave" onClick={handleLeaveRoom}>
              🚪 Leave Room
            </button>
          </div>
        </div>

        {/* Main Chat Feed */}
        <div className="chat-main">
          {/* Mobile Header */}
          <div className="chat-header-mobile">
            <button className="btn-icon" onClick={() => setMobileSidebarOpen(true)}>
              ☰
            </button>
            <div className="room-title">👻 Ghost Chat</div>
            <button className="btn-icon btn-leave" onClick={handleLeaveRoom}>
              🚪
            </button>
          </div>

          {/* Messages List */}
          <div className="messages-feed">
            {messages.length === 0 ? (
              <div className="chat-empty">
                <div className="chat-empty-icon">🔒</div>
                <h3>E2EE Chat Room Opened</h3>
                <p>Share the secure link above with a peer to begin chatting anonymously. All messages are encrypted locally.</p>
              </div>
            ) : (
              [...messages].reverse().map((msg, revIndex, arr) => {
                const originalIndex = arr.length - 1 - revIndex;
                if (msg.type === 'system') {
                  return (
                    <div key={msg.id} className="message-system">
                      {msg.text}
                    </div>
                  );
                }

                // Group successive messages from the same sender within 2 minutes
                const prevMsg = originalIndex > 0 ? messages[originalIndex - 1] : null;
                const isGrouped = prevMsg && 
                                  prevMsg.type !== 'system' && 
                                  prevMsg.senderId === msg.senderId &&
                                  (new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) < 120000;

                return (
                  <MessageBubble 
                    key={msg.id} 
                    msg={msg} 
                    isGrouped={isGrouped}
                    onDestroy={() => deleteMessage(msg.id)} 
                    onImageClick={(url, name) => setLightboxImage({ url, name })}
                    isImageFile={isImageFile}
                    onReply={() => handleReplyClick(msg)}
                  />
                );
              })
            )}
          </div>

          {/* Typing status bar */}
          <div className="typing-status-indicator">
            {typingText && (
              <>
                {typingText}
                <div className="typing-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </>
            )}
          </div>

          {/* Form input */}
          <div className="chat-input-area">
            {replyingTo && (
              <div className="reply-preview-bar">
                <div className="reply-info">
                  <span className="reply-icon">↩️ Replying to <strong>{replyingTo.isSelf ? 'You' : replyingTo.senderName}</strong></span>
                  <span className="reply-text">{getAvatarForSocket(replyingTo.senderId)} {replyingTo.text}</span>
                </div>
                <button 
                  className="btn-remove-reply"
                  onClick={() => setReplyingTo(null)}
                  title="Cancel reply"
                >
                  ✕
                </button>
              </div>
            )}

            {attachment && (
              <div className={`attachment-preview-bar ${fileUploading ? '' : 'success'}`}>
                <div className="attachment-info">
                  <span className="file-icon">📎</span>
                  <span className="attachment-name">{attachment.name}</span>
                  <span className="file-size">({formatBytes(attachment.size)})</span>
                </div>
                {!fileUploading && (
                  <button 
                    className="btn-remove-attachment"
                    onClick={handleRemoveAttachment}
                    title="Remove attachment"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            <form className="input-form" onSubmit={handleSendMessage}>
              <div className="input-bar-container">
                {/* Secret File Attach Input */}
                <label 
                  className={`btn-attach ${attachment ? 'has-file' : ''} ${fileUploading ? 'disabled' : ''}`}
                  htmlFor="file-attach-input"
                  title="Attach Encrypted File (Max 5MB)"
                >
                  📎
                </label>
                <input 
                  id="file-attach-input"
                  type="file"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                  disabled={fileUploading || !isConnected}
                />

                <textarea
                  ref={textareaRef}
                  className="chat-input-field"
                  placeholder={isConnected ? "Send encrypted message..." : "Disconnected..."}
                  value={inputText}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  disabled={!isConnected}
                  maxLength={1000}
                  rows={1}
                />
                
                <button 
                  className="btn-send" 
                  type="submit" 
                  disabled={(!inputText.trim() && !attachment) || fileUploading || !isConnected}
                  title="Send Message"
                >
                  {fileUploading ? (
                    <svg className="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10">
                        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
                      </circle>
                    </svg>
                  ) : (
                    <svg className="send-icon" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Lightbox component for images */}
        {lightboxImage && (
          <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
            <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
              <button className="lightbox-close" onClick={() => setLightboxImage(null)}>
                ✕
              </button>
              <img className="lightbox-image" src={lightboxImage.url} alt={lightboxImage.name} />
              <a 
                href={lightboxImage.url} 
                download={lightboxImage.name} 
                className="btn-primary lightbox-download"
              >
                💾 Save Decrypted Image
              </a>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Router layout dispatcher
  return (
    <div className={`app-container ${roomId && hasJoined ? 'chat-mode' : ''}`}>
      {!roomId ? (
        renderLobby()
      ) : !hasJoined ? (
        renderJoinGate()
      ) : (
        renderChat()
      )}
    </div>
  );
}

export default App;
