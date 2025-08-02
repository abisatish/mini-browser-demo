import { useState, useEffect } from 'react';
import './ProfileScanner.css';

interface ProfileAnalysis {
  name: string;
  currentPosition: string;
  currentCompany: string;
  previousCompanies: string[];
  education: string;
  skills: string[];
  summary: string;
}

interface ProfileScannerProps {
  wsRef: React.MutableRefObject<WebSocket | null>;
  visible: boolean;
  onClose: () => void;
}

export default function ProfileScanner({ wsRef, visible, onClose }: ProfileScannerProps) {
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'capturing' | 'analyzing' | 'complete'>('scanning');
  const [statusMessage, setStatusMessage] = useState('Processing profile...');
  const [analysis, setAnalysis] = useState<ProfileAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Force re-render when status changes
  useEffect(() => {
    console.log('Scan status changed to:', scanStatus);
  }, [scanStatus]);
  
  useEffect(() => {
    if (!visible) {
      // Reset state when hidden
      setScanStatus('idle');
      setAnalysis(null);
      setError(null);
      return;
    }
    
    // Don't start a new scan - just wait for incoming analysis
    // The scan is already triggered by the server
    console.log('ProfileScanner visible, waiting for analysis...');
  }, [visible, wsRef]);
  
  // Listen for scan updates
  useEffect(() => {
    if (!wsRef.current) return;
    
    const handleMessage = (event: MessageEvent) => {
      // Skip binary messages (screenshots)
      if (typeof event.data !== 'string') return;
      
      try {
        const msg = JSON.parse(event.data);
        
        // Only process messages relevant to profile scanning
        if (msg.type === 'scanStatus' || msg.type === 'profileAnalysis' || msg.type === 'scanError') {
          console.log('ProfileScanner received:', msg.type, msg);
          
          switch (msg.type) {
            case 'scanStatus':
              setScanStatus(msg.status);
              setStatusMessage(msg.message);
              break;
              
            case 'profileAnalysis':
              setAnalysis(msg.analysis);
              setScanStatus('complete');
              break;
              
            case 'scanError':
              setError(msg.error);
              setScanStatus('idle');
              break;
          }
        }
      } catch (e) {
        // Ignore non-JSON messages
      }
    };
    
    wsRef.current.addEventListener('message', handleMessage);
    
    return () => {
      wsRef.current?.removeEventListener('message', handleMessage);
    };
  }, [wsRef, visible]); // Add visible to deps to re-register when shown
  
  // Add timeout handling
  useEffect(() => {
    if (!visible || scanStatus === 'idle' || scanStatus === 'complete') return;
    
    // If stuck in a state for too long, show error
    const timeout = setTimeout(() => {
      console.log('Scan timeout - stuck in:', scanStatus);
      setError('Scan timeout - please try again');
      setScanStatus('idle');
    }, 15000); // 15 second timeout
    
    return () => clearTimeout(timeout);
  }, [scanStatus, visible]);
  
  if (!visible) return null;
  
  return (
    <div className="profile-scanner-overlay">
      <div className="profile-scanner-container">
        {/* Header */}
        <div className="scanner-header">
          <h3>LinkedIn Profile Analysis</h3>
          <button className="scanner-close" onClick={onClose}>×</button>
        </div>
        
        {/* Content */}
        <div className="scanner-content">
          {error ? (
            <div className="scanner-error">
              <p>Error: {error}</p>
            </div>
          ) : scanStatus === 'complete' && analysis ? (
            <div className="scanner-results">
              <div className="result-section">
                <h4>{analysis.name}</h4>
                <p className="current-role">{analysis.currentPosition} at {analysis.currentCompany}</p>
              </div>
              
              {analysis.previousCompanies.length > 0 && (
                <div className="result-section">
                  <h5>Previous Experience</h5>
                  <ul>
                    {analysis.previousCompanies.map((company, i) => (
                      <li key={i}>{company}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div className="result-section">
                <h5>Education</h5>
                <p>{analysis.education}</p>
              </div>
              
              <div className="result-section">
                <h5>Key Skills</h5>
                <div className="skills-list">
                  {analysis.skills.map((skill, i) => (
                    <span key={i} className="skill-tag">{skill}</span>
                  ))}
                </div>
              </div>
              
              <div className="result-section">
                <h5>Summary</h5>
                <p>{analysis.summary}</p>
              </div>
            </div>
          ) : (
            <div className="scanner-loading">
              <div className="scan-animation">
                <div className="scan-line"></div>
                {scanStatus === 'analyzing' && (
                  <div className="ai-thinking">
                    <div className="thinking-dot"></div>
                    <div className="thinking-dot"></div>
                    <div className="thinking-dot"></div>
                  </div>
                )}
              </div>
              <p className="status-message">{statusMessage || 'Initializing scan...'}</p>
              <div className="progress-dots">
                <span className={scanStatus === 'scanning' || scanStatus === 'capturing' || scanStatus === 'analyzing' ? 'active' : ''}>Scanning</span>
                <span className={scanStatus === 'capturing' || scanStatus === 'analyzing' ? 'active' : ''}>Capturing</span>
                <span className={scanStatus === 'analyzing' ? 'active' : ''}>Analyzing</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}