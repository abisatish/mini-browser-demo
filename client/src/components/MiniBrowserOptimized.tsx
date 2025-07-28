import { useEffect, useRef, useState } from 'react';
import './MiniBrowser.css';

export default function MiniBrowserOptimized() {
  const [img, setImg] = useState('');
  const [url, setUrl] = useState('https://www.google.com');
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);

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
      ws.send(JSON.stringify({ cmd: 'getState' }));
    };
    
    ws.onmessage = e => {
      const blob = new Blob([e.data], { type: 'image/jpeg' });
      const newImg = URL.createObjectURL(blob);
      setImg(prevImg => {
        if (prevImg) URL.revokeObjectURL(prevImg);
        return newImg;
      });
    };

    ws.onerror = () => setConnectionStatus('error');
    ws.onclose = () => setConnectionStatus('error');
    
    wsRef.current = ws;
    return () => {
      ws.close();
      if (img) URL.revokeObjectURL(img);
    };
  }, []);

  // Only request screenshots after actions, not continuously
  const executeCommand = (command: any) => {
    if (connectionStatus !== 'connected') return;
    wsRef.current?.send(JSON.stringify(command));
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!e.currentTarget.querySelector('img')) return;
    const rect = e.currentTarget.querySelector('img')!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    executeCommand({ cmd: 'click', x, y });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement) return;
    
    const specialKeys = ['Backspace', 'Enter', 'Tab', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (e.key.length === 1 || specialKeys.includes(e.key)) {
      e.preventDefault();
      executeCommand({ cmd: 'type', text: e.key });
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    executeCommand({ cmd: 'scroll', dy: e.deltaY });
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCommand({ cmd: 'nav', url: url });
  };

  return (
    <div className="browser-container">
      <div className="browser-header">
        <form onSubmit={handleUrlSubmit} className="url-bar-container">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="url-input"
            placeholder="Enter URL"
          />
          <button type="submit">Go</button>
        </form>
      </div>
      
      <div 
        className="browser-content"
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        tabIndex={0}
      >
        {connectionStatus === 'connected' && img ? (
          <img src={img} alt="Browser content" />
        ) : (
          <div>Connecting...</div>
        )}
      </div>
    </div>
  );
}