import { useEffect, useRef, useState } from 'react';
import './SearchResults.css';
import MouseCursor from './MouseCursor';
import Narration from './Narration';

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  favicon?: string;
  source?: string;
}

interface SearchResultsProps {
  query: string;
  results: SearchResult[];
  onNavigate: (url: string) => void;
  onClose?: () => void;
}

export default function SearchResults({ query, results, onNavigate, onClose }: SearchResultsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [showMouse, setShowMouse] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const [narrationText, setNarrationText] = useState('');
  const [showNarration, setShowNarration] = useState(false);
  const resultsRef = useRef<HTMLDivElement[]>([]);
  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);
  
  // Auto-scroll animation
  useEffect(() => {
    if (!listRef.current) return;
    
    const scrollContainer = listRef.current;
    const scrollHeight = scrollContainer.scrollHeight;
    const clientHeight = scrollContainer.clientHeight;
    const maxScroll = scrollHeight - clientHeight;
    
    if (maxScroll <= 0) return; // No need to scroll if content fits
    
    let startTime: number | null = null;
    const duration = 5500; // 5.5 seconds to scroll through all content
    const delay = 300; // Start scrolling after 300ms
    
    const animateScroll = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      
      if (elapsed < delay) {
        requestAnimationFrame(animateScroll);
        return;
      }
      
      const progress = Math.min((elapsed - delay) / duration, 1);
      
      // Use a more linear easing with subtle acceleration/deceleration
      let easeProgress;
      if (progress < 0.1) {
        // Gentle ease in for first 10%
        easeProgress = progress * progress * 10;
      } else if (progress > 0.9) {
        // Gentle ease out for last 10%
        const x = (progress - 0.9) * 10;
        easeProgress = 0.9 + (1 - (1 - x) * (1 - x)) * 0.1;
      } else {
        // Linear in the middle 80%
        easeProgress = 0.1 + (progress - 0.1) * (0.8 / 0.8);
      }
      
      scrollContainer.scrollTop = maxScroll * easeProgress;
      
      if (progress < 1) {
        requestAnimationFrame(animateScroll);
      }
    };
    
    const animationId = requestAnimationFrame(animateScroll);
    
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [results]);
  
  // Automated mouse movement and narration
  useEffect(() => {
    const automateDemo = async () => {
      // Wait a bit before starting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Show narration
      setShowNarration(true);
      setNarrationText("I'll search for Pratyush Chakraborty on LinkedIn and find relevant profiles.");
      
      // Show mouse cursor
      await new Promise(resolve => setTimeout(resolve, 2000));
      setShowMouse(true);
      
      // Move mouse to first result
      await new Promise(resolve => setTimeout(resolve, 1500));
      const firstResult = resultsRef.current[0];
      if (firstResult) {
        const rect = firstResult.getBoundingClientRect();
        const targetX = rect.left + rect.width / 2;
        const targetY = rect.top + rect.height / 2;
        
        // Animate mouse movement
        const startX = mousePos.x;
        const startY = mousePos.y;
        const duration = 1500; // Slower mouse movement
        const startTime = Date.now();
        
        const animateMouse = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const easeProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic
          
          const currentX = startX + (targetX - startX) * easeProgress;
          const currentY = startY + (targetY - startY) * easeProgress;
          
          setMousePos({ x: currentX, y: currentY });
          
          if (progress < 1) {
            requestAnimationFrame(animateMouse);
          } else {
            // Hover effect
            setTimeout(() => {
              setNarrationText("I'll open the LinkedIn profile to get more information about Pratyush Chakraborty.");
              
              // Click animation
              setTimeout(() => {
                setIsClicking(true);
                setTimeout(() => {
                  setIsClicking(false);
                  if (onNavigate) {
                    onNavigate(results[0].link);
                  }
                }, 300); // Slightly longer click
              }, 2000); // More time before clicking
            }, 800); // Longer hover pause
          }
        };
        
        requestAnimationFrame(animateMouse);
      }
    };
    
    automateDemo();
  }, []);

  return (
    <div className="search-results-overlay">
      <MouseCursor x={mousePos.x} y={mousePos.y} visible={showMouse} clicking={isClicking} />
      <Narration text={narrationText} visible={showNarration} />
      <div className="search-results-container">
        {/* Header */}
        <div className="search-results-header">
          <h3 className="search-results-title">Search results for "{query}"</h3>
          <button className="search-results-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Results list */}
        <div ref={listRef} className="search-results-list">
          {results.map((result, index) => (
            <div 
              key={index} 
              ref={el => { if (el) resultsRef.current[index] = el; }}
              className="search-result-item"
              onClick={() => onNavigate(result.link)}
              style={{
                transition: 'background 0.3s',
                background: showMouse && index === 0 && 
                  Math.abs(mousePos.x - (resultsRef.current[0]?.getBoundingClientRect().left + resultsRef.current[0]?.getBoundingClientRect().width / 2)) < 50 &&
                  Math.abs(mousePos.y - (resultsRef.current[0]?.getBoundingClientRect().top + resultsRef.current[0]?.getBoundingClientRect().height / 2)) < 30
                  ? 'rgba(255, 255, 255, 0.05)' : 'transparent'
              }}
            >
              {/* Result icon/favicon */}
              <div className="result-icon">
                {result.favicon ? (
                  <img src={result.favicon} alt="" />
                ) : (
                  <div className="result-icon-placeholder">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 0C4.477 0 0 4.477 0 10s4.477 10 10 10 10-4.477 10-10S15.523 0 10 0zm5 11h-4v4H9v-4H5V9h4V5h2v4h4v2z"/>
                    </svg>
                  </div>
                )}
              </div>

              {/* Result content */}
              <div className="result-content">
                <div className="result-title">{result.title}</div>
                {result.snippet && (
                  <div className="result-snippet">{result.snippet}</div>
                )}
                {result.source && (
                  <div className="result-source">{result.source}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="search-results-progress">
          <div className="progress-bar">
            <div className="progress-fill"></div>
          </div>
          <span className="progress-label">LIVE</span>
        </div>
      </div>
    </div>
  );
}