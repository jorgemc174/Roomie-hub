'use client';
import type { ComponentProps } from 'react';
import { CalendarView } from './calendar-view';
import { ManagedAgenda } from './agenda';

// Server pages cannot pass components; this client boundary injects the managed agenda so
// CalendarView itself stays free of server actions for isolated browser fixtures.
export function ManagedCalendar(props: Omit<ComponentProps<typeof CalendarView>, 'Agenda'>) {
  return <CalendarView {...props} Agenda={ManagedAgenda} />;
}
