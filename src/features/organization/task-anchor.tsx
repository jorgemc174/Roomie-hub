'use client';

import { useEffect } from 'react';

// Fragment links must reveal occurrences even inside the closed backlog.
export function TaskAnchor({ instanceIds }: { instanceIds: string }) {
  useEffect(() => {
    function reveal() {
      const hash = window.location.hash.slice(1);
      if (!hash.startsWith('task-')) return;
      const target = document.getElementById(hash);
      if (!target?.classList.contains('task-row')) return;
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      target.scrollIntoView({ block: 'start' });
    }
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => window.removeEventListener('hashchange', reveal);
  }, [instanceIds]);
  return null;
}
