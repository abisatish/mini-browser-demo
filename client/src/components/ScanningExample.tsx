import React, { useState } from 'react';
import { ScanningIndicator } from './ScanningIndicator';

// Example of how to use the scanning indicator with API calls
export const ScanningExample: React.FC = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);

  const scanProfile = async (linkedInUrl: string) => {
    setIsScanning(true);
    setScanResult(null);

    try {
      const response = await fetch('https://insightful-wisdom-production.up.railway.app/api/contextualized', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          linkedInUrl,
          subqueries: ["What is their current role?", "What companies have they worked at?"]
        }),
      });

      const data = await response.json();
      setScanResult(data);
    } catch (error) {
      console.error('Scan failed:', error);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div>
      <button onClick={() => scanProfile('https://www.linkedin.com/in/example/')}>
        Scan Profile
      </button>
      
      <ScanningIndicator 
        isScanning={isScanning} 
        message="Analyzing LinkedIn Profile..."
      />
      
      {scanResult && (
        <div>
          <h3>Scan Results:</h3>
          <pre>{JSON.stringify(scanResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};