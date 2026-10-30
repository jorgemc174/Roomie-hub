'use client';
import { useEffect, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { adjacentDestination, swipeDirection } from '@/lib/swipe-navigation';

export function SwipeNavigation({ label }: { label: string }) {
  const router = useRouter(),
    pathname = usePathname();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('main#main');
    if (!main) return;
    main.dataset.swipeSurface = 'true';
    let start: { x: number; y: number; time: number; id: number } | null = null;
    const reset = () => {
      start = null;
      main.style.removeProperty('--swipe-drag');
      delete main.dataset.swipeActive;
    };
    function down(event: PointerEvent) {
      if (
        event.pointerType !== 'touch' ||
        !event.isPrimary ||
        pending ||
        !main!.querySelector('nav.section-tabs [aria-current]') ||
        document.querySelector('dialog[open]')
      ) {
        reset();
        return;
      }
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest(
          'a,button,input,textarea,select,label,summary,dialog,[contenteditable="true"],[data-no-swipe],.chat-log,.calendar-grid',
        ) ||
        window.getSelection()?.toString()
      )
        return;
      for (let el: Element | null = target; el && el !== main; el = el.parentElement) {
        if (
          el.scrollWidth > el.clientWidth + 2 &&
          /auto|scroll/.test(getComputedStyle(el).overflowX)
        )
          return;
      }
      if (event.clientX < 24 || event.clientX > innerWidth - 24) return;
      start = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId };
    }
    function move(event: PointerEvent) {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x,
        dy = event.clientY - start.y;
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        reset();
        return;
      }
      if (Math.abs(dx) > 12) {
        main!.dataset.swipeActive = 'true';
        main!.style.setProperty('--swipe-drag', `${Math.max(-12, Math.min(12, dx * 0.08))}px`);
      }
    }
    function up(event: PointerEvent) {
      if (!start || start.id !== event.pointerId) return;
      const direction = swipeDirection({
        startX: start.x,
        startY: start.y,
        endX: event.clientX,
        endY: event.clientY,
        elapsed: performance.now() - start.time,
        width: innerWidth,
      });
      reset();
      const nav = main!.querySelector<HTMLElement>('nav.section-tabs');
      const links = Array.from(nav?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []).map(
        (link) => ({
          href: link.getAttribute('href')!,
          current: link.hasAttribute('aria-current'),
        }),
      );
      const href = adjacentDestination(links, direction);
      if (href) startTransition(() => router.push(href, { scroll: false }));
    }
    main.addEventListener('pointerdown', down, { passive: true });
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', up, { passive: true });
    document.addEventListener('pointercancel', reset, { passive: true });
    return () => {
      reset();
      delete main.dataset.swipeSurface;
      main.removeEventListener('pointerdown', down);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', reset);
    };
  }, [pathname, router, pending]);
  return (
    <div
      className={`route-progress${pending ? ' is-pending' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{pending ? label : ''}</span>
    </div>
  );
}
