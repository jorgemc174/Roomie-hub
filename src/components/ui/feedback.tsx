import type { ReactNode } from 'react';
import { CircleCheck, CircleAlert, Info } from 'lucide-react';
export function Feedback({
  kind = 'info',
  children,
}: {
  kind?: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const Icon = kind === 'error' ? CircleAlert : kind === 'success' ? CircleCheck : Info;
  return (
    <div className={`notice ui-feedback ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
