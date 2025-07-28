import { useEffect, useRef, useState } from 'react';

export default function MiniBrowser() {
  const [img, setImg] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const wsRef = useRef<WebSocket>();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connectWebSocket = () => {
    // Dynamic WebSocket URL for production
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.hostname === 'localhost' 
      ? 'localhost:3001' 
      : window.location.host;
    
    const ws = new WebSocket(`${wsProtocol}//${wsHost}`);
    ws.binaryType = 'arraybuffer';
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnectionStatus('connected');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
    
    ws.onmessage = (e) => {
      const blob = new Blob([e.data], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      setImg((prevImg) => {
        if (prevImg) URL.revokeObjectURL(prevImg);
        return url;
      });
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnectionStatus('disconnected');
      // Attempt to reconnect after 2 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('Attempting to reconnect...');
        connectWebSocket();
      }, 2000);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    wsRef.current = ws;
  };

  useEffect(() => {
    connectWebSocket();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (img) {
        URL.revokeObjectURL(img);
      }
    };
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const rect = (e.target as HTMLImageElement).getBoundingClientRect();
      wsRef.current.send(
        JSON.stringify({ 
          cmd: 'click', 
          x: e.clientX - rect.left, 
          y: e.clientY - rect.top 
        })
      );
    }
  };

  return (
    <div className="rounded-xl border w-[420px] h-[260px] overflow-hidden relative">
      <div className="flex items-center h-8 px-2 bg-neutral-800 text-xs text-neutral-200">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-green-500' : 
            connectionStatus === 'connecting' ? 'bg-yellow-500' : 
            'bg-red-500'
          }`} />
          <span className="text-[10px] opacity-70">
            {connectionStatus === 'connected' ? 'Connected' : 
             connectionStatus === 'connecting' ? 'Connecting...' : 
             'Reconnecting...'}
          </span>
        </div>
      </div>
      {img ? (
        <img
          src={img}
          onClick={handleClick}
          className="w-full h-[calc(100%-2rem)] object-cover select-none cursor-pointer"
          draggable={false}
          alt="Browser view"
        />
      ) : (
        <div className="w-full h-[calc(100%-2rem)] flex items-center justify-center bg-neutral-900">
          <div className="text-neutral-500 text-sm">
            {connectionStatus === 'connecting' ? 'Loading browser...' : 'Disconnected'}
          </div>
        </div>
      )}
    </div>
  );
}