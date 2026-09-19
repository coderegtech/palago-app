/**
 * TanStack Query configuration.
 *
 * Defaults are tuned for mobile networks in Palawan: assume the connection is
 * slow and intermittent, retry reads, and never retry writes automatically —
 * a silently retried booking or payment mutation is how duplicates happen.
 */

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { reportFailure } from '@/lib/report';

/** The first segment of a key names the feature (`['sos', 'open']` → `sos`). */
function where(kind: 'query' | 'mutation', key: readonly unknown[] | undefined): string {
  const root = key?.[0];
  return `${kind}:${typeof root === 'string' ? root : 'unknown'}`;
}

export const queryClient = new QueryClient({
  // One place for every failure the screens recover from, so none has to
  // remember to report. `reportFailure` drops the refusals the server meant.
  queryCache: new QueryCache({
    onError: (error, query) => reportFailure(error, where('query', query.queryKey)),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      reportFailure(error, where('mutation', mutation.options.mutationKey)),
  }),
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
