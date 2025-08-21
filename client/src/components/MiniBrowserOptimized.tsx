import { useEffect, useRef, useState } from 'react';
import './MiniBrowser.css';
import SearchResults from './SearchResults';
import ProfileScanner from './ProfileScanner';
import LeadScanner from './LeadScanner';

export default function MiniBrowserOptimized() {
  const [img, setImg] = useState('');
  const [url, setUrl] = useState('https://www.linkedin.com');
  const [showMenu, setShowMenu] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [isTypingActive, setIsTypingActive] = useState(false);
  const [typingText, setTypingText] = useState('');
  const [typingPosition, setTypingPosition] = useState<{x: number, y: number} | null>(null);
  const [showSearchResults, setShowSearchResults] = useState(true); // Start with overlay visible
  const [showProfileScanner, setShowProfileScanner] = useState(false);
  const [showLeadScanner, setShowLeadScanner] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([
    {
      title: 'Pratyush Chakraborty LinkedIn profile',
      link: 'https://www.linkedin.com/in/pratyush-chakraborty',
      snippet: 'Pratyush Chakraborty - Facebook, LinkedIn - MathEcon + AI @ Penn',
      source: 'linkedin',
      favicon: null
    },
    {
      title: 'Pratyush Chakraborty Waymo LinkedIn profile',
      link: 'https://www.linkedin.com/in/pratyush-chakraborty',
      snippet: 'Pratyush Chakraborty - Facebook, LinkedIn - @ Waymo',
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
      link: 'https://www.linkedin.com/in/pratyush-chakraborty',
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
          } else if (msg.type === 'profileAnalysis') {
            // Auto-open ProfileScanner when analysis is received
            console.log('Received profile analysis, opening scanner UI');
            setShowProfileScanner(true);
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
        const newImgUrl = URL.createObjectURL(blob);
        
        // Preload the image before swapping to avoid white flash
        const img = new Image();
        img.onload = () => {
          setImg(prevImg => {
            if (prevImg) URL.revokeObjectURL(prevImg);
            return newImgUrl;
          });
        };
        img.src = newImgUrl;
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
      if (img) URL.revokeObjectURL(img);
    };
  }, []);

  // Handle navigation from search results
  const handleSearchResultNavigate = (resultUrl: string) => {
    setShowSearchResults(false);
    setIsNavigating(true);
    console.log('Navigating to search result:', resultUrl);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ cmd: 'nav', url: resultUrl }));
    }
  };

  const executeCommand = (command: any) => {
    if (connectionStatus !== 'connected' || !wsRef.current) return;
    console.log('Sending command:', command);
    wsRef.current.send(JSON.stringify(command));
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgRef.current) return;
    
    const now = Date.now();
    if (now - lastClickTime.current < 100) return; // Debounce clicks
    lastClickTime.current = now;
    
    // Get the image element's bounding rect
    const rect = imgRef.current.getBoundingClientRect();
    
    // Calculate click position relative to the image
    const x = ((e.clientX - rect.left) / rect.width) * 1280;
    const y = ((e.clientY - rect.top) / rect.height) * 720;
    
    // Make sure click is within bounds
    if (x < 0 || x > 1280 || y < 0 || y > 720) {
      return;
    }
    
    // Visual feedback - show where we clicked on the image
    if (imgRef.current) {
      const indicator = document.createElement('div');
      indicator.className = 'click-indicator';
      indicator.style.position = 'absolute';
      indicator.style.left = `${e.clientX - rect.left}px`;
      indicator.style.top = `${e.clientY - rect.top}px`;
      imgRef.current.parentElement?.appendChild(indicator);
      setTimeout(() => indicator.remove(), 800);
    }
    
    executeCommand({ cmd: 'click', x: Math.round(x), y: Math.round(y) });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement) return;
    
    const specialKeys = ['Backspace', 'Enter', 'Tab', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (e.key.length === 1 || specialKeys.includes(e.key)) {
      e.preventDefault();
      
      if (isTypingActive) {
        if (e.key === 'Backspace') {
          setTypingText(prev => prev.slice(0, -1));
        } else if (e.key.length === 1) {
          setTypingText(prev => prev + e.key);
        }
      }
      
      executeCommand({ cmd: 'type', text: e.key });
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    const now = Date.now();
    if (now - lastScrollTime.current < 50) return; // Throttle scroll events
    lastScrollTime.current = now;
    
    executeCommand({ cmd: 'scroll', dy: e.deltaY });
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsNavigating(true);
    setIsTypingActive(false);
    setTypingText('');
    setTypingPosition(null);
    executeCommand({ cmd: 'nav', url: url });
  };

  const handleMenuAction = (action: string) => {
    setShowMenu(false);
    switch (action) {
      case 'newTab':
        window.open(window.location.href, '_blank');
        break;
      case 'toggleProfile':
        // Check if we're on LinkedIn
        if (url.includes('linkedin.com/in/')) {
          setShowProfileScanner(true);
        } else {
          alert('Please navigate to a LinkedIn profile first');
        }
        break;
      case 'refresh':
        executeCommand({ cmd: 'refresh' });
        break;
    }
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
        <div className="window-controls">
          <div className="control-button close" onClick={() => window.close()}></div>
          <div className="control-button minimize"></div>
          <div className="control-button maximize"></div>
        </div>
        
        <div className="nav-controls">
          <button 
            onClick={() => executeCommand({ cmd: 'back' })} 
            className="nav-button"
            disabled={connectionStatus !== 'connected'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <button 
            onClick={() => executeCommand({ cmd: 'forward' })} 
            className="nav-button"
            disabled={connectionStatus !== 'connected'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          
          <button 
            onClick={() => executeCommand({ cmd: 'refresh' })} 
            className="nav-button"
            disabled={connectionStatus !== 'connected'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        
        <form onSubmit={handleUrlSubmit} className="url-bar-container">
          <div className="url-bar-wrapper">
            <svg className="url-security-icon w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="url-input"
              placeholder="Enter URL"
              disabled={connectionStatus !== 'connected'}
            />
            {isNavigating ? (
              <div className="url-loading">
                <div className="loading-spinner animate-spin"></div>
              </div>
            ) : (
              <button 
                type="submit" 
                className="url-submit"
                disabled={connectionStatus !== 'connected'}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            )}
          </div>
        </form>
        
        <div className="relative">
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className="menu-button"
            disabled={connectionStatus !== 'connected'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
          
          {/* Dropdown menu */}
          {showMenu && (
            <div ref={menuRef} className="menu-dropdown">
              <button onClick={() => handleMenuAction('newTab')} className="menu-item">
                New Tab
              </button>
              <button onClick={() => handleMenuAction('refresh')} className="menu-item">
                Refresh
              </button>
              <div className="menu-separator" />
              <button 
                onClick={() => {
                  // Check if we're on LinkedIn
                  if (url.includes('linkedin.com/in/')) {
                    setShowProfileScanner(true);
                  } else {
                    alert('Please navigate to a LinkedIn profile first');
                  }
                  setShowMenu(false);
                }} 
                className="menu-item"
              >
                Profile Scanner
              </button>
              <button 
                onClick={() => {
                  // Check if we're on Sales Navigator
                  if (url.includes('linkedin.com/sales/')) {
                    setShowLeadScanner(true);
                  } else {
                    alert('Please navigate to LinkedIn Sales Navigator first');
                  }
                  setShowMenu(false);
                }}
                className="menu-item"
                title="Extract all leads from Sales Navigator page"
              >
                📊 Lead Scanner (CSV)
              </button>
              <button 
                onClick={() => {
                  setShowSearchResults(true);
                  setShowMenu(false);
                }} 
                className="menu-item"
              >
                Show Search Results
              </button>
            </div>
          )}
        </div>
      </div>
      
      <div 
        ref={contentRef}
        className="browser-content"
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        tabIndex={0}
      >
        {connectionStatus === 'connecting' && (
          <div className="loading-screen">
            <div className="loading-container">
              <div className="loading-logo">
                <svg className="w-16 h-16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 17L12 22L22 17" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 12L12 17L22 12" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="loading-spinner-large"></div>
              <div className="loading-text">Connecting to browser...</div>
              <div className="loading-subtext">Establishing secure connection</div>
            </div>
          </div>
        )}
        
        {connectionStatus === 'error' && (
          <div className="error-screen">
            <div className="error-container">
              <svg className="w-16 h-16 text-red-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="text-xl font-semibold text-gray-800 mb-2">Connection Lost</div>
              <div className="text-gray-600">Unable to connect to the browser server</div>
              <button 
                onClick={() => window.location.reload()} 
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Refresh Page
              </button>
            </div>
          </div>
        )}
        
        {connectionStatus === 'connected' && isNavigating && (
          <div className="navigation-screen">
            <div className="navigation-container">
              <div className="navigation-spinner"></div>
              <div className="navigation-text">Navigating...</div>
              <div className="navigation-url">{url}</div>
            </div>
          </div>
        )}
        
        {connectionStatus === 'connected' && !isNavigating && img && (
          <>
            <img ref={imgRef} src={img} alt="Browser content" className="browser-image" />
            {isTypingActive && typingPosition && (
              <div 
                className="typing-indicator-overlay" 
                style={{
                  position: 'absolute',
                  left: `${typingPosition.x}px`,
                  top: `${typingPosition.y}px`,
                  pointerEvents: 'none',
                  background: 'rgba(255, 255, 255, 0.9)',
                  padding: '2px 4px',
                  borderRadius: '2px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  zIndex: 10
                }}
              >
                <span className="typing-text">{typingText}</span>
                <span className="typing-cursor">|</span>
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Profile Scanner Modal */}
      {showProfileScanner && (
        <ProfileScanner
          wsRef={wsRef}
          visible={showProfileScanner}
          onClose={() => setShowProfileScanner(false)}
        />
      )}
      
      {/* Lead Scanner Modal */}
      {showLeadScanner && (
        <LeadScanner
          wsRef={wsRef}
          onClose={() => setShowLeadScanner(false)}
        />
      )}
    </div>
  );
}