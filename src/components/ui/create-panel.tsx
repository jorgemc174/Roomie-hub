'use client';
import { useRef, type ReactNode } from 'react';
import { Plus, X, ChevronDown } from 'lucide-react';
export function CreatePanel({
  title,
  closeLabel,
  id,
  defaultOpen = false,
  children,
}: {
  title: string;
  closeLabel: string;
  id?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  function close() {
    if (!details.current) return;
    details.current.open = false;
    details.current.querySelector('summary')?.focus();
  }
  return (
    <details className="panel ui-create-panel" id={id} open={defaultOpen} ref={details}>
      <summary>
        <Plus size={20} aria-hidden="true" />
        <span>{title}</span>
        <ChevronDown className="ui-disclosure-chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="ui-create-body">
        {children}
        <button className="button secondary ui-create-close" type="button" onClick={close}>
          <X size={16} aria-hidden="true" />
          {closeLabel}
        </button>
      </div>
    </details>
  );
}
