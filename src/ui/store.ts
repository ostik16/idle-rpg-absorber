// The only place that creates signals (ADR 0001). The engine adapter (character views, lists) comes in a later issue.
import { signal } from '@preact/signals';
import { DEFAULT_ROUTE, watchHash, type Route } from './router';

export const route = signal<Route>(DEFAULT_ROUTE);

/** Keeps `route` in step with the URL hash. Call once at startup. */
export function startRouteSync(): () => void {
  return watchHash((next) => {
    route.value = next;
  });
}
