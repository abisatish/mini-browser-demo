import { useEffect, useRef, useState } from 'react';

export default function MiniBrowser() {
  const [img, setImg] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [url, setUrl] = useState('https://ai.google');
  const [showMenu, setShowMenu] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

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
      setIsLoading(false);
      setConnectionStatus('connected');
    };
    
    ws.onmessage = e => {
      const blob = new Blob([e.data], { type: 'image/jpeg' });
      const newImg = URL.createObjectURL(blob);
      setImg(prevImg => {
        if (prevImg) URL.revokeObjectURL(prevImg);
        return newImg;
      });
    };

    ws.onerror = () => {
      setConnectionStatus('error');
      setIsLoading(false);
    };

    ws.onclose = () => {
      setConnectionStatus('error');
      setIsLoading(false);
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
    if (connectionStatus !== 'connected') return;
    
    setIsNavigating(true);
    wsRef.current?.send(
      JSON.stringify({ cmd: 'nav', url: url })
    );
    // Reset navigation state after 2 seconds
    setTimeout(() => setIsNavigating(false), 2000);
  };

  // Handle menu actions
  const handleMenuAction = (action: string) => {
    setShowMenu(false);
    if (connectionStatus !== 'connected') return;
    
    switch (action) {
      case 'refresh':
        setIsNavigating(true);
        wsRef.current?.send(
          JSON.stringify({ cmd: 'nav', url: url })
        );
        setTimeout(() => setIsNavigating(false), 2000);
        break;
      case 'newTab':
        setUrl('https://ai.google');
        setIsNavigating(true);
        wsRef.current?.send(
          JSON.stringify({ cmd: 'nav', url: 'https://ai.google' })
        );
        setTimeout(() => setIsNavigating(false), 2000);
        break;
      case 'home':
        setUrl('https://www.google.com');
        setIsNavigating(true);
        wsRef.current?.send(
          JSON.stringify({ cmd: 'nav', url: 'https://www.google.com' })
        );
        setTimeout(() => setIsNavigating(false), 2000);
        break;
    }
  };

  // Handle scroll wheel events
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (connectionStatus !== 'connected') return;
    
    const scrollAmount = e.deltaY;
    wsRef.current?.send(
      JSON.stringify({ cmd: 'scroll', dy: scrollAmount })
    );
  };

  // Handle keyboard events for typing
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (connectionStatus !== 'connected') return;
    
    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      wsRef.current?.send(
        JSON.stringify({ cmd: 'type', text: e.key })
      );
    }
  };

  // Enhanced click handling with visual feedback
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (connectionStatus !== 'connected' || !imgRef.current) return;
    
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Visual feedback for click
    const clickIndicator = document.createElement('div');
    clickIndicator.className = 'click-indicator';
    clickIndicator.style.left = `${e.clientX}px`;
    clickIndicator.style.top = `${e.clientY}px`;
    document.body.appendChild(clickIndicator);
    
    setTimeout(() => {
      document.body.removeChild(clickIndicator);
    }, 600);
    
    wsRef.current?.send(
      JSON.stringify({ cmd: 'click', x, y })
    );
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
              className="url-input"
              placeholder="Search or enter address"
              disabled={isNavigating || connectionStatus !== 'connected'}
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
        className="browser-content"
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        tabIndex={0}
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
          <img
            ref={imgRef}
            src={img}
            className="browser-image"
            draggable={false}
            alt="Browser content"
          />
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
          <span className="status-text">30 FPS Stream</span>
        </div>
      </div>
      
      <style jsx>{`
        .browser-container {
          width: 100%;
          max-width: 1200px;
          height: 800px;
          border-radius: 12px;
          overflow: hidden;
          background: #ffffff;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          display: flex;
          flex-direction: column;
          border: 1px solid #e5e7eb;
        }

        .browser-header {
          display: flex;
          align-items: center;
          height: 64px;
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
          padding: 0 16px;
          gap: 12px;
        }

        .window-controls {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .control-button {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          transition: opacity 0.2s;
        }

        .control-button:hover {
          opacity: 0.8;
        }

        .control-button.close {
          background: #ef4444;
        }

        .control-button.minimize {
          background: #f59e0b;
        }

        .control-button.maximize {
          background: #10b981;
        }

        .nav-controls {
          display: flex;
          gap: 4px;
        }

        .nav-button {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          border: none;
          background: white;
          color: #6b7280;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }

        .nav-button:hover:not(:disabled) {
          background: #f3f4f6;
          color: #374151;
        }

        .nav-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .url-bar-container {
          flex: 1;
          display: flex;
          align-items: center;
        }

        .url-bar-wrapper {
          width: 100%;
          display: flex;
          align-items: center;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 24px;
          padding: 0 16px;
          height: 40px;
          transition: all 0.2s;
        }

        .url-bar-wrapper:focus-within {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .url-security-icon {
          color: #6b7280;
          margin-right: 8px;
        }

        .url-input {
          flex: 1;
          border: none;
          outline: none;
          font-size: 14px;
          color: #111827;
          background: transparent;
        }

        .url-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
        }

        .loading-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid #e5e7eb;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .url-submit {
          background: none;
          border: none;
          color: #6b7280;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s;
        }

        .url-submit:hover:not(:disabled) {
          color: #3b82f6;
        }

        .url-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .menu-button {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: #6b7280;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }

        .menu-button:hover:not(:disabled) {
          background: #f3f4f6;
          color: #374151;
        }

        .menu-dropdown {
          position: absolute;
          top: 48px;
          right: 0;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          z-index: 50;
          min-width: 200px;
          padding: 8px;
        }

        .menu-item {
          width: 100%;
          display: flex;
          align-items: center;
          padding: 10px 12px;
          border: none;
          background: none;
          color: #374151;
          font-size: 14px;
          cursor: pointer;
          border-radius: 8px;
          transition: all 0.2s;
          text-align: left;
        }

        .menu-item:hover {
          background: #f3f4f6;
        }

        .menu-separator {
          height: 1px;
          background: #e5e7eb;
          margin: 8px 0;
        }

        .browser-content {
          flex: 1;
          overflow: hidden;
          background: #f9fafb;
          position: relative;
          cursor: pointer;
        }

        .browser-content:focus {
          outline: none;
        }

        .loading-screen, .error-screen, .navigation-screen {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
        }

        .loading-container, .error-container, .navigation-container {
          text-align: center;
          position: relative;
        }

        .loading-logo {
          margin-bottom: 24px;
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        .loading-spinner-large {
          width: 48px;
          height: 48px;
          border: 3px solid #e5e7eb;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 24px;
        }

        .navigation-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid #e5e7eb;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin: 0 auto 16px;
        }

        .loading-text, .navigation-text {
          font-size: 18px;
          font-weight: 600;
          color: #1f2937;
          margin-bottom: 8px;
        }

        .loading-subtext, .navigation-url {
          font-size: 14px;
          color: #6b7280;
        }

        .browser-image {
          width: 100%;
          height: 100%;
          object-fit: contain;
          image-rendering: crisp-edges;
        }

        .status-bar {
          height: 32px;
          background: #f3f4f6;
          border-top: 1px solid #e5e7eb;
          display: flex;
          align-items: center;
          padding: 0 16px;
          gap: 24px;
          font-size: 12px;
          color: #6b7280;
        }

        .status-item {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        .status-indicator.connected {
          background: #10b981;
        }

        .status-indicator.error {
          background: #ef4444;
        }

        .status-indicator.connecting {
          background: #f59e0b;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        .click-indicator {
          position: fixed;
          width: 20px;
          height: 20px;
          border: 2px solid #3b82f6;
          border-radius: 50%;
          pointer-events: none;
          animation: click-ripple 0.6s ease-out;
          transform: translate(-50%, -50%);
        }

        @keyframes click-ripple {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(3);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}