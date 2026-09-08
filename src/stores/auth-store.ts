/**
 * Session state.
 *
 * A synchronous mirror of the session supabase-js holds, so route guards can
 * read it during render instead of awaiting a promise. supabase-js remains the
 * owner — it persists and refreshes the tokens; this store only reflects them.
 *
 * The profile is deliberately NOT kept here. It is server state and lives in
 * TanStack Query (`useProfile`); duplicating it would create a second source of
 * truth that goes stale the moment a profile is edited.
 */

import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

interface AuthState {
  session: Session | null;
  /** False until the persisted session has been read once. Guards must wait. */
  initialized: boolean;

  setSession: (session: Session | null) => void;
  setInitialized: (initialized: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  initialized: false,

  setSession: (session) => set({ session }),
  setInitialized: (initialized) => set({ initialized }),
}));
