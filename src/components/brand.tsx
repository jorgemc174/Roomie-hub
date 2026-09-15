import Link from 'next/link';
import { House } from 'lucide-react';
export function Brand() {
  return (
    <Link href="/homes" className="brand">
      <span className="brand-icon">
        <House size={22} aria-hidden="true" />
      </span>
      RoomieHub
    </Link>
  );
}
