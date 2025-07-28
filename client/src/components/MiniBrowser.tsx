import { useEffect, useRef, useState } from 'react';

export default function MiniBrowser() {
  const [img, setImg] = useState('');
  const wsRef = useRef<WebSocket>();

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001');
    ws.binaryType = 'arraybuffer';
    ws.onmessage = e => {
      const blob = new Blob([e.data], { type: 'image/jpeg' });
      setImg(URL.createObjectURL(blob));
    };
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  // Simple click→send mapping
  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = (e.target as HTMLImageElement).getBoundingClientRect();
    wsRef.current?.send(
      JSON.stringify({ cmd: 'click', x: e.clientX - rect.left, y: e.clientY - rect.top })
    );
  };

  return (
    <div className="rounded-xl border w-[420px] h-[260px] overflow-hidden">
      <div className="flex items-center h-8 px-2 bg-neutral-800 text-xs text-neutral-200">
        {/* fake address bar & nav buttons */}
      </div>
      <img
        src={img}
        onClick={handleClick}
        className="w-full h-[calc(100%-2rem)] object-cover select-none"
        draggable={false}
      />
    </div>
  );
}
