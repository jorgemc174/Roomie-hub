'use client';

import type { ReactNode } from 'react';

export function CategoryFilter({ action, children }: { action: string; children: ReactNode }) {
  return (
    <form
      action={action}
      method="get"
      className="row wrap"
      onChange={(event) => event.currentTarget.requestSubmit()}
    >
      {children}
    </form>
  );
}
