import { useEffect, useState } from 'react';
import './MouseCursor.css';

interface MouseCursorProps {
  x: number;
  y: number;
  visible: boolean;
  clicking?: boolean;
}

export default function MouseCursor({ x, y, visible, clicking = false }: MouseCursorProps) {
  const [trail, setTrail] = useState<{x: number, y: number, id: number}[]>([]);
  
  useEffect(() => {
    if (!visible) return;
    
    const newTrailPoint = { x, y, id: Date.now() };
    setTrail(prev => [...prev.slice(-4), newTrailPoint]);
    
    const timer = setTimeout(() => {
      setTrail(prev => prev.filter(point => point.id !== newTrailPoint.id));
    }, 300);
    
    return () => clearTimeout(timer);
  }, [x, y, visible]);
  
  if (!visible) return null;
  
  return (
    <>
      {/* Mouse trail */}
      {trail.map((point, index) => (
        <div
          key={point.id}
          className="mouse-trail"
          style={{
            left: point.x,
            top: point.y,
            opacity: (index + 1) / trail.length * 0.3,
            transform: `scale(${(index + 1) / trail.length})`,
          }}
        />
      ))}
      
      {/* Main cursor */}
      <div
        className={`mouse-cursor ${clicking ? 'clicking' : ''}`}
        style={{
          left: x,
          top: y,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 3L10.07 19.97L12.58 12.58L19.97 10.07L3 3Z"
            fill="currentColor"
            stroke="white"
            strokeWidth="2"
          />
        </svg>
        
        {/* Click ripple effect */}
        {clicking && (
          <div className="click-ripple" />
        )}
      </div>
    </>
  );
}