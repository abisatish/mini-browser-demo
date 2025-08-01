import { useEffect, useRef } from 'react';
import './SearchResults.css';

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
    const duration = 4000; // 4 seconds to scroll through all content
    const delay = 500; // Start scrolling after 500ms
    
    const animateScroll = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      
      if (elapsed < delay) {
        requestAnimationFrame(animateScroll);
        return;
      }
      
      const progress = Math.min((elapsed - delay) / duration, 1);
      const easeProgress = 0.5 - Math.cos(progress * Math.PI) / 2; // Ease in-out
      
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

  return (
    <div className="search-results-overlay">
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
              className="search-result-item"
              onClick={() => onNavigate(result.link)}
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