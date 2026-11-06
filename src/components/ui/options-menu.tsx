'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// Native disclosure rather than an ARIA menu: children may be links or full forms.
// Keep children mounted so closing the options never discards a draft or feedback.
export function OptionsMenu({ label, children }: { label: string; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  const id = useId();

  useEffect(() => {
    const element = details.current;
    if (!element) return;
    const trigger = element.querySelector('summary');
    function close(returnFocus: boolean) {
      if (!element?.open) return;
      element.open = false;
      if (returnFocus) trigger?.focus();
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !element?.contains(event.target))
        close(element?.contains(document.activeElement) ?? false);
    }
    function escape(event: KeyboardEvent) {
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
      if (event.key === 'Escape' && element?.open) {
        event.preventDefault();
        close(true);
      }
    }
    document.addEventListener('pointerdown', outside);
    element.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      element.removeEventListener('keydown', escape);
    };
  }, []);

  return (
    <details
      ref={details}
      className="ui-options-menu"
      onToggle={(event) => {
        if (event.target !== event.currentTarget) return;
        const element = event.currentTarget;
        setExpanded(element.open);
        if (element.open)
          element
            .querySelector<HTMLElement>(
              '.ui-options-body a[href], .ui-options-body summary, .ui-options-body button:not(:disabled), .ui-options-body input:not([type="hidden"]):not(:disabled), .ui-options-body select:not(:disabled)',
            )
            ?.focus();
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          event.currentTarget.open = false;
      }}
    >
      <summary aria-label={label} aria-expanded={expanded} aria-controls={id}>
        <span aria-hidden="true">⋯</span>
      </summary>
      <div
        id={id}
        className="ui-options-body stack"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('a[href]') &&
            details.current
          ) {
            details.current.open = false;
            details.current.querySelector('summary')?.focus();
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}
