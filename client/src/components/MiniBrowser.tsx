import { useEffect, useRef, useState } from 'react';
import './MiniBrowser.css';

export default function MiniBrowser() {
  const [img, setImg] = useState('');
  const [url, setUrl] = useState('https://www.google.com');
  const [showMenu, setShowMenu] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastClickTime = useRef<number>(0);
  const lastScrollTime = useRef<number>(0);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    // Connect to the same domain (frontend and backend on Railway)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const serverUrl = `${protocol}//${host}`;
    
    const ws = new WebSocket(serverUrl);
    ws.binaryType = 'arraybuffer';
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnectionStatus('connected');
      // Request initial screenshot
      ws.send(JSON.stringify({ cmd: 'requestScreenshot' }));
    };
    
    ws.onmessage = e => {
      if (typeof e.data === 'string') {
        // JSON message (URL updates, etc)
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'url') {
            setUrl(msg.url);
          }
        } catch (error) {
          console.error('Error parsing JSON message:', error);
        }
      } else {
        // Binary message (screenshot)
        const blob = new Blob([e.data], { type: 'image/jpeg' });
        const newImg = URL.createObjectURL(blob);
        setImg(prevImg => {
          if (prevImg) URL.revokeObjectURL(prevImg);
          return newImg;
        });
        setIsNavigating(false);
      }
    };

    ws.onerror = () => {
      setConnectionStatus('error');
    };

    ws.onclose = () => {
      setConnectionStatus('error');
    };
    
    wsRef.current = ws;
    return () => {
      ws.close();
      if (img) {
        URL.revokeObjectURL(img);
      }
    };
  }, []);

  // Handle URL navigation
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('URL Submit triggered, URL:', url, 'Connection:', connectionStatus);
    
    if (connectionStatus !== 'connected' || !url.trim()) {
      console.log('Navigation blocked - not connected or empty URL');
      return;
    }
    
    // Add http:// if no protocol specified
    let navUrl = url.trim();
    if (!navUrl.startsWith('http://') && !navUrl.startsWith('https://')) {
      navUrl = 'https://' + navUrl;
    }
    
    setIsNavigating(true);
    console.log('Sending navigation command to:', navUrl);
    
    try {
      wsRef.current?.send(
        JSON.stringify({ cmd: 'nav', url: navUrl })
      );
    } catch (error) {
      console.error('Error sending navigation command:', error);
    }
  };

  // Handle menu actions
  const handleMenuAction = (action: string) => {
    setShowMenu(false);
    if (connectionStatus !== 'connected') return;
    
    switch (action) {
      case 'back':
        wsRef.current?.send(
          JSON.stringify({ cmd: 'goBack' })
        );
        break;
      case 'forward':
        wsRef.current?.send(
          JSON.stringify({ cmd: 'goForward' })
        );
        break;
      case 'refresh':
        setIsNavigating(true);
        wsRef.current?.send(
          JSON.stringify({ cmd: 'nav', url: url })
        );
        break;
      case 'newTab':
        setUrl('https://www.google.com');
        setIsNavigating(true);
        wsRef.current?.send(
          JSON.stringify({ cmd: 'nav', url: 'https://www.google.com' })
        );
        break;
      case 'home':
        setUrl('https://www.google.com');
        setIsNavigating(true);
        wsRef.current?.send(
          JSON.stringify({ cmd: 'nav', url: 'https://www.google.com' })
        );
        break;
    }
  };

  // Handle scroll wheel events with throttling
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (connectionStatus !== 'connected') return;
    
    // Throttle scroll events to prevent overwhelming the server
    const now = Date.now();
    if (now - lastScrollTime.current < 50) return; // 50ms minimum between scrolls
    lastScrollTime.current = now;
    
    const scrollAmount = e.deltaY;
    wsRef.current?.send(
      JSON.stringify({ cmd: 'scroll', dy: scrollAmount })
    );
  };

  // Handle keyboard events for typing
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (connectionStatus !== 'connected') return;
    
    // Don't capture keyboard input if user is typing in URL bar
    if (e.target instanceof HTMLInputElement) return;
    
    // Handle special keys
    const specialKeys = ['Backspace', 'Enter', 'Tab', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    
    if (e.key.length === 1 || specialKeys.includes(e.key)) {
      e.preventDefault();
      wsRef.current?.send(
        JSON.stringify({ cmd: 'type', text: e.key })
      );
    }
  };

  // Enhanced click handling with visual feedback and throttling
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (connectionStatus !== 'connected' || !imgRef.current) return;
    
    // Throttle clicks to prevent overwhelming the server
    const now = Date.now();
    if (now - lastClickTime.current < 100) return; // 100ms minimum between clicks
    lastClickTime.current = now;
    
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Scale coordinates to match the actual browser viewport (1280x720)
    const scaleX = 1280 / rect.width;
    const scaleY = 720 / rect.height;
    const scaledX = Math.round(x * scaleX);
    const scaledY = Math.round(y * scaleY);
    
    // Visual feedback for click
    const clickIndicator = document.createElement('div');
    clickIndicator.className = 'click-indicator';
    clickIndicator.style.left = `${e.clientX}px`;
    clickIndicator.style.top = `${e.clientY}px`;
    document.body.appendChild(clickIndicator);
    
    setTimeout(() => {
      if (document.body.contains(clickIndicator)) {
        document.body.removeChild(clickIndicator);
      }
    }, 800);
    
    // Send click command with scaled coordinates
    wsRef.current?.send(
      JSON.stringify({ cmd: 'click', x: scaledX, y: scaledY })
    );
    
    // Focus the content area to enable keyboard input
    // This won't interfere with clicks since we're using tabIndex={-1}
    contentRef.current?.focus();
  };

  return (
    <div className="browser-container">
      {/* Browser Chrome */}
      <div className="browser-header">
        {/* Window Controls */}
        <div className="window-controls">
          <div className="control-button close"></div>
          <div className="control-button minimize"></div>
          <div className="control-button maximize"></div>
        </div>
        
        {/* Navigation Controls */}
        <div className="nav-controls">
          <button 
            className="nav-button"
            onClick={() => handleMenuAction('back')}
            disabled={connectionStatus !== 'connected'}
            title="Back"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button 
            className="nav-button"
            onClick={() => handleMenuAction('forward')}
            disabled={connectionStatus !== 'connected'}
            title="Forward"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button 
            className="nav-button"
            onClick={() => handleMenuAction('refresh')}
            disabled={connectionStatus !== 'connected'}
            title="Refresh"
          >
            <svg className={`w-4 h-4 ${isNavigating ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button 
            className="nav-button"
            onClick={() => handleMenuAction('home')}
            disabled={connectionStatus !== 'connected'}
            title="Home"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </button>
        </div>
        
        {/* URL Bar */}
        <form onSubmit={handleUrlSubmit} className="url-bar-container">
          <div className="url-bar-wrapper">
            <div className="url-security-icon">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleUrlSubmit(e);
                }
              }}
              className="url-input"
              placeholder="Search or enter address"
              disabled={connectionStatus !== 'connected'}
            />
            {isNavigating ? (
              <div className="url-loading">
                <div className="loading-spinner"></div>
              </div>
            ) : (
              <button 
                type="submit"
                disabled={connectionStatus !== 'connected'}
                className="url-submit"
                onClick={(e) => {
                  e.preventDefault();
                  handleUrlSubmit(e);
                }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            )}
          </div>
        </form>
        
        {/* Menu Button */}
        <div className="relative">
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className="menu-button"
            disabled={connectionStatus !== 'connected'}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>
          
          {/* Dropdown menu */}
          {showMenu && (
            <div ref={menuRef} className="menu-dropdown">
              <button onClick={() => handleMenuAction('newTab')} className="menu-item">
                <svg className="w-4 h-4 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Tab
              </button>
              <button onClick={() => handleMenuAction('refresh')} className="menu-item">
                <svg className="w-4 h-4 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
              <div className="menu-separator"></div>
              <button className="menu-item">
                <svg className="w-4 h-4 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                About
              </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Content Area */}
      <div 
        ref={contentRef}
        className="browser-content"
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        tabIndex={-1}
      >
        {connectionStatus === 'connecting' ? (
          <div className="loading-screen">
            <div className="loading-container">
              <div className="loading-logo">
                <svg className="w-16 h-16 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </div>
              <div className="loading-spinner-large"></div>
              <p className="loading-text">Connecting to browser...</p>
              <p className="loading-subtext">Establishing secure connection</p>
            </div>
          </div>
        ) : connectionStatus === 'error' ? (
          <div className="error-screen">
            <div className="error-container">
              <svg className="w-16 h-16 text-red-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">Connection Failed</h3>
              <p className="text-gray-600">Unable to connect to the browser service</p>
              <button 
                onClick={() => window.location.reload()} 
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Retry Connection
              </button>
            </div>
          </div>
        ) : isNavigating ? (
          <div className="navigation-screen">
            <div className="navigation-container">
              <div className="navigation-spinner"></div>
              <p className="navigation-text">Loading page...</p>
              <p className="navigation-url">{url}</p>
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <img
              ref={imgRef}
              src={img}
              className="browser-image"
              draggable={false}
              alt="Browser content"
            />
          </div>
        )}
      </div>
      
      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-item">
          <div className={`status-indicator ${connectionStatus === 'connected' ? 'connected' : connectionStatus === 'error' ? 'error' : 'connecting'}`}></div>
          <span className="status-text">
            {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'error' ? 'Disconnected' : 'Connecting...'}
          </span>
        </div>
        <div className="status-item">
          <span className="status-text">20+ FPS Stream</span>
        </div>
      </div>
    </div>
  );
}