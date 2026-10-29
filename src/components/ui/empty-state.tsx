import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <section className="ui-empty-state">
      <span className="ui-state-icon" aria-hidden="true">
        {icon ?? <Inbox size={24} />}
      </span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action && <div className="actions">{action}</div>}
    </section>
  );
}
