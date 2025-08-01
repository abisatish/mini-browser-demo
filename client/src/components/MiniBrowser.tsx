import { useEffect, useRef, useState } from 'react';
import './MiniBrowser.css';
import SearchResults from './SearchResults';
import ProfileScanner from './ProfileScanner';

export default function MiniBrowser() {
  const [img, setImg] = useState('');
  const [url, setUrl] = useState('https://www.google.com');
  const [showMenu, setShowMenu] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [isTypingActive, setIsTypingActive] = useState(false);
  const [typingText, setTypingText] = useState('');
  const [typingPosition, setTypingPosition] = useState<{x: number, y: number} | null>(null);
  const [showSearchResults, setShowSearchResults] = useState(true); // Start with overlay visible
  const [showProfileScanner, setShowProfileScanner] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([
    {
      title: 'Pratyush Chakraborty LinkedIn profile',
      link: 'https://www.linkedin.com/in/pratyush-chakraborty',
      snippet: 'Pratyush Chakraborty - Facebook, LinkedIn - Clay.earth',
      source: 'linkedin',
      favicon: null
    },
    {
      title: '0000-0003-1326-7567 - ORCID',
      link: 'https://orcid.org/0000-0003-1326-7567',
      snippet: 'ORCID record for Pratyush Chakraborty. ORCID provides an identifier for individuals to use with their name as they engage in research, scholarship, and innovation activities.',
      source: 'orcid',
      favicon: null
    },
    {
      title: 'Prof. Pratyush Chakraborty - BITS Pilani',
      link: 'https://www.bits-pilani.ac.in/prof-pratyush-chakraborty',
      snippet: 'Prof. Pratyush Chakraborty is a faculty member at BITS Pilani, specializing in various areas of research and teaching.',
      source: 'bits-pilani',
      favicon: null
    },
    {
      title: 'Pratyush Chakraborty - Best Ads on TV',
      link: 'https://bestadsontv.com/profile/pratyush-chakraborty',
      snippet: 'View the creative portfolio and advertising work of Pratyush Chakraborty on Best Ads on TV.',
      source: 'bestadsontv',
      favicon: null
    },
    {
      title: 'Pratyush Chakraborty, Ph.D.\'s Post - LinkedIn',
      link: 'https://www.linkedin.com/posts/pratyush-chakraborty',
      snippet: 'View recent posts and updates from Pratyush Chakraborty on LinkedIn professional network.',
      source: 'linkedin',
      favicon: null
    },
    {
      title: 'Pratyush Chakraborty - Research Profile',
      link: 'https://scholar.google.com/citations?user=pratyush',
      snippet: 'Academic publications and research contributions by Pratyush Chakraborty.',
      source: 'scholar.google.com',
      favicon: null
    },
    {
      title: 'Pratyush Chakraborty - Twitter/X',
      link: 'https://twitter.com/pratyushchak',
      snippet: 'Follow Pratyush Chakraborty on Twitter for latest updates and thoughts.',
      source: 'twitter.com',
      favicon: null
    },
    {
      title: 'Dr. Pratyush Chakraborty - Academia.edu',
      link: 'https://independent.academia.edu/PratyushChakraborty',
      snippet: 'Academic papers and research work by Dr. Pratyush Chakraborty available on Academia.edu.',
      source: 'academia.edu',
      favicon: null
    },
    {
      title: 'Pratyush Chakraborty - Professional Experience',
      link: 'https://www.researchgate.net/profile/Pratyush-Chakraborty',
      snippet: 'ResearchGate profile showcasing publications and professional network of Pratyush Chakraborty.',
      source: 'researchgate.net',
      favicon: null
    },
    {
      title: 'Pratyush Chakraborty - GitHub',
      link: 'https://github.com/pratyushchakraborty',
      snippet: 'Open source contributions and code repositories by Pratyush Chakraborty on GitHub.',
      source: 'github.com',
      favicon: null
    }
  ]);
  const [searchQuery, setSearchQuery] = useState('pratyush chakraborty linkedin');
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
      
      // Auto-close the search overlay after 8.5 seconds
      setTimeout(() => {
        setShowSearchResults(false);
      }, 8500);
    };
    
    ws.onmessage = e => {
      if (typeof e.data === 'string') {
        // JSON message (URL updates, etc)
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'url') {
            setUrl(msg.url);
          } else if (msg.type === 'searchResults') {
            // Handle search results from server
            setSearchResults(msg.results);
            setSearchQuery(msg.query);
            setShowSearchResults(true);
            setIsNavigating(false);
          } else if (msg.type === 'clickResult') {
            // Handle click result - only enable typing for input fields
            if (msg.isInputField) {
              setIsTypingActive(true);
              setTypingText('');
              // Don't set position from click - wait for actual cursor position
              setTypingPosition(null);
            } else {
              setIsTypingActive(false);
              setTypingText('');
              setTypingPosition(null);
            }
          } else if (msg.type === 'cursorPosition' && imgRef.current && contentRef.current) {
            // Set cursor position when we get it from server
            const rect = imgRef.current.getBoundingClientRect();
            const contentRect = contentRef.current.getBoundingClientRect();
            
            // Scale cursor position to match displayed image
            const imgNaturalWidth = 1280;
            const imgNaturalHeight = 720;
            const scale = Math.min(rect.width / imgNaturalWidth, rect.height / imgNaturalHeight);
            const displayedWidth = imgNaturalWidth * scale;
            const displayedHeight = imgNaturalHeight * scale;
            const offsetX = (rect.width - displayedWidth) / 2;
            const offsetY = (rect.height - displayedHeight) / 2;
            
            const scaledX = (msg.x / imgNaturalWidth) * displayedWidth + offsetX;
            const scaledY = (msg.y / imgNaturalHeight) * displayedHeight + offsetY;
            
            setTypingPosition({ 
              x: scaledX + rect.left - contentRect.left,
              y: scaledY + rect.top - contentRect.top
            });
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
    
    const searchTerm = url.trim().toLowerCase();
    
    // Check if this looks like a search query for LinkedIn
    if (searchTerm.includes('linkedin') && !searchTerm.startsWith('http')) {
      // It's a search query, not a URL
      setIsNavigating(true);
      console.log('Sending search command for:', searchTerm);
      
      try {
        wsRef.current?.send(
          JSON.stringify({ cmd: 'search', query: searchTerm })
        );
      } catch (error) {
        console.error('Error sending search command:', error);
      }
    } else {
      // Regular URL navigation
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
    }
  };
  
  // Handle navigation from search results
  const handleSearchResultNavigate = (resultUrl: string) => {
    setShowSearchResults(false);
    setIsNavigating(true);
    console.log('Navigating to search result:', resultUrl);
    
    try {
      wsRef.current?.send(
        JSON.stringify({ cmd: 'nav', url: resultUrl })
      );
    } catch (error) {
      console.error('Error navigating to search result:', error);
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
    
    // Only allow typing if we've clicked on an input field
    if (!isTypingActive) return;
    
    // Handle special keys
    const specialKeys = ['Backspace', 'Enter', 'Tab', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    
    if (e.key.length === 1 || specialKeys.includes(e.key)) {
      e.preventDefault();
      
      // Update typing text
      if (e.key === 'Enter' || e.key === 'Tab') {
        setIsTypingActive(false);
        setTypingText('');
        setTypingPosition(null);
      } else if (e.key === 'Backspace') {
        setTypingText(prev => prev.slice(0, -1));
      } else if (e.key.length === 1) {
        setTypingText(prev => prev + e.key);
      }
      
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
    
    // Get click position relative to the image element
    const rect = imgRef.current.getBoundingClientRect();
    
    // Since image uses object-fit: contain, we need to calculate the actual displayed image dimensions
    const imgNaturalWidth = 1280;
    const imgNaturalHeight = 720;
    const containerWidth = rect.width;
    const containerHeight = rect.height;
    
    // Calculate scale to fit image within container while maintaining aspect ratio
    const scale = Math.min(containerWidth / imgNaturalWidth, containerHeight / imgNaturalHeight);
    const displayedWidth = imgNaturalWidth * scale;
    const displayedHeight = imgNaturalHeight * scale;
    
    // Calculate offset for centered image
    const offsetX = (containerWidth - displayedWidth) / 2;
    const offsetY = (containerHeight - displayedHeight) / 2;
    
    // Get click coordinates relative to the actual image area
    const x = e.clientX - rect.left - offsetX;
    const y = e.clientY - rect.top - offsetY;
    
    // Scale to original image dimensions
    const scaledX = Math.round((x / displayedWidth) * imgNaturalWidth);
    const scaledY = Math.round((y / displayedHeight) * imgNaturalHeight);
    
    // Log for debugging
    console.log('Click debug:', {
      containerSize: { w: containerWidth, h: containerHeight },
      displayedSize: { w: displayedWidth, h: displayedHeight },
      offset: { x: offsetX, y: offsetY },
      clickPos: { x, y },
      scaledPos: { x: scaledX, y: scaledY }
    });
    
    // Ensure coordinates are within bounds
    if (scaledX < 0 || scaledX > imgNaturalWidth || scaledY < 0 || scaledY > imgNaturalHeight) {
      console.log('Click outside image bounds');
      return;
    }
    
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
      {/* Search Results Overlay */}
      {showSearchResults && (
        <SearchResults
          query={searchQuery}
          results={searchResults}
          onNavigate={handleSearchResultNavigate}
          onClose={() => setShowSearchResults(false)}
        />
      )}
      
      {/* Profile Scanner */}
      <ProfileScanner
        wsRef={wsRef}
        visible={showProfileScanner}
        onClose={() => setShowProfileScanner(false)}
      />
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
              <button 
                onClick={() => {
                  setShowMenu(false);
                  // Check if we're on LinkedIn
                  if (url.includes('linkedin.com/in/')) {
                    setShowProfileScanner(true);
                  } else {
                    alert('Please navigate to a LinkedIn profile first');
                  }
                }}
                className="menu-item"
              >
                <svg className="w-4 h-4 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                Scan Profile
              </button>
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
            {typingPosition && isTypingActive && (
              <div 
                className="typing-indicator-overlay"
                style={{
                  position: 'absolute',
                  left: `${typingPosition.x}px`,
                  top: `${typingPosition.y}px`,
                  pointerEvents: 'none'
                }}
              >
                <span className="typing-text">{typingText}</span>
                <span className="typing-cursor">|</span>
              </div>
            )}
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