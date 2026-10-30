import type { ReactNode } from 'react';
import { Settings2, SlidersHorizontal, History, ChevronDown } from 'lucide-react';

// Inline disclosure, not an ARIA menu: children can contain normal forms and links.
// Native details keeps drafts mounted and supports keyboard activation without JS.
export function SectionDisclosure({
  title,
  children,
  kind = 'settings',
  defaultOpen = false,
  id,
}: {
  title: string;
  children: ReactNode;
  kind?: 'settings' | 'filters' | 'history';
  defaultOpen?: boolean;
  id?: string;
}) {
  const Icon = kind === 'filters' ? SlidersHorizontal : kind === 'history' ? History : Settings2;
  return (
    <details className="section-disclosure" id={id} open={defaultOpen}>
      <summary>
        <Icon size={18} aria-hidden="true" />
        <span>{title}</span>
        <ChevronDown className="ui-disclosure-chevron" size={16} aria-hidden="true" />
      </summary>
      <div className="section-disclosure-body stack">{children}</div>
    </details>
  );
}
