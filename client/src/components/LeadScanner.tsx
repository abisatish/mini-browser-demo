import { useState } from 'react';
import './ProfileScanner.css';

interface Lead {
  name: string;
  title: string;
  company: string;
  location?: string;
  dateAdded?: string;
}

interface LeadScannerProps {
  screenshot: string;
  onClose: () => void;
  ws: WebSocket | null;
}

export default function LeadScanner({ screenshot, onClose, ws }: LeadScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);

  const startScan = async () => {
    setIsScanning(true);
    setError(null);
    setScanProgress(0);
    
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

    try {
      // Send screenshot to backend for AI processing
      const response = await fetch('http://localhost:3001/api/scan-leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ screenshot }),
      });

      if (!response.ok) {
        throw new Error('Failed to scan leads');
      }

      const data = await response.json();
      clearInterval(progressInterval);
      setScanProgress(100);
      
      if (data.leads && data.leads.length > 0) {
        setLeads(data.leads);
      } else {
        setError('No leads found on this page');
      }
    } catch (err) {
      clearInterval(progressInterval);
      setError(err instanceof Error ? err.message : 'Failed to scan leads');
      setScanProgress(0);
    } finally {
      setTimeout(() => {
        setIsScanning(false);
      }, 500);
    }
  };

  const downloadCSV = () => {
    if (leads.length === 0) return;

    // Create CSV content
    const headers = ['Name', 'Title', 'Company', 'Location', 'Date Added'];
    const csvContent = [
      headers.join(','),
      ...leads.map(lead => 
        [
          `"${lead.name}"`,
          `"${lead.title || ''}"`,
          `"${lead.company || ''}"`,
          `"${lead.location || ''}"`,
          `"${lead.dateAdded || ''}"`
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
    <div className="profile-scanner-overlay">
      <div className="profile-scanner-modal">
        <button className="profile-scanner-close" onClick={onClose}>×</button>
        
        <h2 className="profile-scanner-title">
          <span className="scanner-icon">📊</span>
          Sales Navigator Lead Scanner
        </h2>
        
        <p className="profile-scanner-description">
          Extract all visible leads from the current Sales Navigator page into a CSV file.
        </p>

        {!isScanning && leads.length === 0 && (
          <button className="profile-scanner-button" onClick={startScan}>
            <span className="button-icon">🔍</span>
            Scan Page for Leads
          </button>
        )}

        {isScanning && (
          <div className="scanning-animation">
            <div className="scan-line"></div>
            <div className="scan-progress">
              <div className="progress-bar" style={{ width: `${scanProgress}%` }}></div>
            </div>
            <p className="scan-status">Analyzing page content... {scanProgress}%</p>
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
            
            <button className="profile-scanner-button" onClick={startScan}>
              <span className="button-icon">🔄</span>
              Scan Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}