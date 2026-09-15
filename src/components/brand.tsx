import Link from 'next/link';
import { House } from 'lucide-react';
export function Brand({ href = '/homes' }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <span className="brand-icon">
        <House size={22} aria-hidden="true" />
      </span>
      RoomieHub
    </Link>
  );
}
