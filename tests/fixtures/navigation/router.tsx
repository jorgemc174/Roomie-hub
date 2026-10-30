// Router boundary for isolated component tests, never imported by the application.
import { createContext, useContext } from 'react';
export const RouterContext = createContext<{
  path: string;
  push: (href: string, options?: { scroll?: boolean }) => void;
}>({
  path: '/homes/demo/organization',
  push: () => {},
});
export function useRouter() {
  return useContext(RouterContext);
}
export function usePathname() {
  return useContext(RouterContext).path.split('?')[0];
}

// Next integrates native History API updates with useSearchParams. Reproduce that
// adapter boundary in this isolated component test; no server data is substituted.
import { useSyncExternalStore } from 'react';
const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  window.addEventListener('fixture:history', listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('fixture:history', listener);
  };
};
export function useSearchParams() {
  return new URLSearchParams(
    useSyncExternalStore(
      subscribe,
      () => window.location.search,
      () => '',
    ),
  );
}
