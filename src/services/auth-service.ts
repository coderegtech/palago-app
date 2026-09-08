/**
 * Authentication and profile access.
 *
 * The only module that talks to `supabase.auth` or the `profiles` table.
 * Screens go through the hooks in `src/hooks/`, never through this directly.
 *
 * Note what is absent: nothing here can set a `role`. The database revokes the
 * column grant that would allow it, and the sign-up trigger ignores any role
 * supplied in user metadata. Changing someone's role is an administrative
 * action performed with the service role, never from the app.
 */

import type { Session } from '@supabase/supabase-js';

import { AppError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { ErrorCode } from '@/constants/errors';
import type { ProfileInput } from '@/schemas/auth';
import type { Profile } from '@/types/models';
import type { Tables } from '@/types/database';

type ProfileRow = Tables<'profiles'>;

/** The database is snake_case; the app is camelCase. This is the only crossing point. */
function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    role: row.role,
    operatorId: row.operator_id,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SignUpParams {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

export const authService = {
  async getSession(): Promise<Session | null> {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw toAppError(error);
    return data.session;
  },

  /**
   * `full_name` and `phone` are passed as user metadata; the `handle_new_user`
   * database trigger is what actually creates the profile row, so a sign-up
   * cannot half-succeed into an auth user with no profile.
   *
   * With email confirmations enabled the returned session is null and the user
   * must confirm first — the caller has to handle both outcomes.
   */
  async signUp({ fullName, email, phone, password }: SignUpParams): Promise<Session | null> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone } },
    });
    if (error) throw toAppError(error);
    return data.session;
  },

  async signIn(email: string, password: string): Promise<Session> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw toAppError(error);
    if (!data.session) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Could not sign you in. Please try again.');
    }
    return data.session;
  },

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw toAppError(error);
  },

  /**
   * Always resolves, even for an address with no account — telling the caller
   * that an email is unknown turns this form into an account-enumeration oracle.
   */
  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw toAppError(error);
  },

  /** Requires an active session — reached through the emailed recovery link. */
  async updatePassword(password: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw toAppError(error);
  },

  async getProfile(userId: string): Promise<Profile> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw toAppError(error);
    return toProfile(data);
  },

  async updateProfile(userId: string, input: ProfileInput): Promise<Profile> {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name: input.fullName,
        phone: input.phone,
        emergency_contact_name: input.emergencyContactName || null,
        emergency_contact_phone: input.emergencyContactPhone || null,
      })
      .eq('id', userId)
      .select('*')
      .single();

    if (error) throw toAppError(error);
    return toProfile(data);
  },
};
