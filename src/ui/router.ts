// Small hash router (ADR 0001). Pure parsing lives here so it can be tested without a DOM.
// Signals are created in store.ts only.

/** The main destinations, in tab order (design system README, Navigation). */
export const ROUTES = ['farm', 'city', 'character', 'bestiary'] as const;
export type Route = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: Route = 'farm';

/** Maps a location hash such as `#/city` or `#city` to a route. Empty and unknown hashes give the default route. */
export function parseHash(hash: string): Route {
  const first = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return ROUTES.find((route) => route === first) ?? DEFAULT_ROUTE;
}

export function hrefFor(route: Route): string {
  return `#/${route}`;
}

/** Calls `onChange` with the current route now and again on every hash change. Returns a stop function. */
export function watchHash(onChange: (route: Route) => void): () => void {
  const sync = () => onChange(parseHash(window.location.hash));
  window.addEventListener('hashchange', sync);
  sync();
  return () => window.removeEventListener('hashchange', sync);
}
