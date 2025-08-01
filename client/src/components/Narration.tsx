import { useEffect, useState } from 'react';
import './Narration.css';

interface NarrationProps {
  text: string;
  visible: boolean;
}

export default function Narration({ text, visible }: NarrationProps) {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  
  useEffect(() => {
    if (!visible || !text) {
      setDisplayText('');
      return;
    }
    
    setIsTyping(true);
    setDisplayText('');
    
    // Typewriter effect
    let currentIndex = 0;
    const typingInterval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayText(text.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(typingInterval);
        setIsTyping(false);
      }
    }, 30);
    
    return () => clearInterval(typingInterval);
  }, [text, visible]);
  
  if (!visible || !displayText) return null;
  
  return (
    <div className="narration-container">
      <div className="narration-box">
        <div className="narration-text">
          {displayText}
          {isTyping && <span className="typing-cursor">|</span>}
        </div>
      </div>
    </div>
  );
}