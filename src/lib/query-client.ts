/**
 * TanStack Query configuration.
 *
 * Defaults are tuned for mobile networks in Palawan: assume the connection is
 * slow and intermittent, retry reads, and never retry writes automatically —
 * a silently retried booking or payment mutation is how duplicates happen.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Idempotency is enforced server-side, but the client should not be the
      // one generating duplicate attempts in the first place.
      retry: 0,
    },
  },
});
