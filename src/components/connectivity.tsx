'use client';
import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
export function Connectivity({ message }: { message: string }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return offline ? (
    <div className="offline" role="status">
      <WifiOff size={18} aria-hidden="true" />
      {message}
    </div>
  ) : null;
}
