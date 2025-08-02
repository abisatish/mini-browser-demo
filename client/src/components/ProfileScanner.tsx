import { useState, useEffect } from 'react';
import './ProfileScanner.css';
import { ScanningIndicator } from './ScanningIndicator';

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
  const [isApiScan, setIsApiScan] = useState(false);
  
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
    
    // Check if we're already processing (auto-triggered)
    if (scanStatus !== 'idle' && scanStatus !== 'complete') {
      console.log('ProfileScanner visible, scan already in progress...');
      return;
    }
    
    // If idle, start a manual scan
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('ProfileScanner visible, starting manual scan...');
      wsRef.current.send(JSON.stringify({ cmd: 'scanProfile' }));
      setScanStatus('scanning');
    }
  }, [visible, wsRef]);
  
  // Listen for scan updates
  useEffect(() => {
    if (!wsRef.current) return;
    
    const handleMessage = (event: MessageEvent) => {
      // Skip binary messages (screenshots)
      if (typeof event.data !== 'string') return;
      
      try {
        const msg = JSON.parse(event.data);
        
        // Process all scanning-related messages
        if (msg.type === 'scanStatus' || msg.type === 'profileAnalysis' || msg.type === 'scanError' || 
            msg.type === 'apiScanStart' || msg.type === 'apiScanComplete' || msg.type === 'apiScanError') {
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
              
            // API scan messages
            case 'apiScanStart':
              setScanStatus('scanning');
              setStatusMessage(msg.message || 'Analyzing LinkedIn Profile via API...');
              setError(null);
              setAnalysis(null);
              setIsApiScan(true);
              break;
              
            case 'apiScanComplete':
              setAnalysis(msg.linkedInData);
              setScanStatus('complete');
              setIsApiScan(false);
              break;
              
            case 'apiScanError':
              setError(msg.error);
              setScanStatus('idle');
              setIsApiScan(false);
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
  
  // Show if either manually visible or during API scan
  if (!visible && !isApiScan) return null;
  
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
          ) : null}
        </div>
      </div>
      
      {/* Face ID Scanner Overlay - Always show for API scans */}
      <ScanningIndicator 
        isScanning={(scanStatus !== 'idle' && scanStatus !== 'complete' && !error) || isApiScan}
        message={statusMessage || 'Initializing scan...'}
      />
    </div>
  );
}