
import { useEffect, useRef, useState } from 'react';

export default function MiniBrowser() {
  const [img, setImg] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [url, setUrl] = useState('https://www.google.com');
  const [showMenu, setShowMenu] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    };
    
    ws.onmessage = e => {
      const blob = new Blob([e.data], { type: 'image/jpeg' });
      setImg(URL.createObjectURL(blob));
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
    setIsNavigating(true);
    wsRef.current?.send(
      JSON.stringify({ cmd: 'nav', url: url })
    );
    // Reset navigation state after 3 seconds
    setTimeout(() => setIsNavigating(false), 3000);
  };

  // Handle menu actions
  const handleMenuAction = (action: string) => {
    setShowMenu(false);
    switch (action) {
      case 'refresh':
        wsRef.current?.send(
          JSON.stringify({ cmd: 'nav', url: url })
        );
        break;
      case 'newTab':
        setUrl('https://www.google.com');
        wsRef.current?.send(
          JSON.stringify({ cmd: 'nav', url: 'https://www.google.com' })
        );
        break;
      case 'devTools':
        console.log('Developer tools requested');
        break;
    }
  };

  // Handle scroll wheel events
  const handleWheel = (e: React.WheelEvent<HTMLImageElement>) => {
    e.preventDefault();
    const scrollAmount = e.deltaY;
    wsRef.current?.send(
      JSON.stringify({ cmd: 'scroll', dy: scrollAmount })
    );
  };

  // Simple click→send mapping (original working approach)
  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = (e.target as HTMLImageElement).getBoundingClientRect();
    wsRef.current?.send(
      JSON.stringify({ 
        cmd: 'click', 
        x: e.clientX - rect.left, 
        y: e.clientY - rect.top 
      })
    );
  };

  return (
    <div className="rounded-xl border-2 border-gray-300 w-[900px] h-[700px] overflow-hidden shadow-2xl bg-white">
      {/* Browser Header */}
      <div className="flex items-center h-12 px-4 bg-gradient-to-r from-gray-800 to-gray-900 text-sm text-white">
        <div className="flex items-center space-x-3">
          <div className="w-4 h-4 rounded-full bg-red-500"></div>
          <div className="w-4 h-4 rounded-full bg-yellow-500"></div>
          <div className="w-4 h-4 rounded-full bg-green-500"></div>
        </div>
        
        {/* 3-dot menu button */}
        <div className="relative ml-4">
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className="text-white hover:text-gray-300 p-2 rounded hover:bg-gray-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>
          
          {/* Dropdown menu */}
          {showMenu && (
            <div 
              ref={menuRef}
              className="absolute top-8 left-0 bg-white border border-gray-300 rounded-lg shadow-xl z-10 min-w-[180px]">
              <div className="py-2">
                <button 
                  onClick={() => handleMenuAction('newTab')}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  New Tab
                </button>
                <button 
                  onClick={() => handleMenuAction('refresh')}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  Refresh
                </button>
                <button 
                  onClick={() => handleMenuAction('devTools')}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  Developer Tools
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* URL Bar */}
        <div className="flex-1 mx-4">
          <form onSubmit={handleUrlSubmit} className="flex">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-gray-600 transition-colors"
              placeholder="Enter URL..."
              disabled={isNavigating}
            />
            <button 
              type="submit"
              disabled={isNavigating}
              className="ml-3 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors"
            >
              {isNavigating ? 'Loading...' : 'Go'}
            </button>
          </form>
        </div>
      </div>
      
      {/* Content Area */}
      <div className="w-full h-[calc(100%-3rem)] overflow-hidden bg-gray-50">
        {isLoading ? (
          <div className="flex items-center justify-center h-full bg-gray-100">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600 text-lg">Connecting to browser...</p>
            </div>
          </div>
        ) : isNavigating ? (
          <div className="flex items-center justify-center h-full bg-gray-100">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
              <p className="text-gray-600 text-lg">Loading page...</p>
              <p className="text-gray-500 text-sm mt-2">Please wait before clicking</p>
            </div>
          </div>
        ) : (
          <img
            src={img}
            onClick={handleClick}
            onWheel={handleWheel}
            className="w-full h-full object-contain select-none cursor-pointer"
            draggable={false}
            alt="Browser content"
          />
        )}
      </div>
    </div>
  );
}