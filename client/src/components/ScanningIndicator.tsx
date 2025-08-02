import React from 'react';
import './ScanningIndicator.css';

interface ScanningIndicatorProps {
  isScanning: boolean;
  message?: string;
}

export const ScanningIndicator: React.FC<ScanningIndicatorProps> = ({ isScanning, message }) => {
  if (!isScanning) return null;

  return (
    <div className="scanning-overlay">
      <div className="scanning-container">
        <div className="face-id-scanner">
          <div className="scanner-line"></div>
          <svg className="face-id-icon" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            {/* Face outline */}
            <path
              d="M50 20 C30 20 15 35 15 55 C15 75 30 85 50 85 C70 85 85 75 85 55 C85 35 70 20 50 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            
            {/* Eyes */}
            <circle cx="35" cy="45" r="3" fill="currentColor" />
            <circle cx="65" cy="45" r="3" fill="currentColor" />
            
            {/* Nose */}
            <path
              d="M50 45 L50 55"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            
            {/* Mouth */}
            <path
              d="M40 65 Q50 70 60 65"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            
            {/* Scan brackets */}
            <path
              d="M10 30 L10 15 L25 15 M75 15 L90 15 L90 30 M90 70 L90 85 L75 85 M25 85 L10 85 L10 70"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="scanning-message">{message || 'Scanning LinkedIn Profile...'}</p>
      </div>
    </div>
  );
};