import { useState, useEffect } from 'react';
import './LeadScanner.css';

interface Lead {
  name: string;
  title: string;
  company: string;
}

interface LeadScannerProps {
  wsRef: React.MutableRefObject<WebSocket | null>;
  onClose: () => void;
}

export default function LeadScanner({ wsRef, onClose }: LeadScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Listen for WebSocket messages
  useEffect(() => {
    if (!wsRef.current) return;

    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === 'leadsAnalysis') {
            console.log('Received leads analysis:', msg);
            
            // Clear intervals
            if ((window as any).__leadScannerInterval) {
              clearInterval((window as any).__leadScannerInterval);
            }
            if ((window as any).__leadScannerTimeout) {
              clearTimeout((window as any).__leadScannerTimeout);
            }
            
            setScanProgress(100);
            
            if (msg.leads && msg.leads.length > 0) {
              setLeads(msg.leads);
            } else if (msg.error) {
              setError(msg.error);
            } else {
              setError('No leads found on this page');
            }
            
            setTimeout(() => {
              setIsScanning(false);
            }, 500);
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      }
    };

    wsRef.current.addEventListener('message', handleMessage);
    
    return () => {
      if (wsRef.current) {
        wsRef.current.removeEventListener('message', handleMessage);
      }
    };
  }, [wsRef]);

  const startScan = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Connection lost. Please refresh the page.');
      return;
    }

    setIsScanning(true);
    setError(null);
    setScanProgress(0);
    setLeads([]);
    
    // Send command to backend to scan leads
    console.log('Sending scanLeads command via WebSocket');
    wsRef.current.send(JSON.stringify({ cmd: 'scanLeads' }));
    
    // Animate progress
    const progressInterval = setInterval(() => {
      setScanProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    // Set timeout for scan
    const timeoutId = setTimeout(() => {
      clearInterval(progressInterval);
      setError('Scan timed out. Please try again.');
      setIsScanning(false);
      setScanProgress(0);
    }, 30000); // 30 second timeout

    // Store intervals for cleanup
    (window as any).__leadScannerInterval = progressInterval;
    (window as any).__leadScannerTimeout = timeoutId;
  };

  const downloadCSV = () => {
    if (leads.length === 0) return;

    // Create CSV content
    const headers = ['Name', 'Title', 'Company'];
    const csvContent = [
      headers.join(','),
      ...leads.map(lead => 
        [
          `"${lead.name}"`,
          `"${lead.title || ''}"`,
          `"${lead.company || ''}"`
        ].join(',')
      )
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales_navigator_leads_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="lead-scanner-overlay">
      <div className="lead-scanner-modal">
        <button className="lead-scanner-close" onClick={onClose}>×</button>
        
        <h2 className="lead-scanner-title">
          <span className="scanner-icon">📊</span>
          Sales Navigator Lead Scanner
        </h2>
        
        <p className="lead-scanner-description">
          Extract all leads from the entire Sales Navigator page (including content below the fold) into a CSV file.
        </p>

        {!isScanning && leads.length === 0 && (
          <button className="lead-scanner-button" onClick={startScan}>
            <span className="button-icon">🔍</span>
            Scan Full Page for Leads
          </button>
        )}

        {isScanning && (
          <div className="scanning-animation">
            <div className="scan-line"></div>
            <div className="scanning-grid">
              <div className="scan-cell"></div>
              <div className="scan-cell"></div>
              <div className="scan-cell"></div>
              <div className="scan-cell"></div>
              <div className="scan-cell"></div>
              <div className="scan-cell"></div>
            </div>
            <div className="scan-progress">
              <div className="progress-bar" style={{ width: `${scanProgress}%` }}></div>
            </div>
            <p className="scan-status">
              {scanProgress < 20 && "📸 Capturing full page..."}
              {scanProgress >= 20 && scanProgress < 40 && "🔍 Scanning all leads..."}
              {scanProgress >= 40 && scanProgress < 60 && "📝 Extracting data..."}
              {scanProgress >= 60 && scanProgress < 80 && "🏢 Processing details..."}
              {scanProgress >= 80 && "✨ Finalizing results..."}
              {" "}{scanProgress}%
            </p>
          </div>
        )}

        {error && (
          <div className="scan-error">
            <span>⚠️</span> {error}
          </div>
        )}

        {leads.length > 0 && !isScanning && (
          <div className="scan-results">
            <div className="results-header">
              <h3>✅ Found {leads.length} leads</h3>
              <button className="download-csv-button" onClick={downloadCSV}>
                <span>📥</span> Download CSV
              </button>
            </div>
            
            <div className="leads-preview">
              <table className="leads-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Title</th>
                    <th>Company</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.slice(0, 5).map((lead, index) => (
                    <tr key={index}>
                      <td>{lead.name}</td>
                      <td>{lead.title}</td>
                      <td>{lead.company}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leads.length > 5 && (
                <p className="more-leads">...and {leads.length - 5} more leads</p>
              )}
            </div>
            
            <button className="lead-scanner-button" onClick={startScan}>
              <span className="button-icon">🔄</span>
              Scan Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}