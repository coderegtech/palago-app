/**
 * manage-staff
 *
 * The one place PalaGo creates an account for somebody else: an admin
 * provisioning an operator, an operator provisioning a driver or a conductor.
 *
 * It exists because `auth.admin.createUser` needs the service-role key, which
 * must never reach the app (AGENTS.md, and docs/security.md). Everything this
 * function decides, it decides by asking the database as the signed-in caller —
 * the caller's role is read from `profiles`, never from a field in the request.
 * That keeps the authorisation rules in SQL where `verify-staff-accounts.mjs`
 * can test them against real signed-in roles, and leaves this file as plumbing.
 *
 * Two clients, on purpose:
 *
 *   `asCaller`  — the ordinary anon key carrying the caller's Authorization
 *                 header. Every authorisation question goes through this, so
 *                 RLS and the SECURITY DEFINER guards apply as usual.
 *   `asService` — the service role. Used ONLY for the auth-admin calls that
 *                 have no other route: create a user, set a password, ban or
 *                 unban. It never reads or writes an application table.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { fail, failFromRpc, handleOptions, ok } from '../_shared/http.ts';

type StaffRole = 'OPERATOR' | 'DRIVER' | 'ASSISTANT';

interface CreateBody {
  action: 'create';
  email: string;
  fullName: string;
  role: StaffRole;
  operatorId: string;
  phone?: string;
  licenseNumber?: string;
  licenseExpirationDate?: string;
  /** Attach the account to a crew record that already exists. */
  crewId?: string;
}

interface ResetBody {
  action: 'reset-password';
  userId: string;
}

interface StatusBody {
  action: 'set-account-status';
  userId: string;
  status: 'ACTIVE' | 'INACTIVE';
  reason?: string;
}

type Body = CreateBody | ResetBody | StatusBody;

/**
 * A password somebody has to read off a screen and type on a phone.
 *
 * No I/l/1 or O/0, because this gets handed over verbally or on paper at a
 * ticket counter and a misread character is a support call. 12 characters from
 * a 58-symbol alphabet is ~70 bits — and it is single-use anyway, since
 * `must_change_password` forces a new one at first sign-in.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function temporaryPassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  // Rejection-free modulo bias is immaterial here (58 into 2^32), and the
  // alternative is a retry loop on a value nobody keeps.
  return Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]).join('');
}

const STAFF_ROLES: StaffRole[] = ['OPERATOR', 'DRIVER', 'ASSISTANT'];

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return fail('VALIDATION_ERROR', 'Use POST.', 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return fail('UNAUTHORIZED');

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return fail('VALIDATION_ERROR', 'Expected a JSON body.');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });
  const asService = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  if (body.action === 'create') {
    const email = (body.email ?? '').trim().toLowerCase();
    const fullName = (body.fullName ?? '').trim();

    if (!isEmail(email)) return fail('VALIDATION_ERROR', 'A valid email address is required.');
    if (fullName.length < 2) return fail('VALIDATION_ERROR', 'A full name is required.');
    if (!STAFF_ROLES.includes(body.role)) return fail('VALIDATION_ERROR', 'Unknown role.');
    if (!body.operatorId) return fail('VALIDATION_ERROR', 'operatorId is required.');
    if (body.role === 'DRIVER' && !(body.licenseNumber ?? '').trim()) {
      return fail('VALIDATION_ERROR', 'A licence number is required for a driver.');
    }

    // Asked first, and asked as the caller. If this refuses, nothing has been
    // created and there is no orphan in auth.users to clean up.
    const { error: authError } = await asCaller.rpc('authorize_staff_provision', {
      p_role: body.role,
      p_operator_id: body.operatorId,
    });
    if (authError) return failFromRpc(authError);

    const password = temporaryPassword();

    const { data: created, error: createError } = await asService.auth.admin.createUser({
      email,
      password,
      // No SMTP is configured for this build, so an unconfirmed account could
      // never confirm itself. The address is vouched for by the admin or
      // operator who typed it, and the temporary password is the secret.
      email_confirm: true,
      user_metadata: { full_name: fullName, phone: body.phone ?? null },
    });

    if (createError || !created?.user) {
      const message = createError?.message ?? '';
      if (/already (been )?registered|already exists|duplicate/i.test(message)) {
        return fail('EMAIL_TAKEN');
      }
      console.error('createUser failed:', message);
      return fail('INTERNAL_ERROR');
    }

    const userId = created.user.id;

    // The `on_auth_user_created` trigger writes the profile, so it exists by
    // the time this returns. `provision_staff_account` re-checks authorisation
    // and does the rest in one transaction.
    const { data: provisioned, error: provisionError } = await asCaller.rpc(
      'provision_staff_account',
      {
        p_user_id: userId,
        p_role: body.role,
        p_operator_id: body.operatorId,
        p_full_name: fullName,
        p_phone: body.phone ?? undefined,
        p_license_number: body.licenseNumber ?? undefined,
        p_license_expiration_date: body.licenseExpirationDate ?? undefined,
        p_crew_id: body.crewId ?? undefined,
      },
    );

    if (provisionError) {
      // Compensating write, not a rollback — the auth user and the profile were
      // committed by a different connection and cannot be undone as one. Worth
      // being explicit about: if this delete itself fails, an unusable account
      // with role USER is left behind, which is logged loudly rather than
      // reported to the caller as success.
      const { error: cleanupError } = await asService.auth.admin.deleteUser(userId);
      if (cleanupError) {
        console.error(
          `Provisioning failed AND cleanup failed. Orphaned auth user ${userId} (${email}) ` +
            `now exists with role USER: ${cleanupError.message}`,
        );
      }
      return failFromRpc(provisionError);
    }

    // The only time this password is ever returned. It is not stored anywhere
    // in readable form, so if the creator loses it the way back is a reset,
    // not a lookup.
    return ok({
      ...(provisioned as Record<string, unknown>),
      email,
      temporaryPassword: password,
    });
  }

  // -------------------------------------------------------------------------
  // reset-password
  // -------------------------------------------------------------------------
  if (body.action === 'reset-password') {
    if (!body.userId) return fail('VALIDATION_ERROR', 'userId is required.');

    // Asked before anything changes. Same reach as deactivating them.
    const { error: authError } = await asCaller.rpc('authorize_staff_manage', {
      p_user_id: body.userId,
    });
    if (authError) return failFromRpc(authError);

    const password = temporaryPassword();

    const { error: updateError } = await asService.auth.admin.updateUserById(body.userId, {
      password,
    });
    if (updateError) {
      console.error('Password reset failed:', updateError.message);
      return fail('INTERNAL_ERROR');
    }

    // Flagged after the password actually changed, and re-authorised inside
    // `flag_password_reset`. The other order would leave somebody staring at a
    // forced-change screen with a password that still works.
    const { error: flagError } = await asCaller.rpc('flag_password_reset', {
      p_user_id: body.userId,
    });
    if (flagError) return failFromRpc(flagError);

    return ok({ userId: body.userId, temporaryPassword: password });
  }

  // -------------------------------------------------------------------------
  // set-account-status
  // -------------------------------------------------------------------------
  if (body.action === 'set-account-status') {
    if (!body.userId) return fail('VALIDATION_ERROR', 'userId is required.');
    if (body.status !== 'ACTIVE' && body.status !== 'INACTIVE') {
      return fail('VALIDATION_ERROR', 'status must be ACTIVE or INACTIVE.');
    }

    // The database is the authority. If this refuses, no ban is applied.
    const { data, error } = await asCaller.rpc('set_account_status', {
      p_user_id: body.userId,
      p_status: body.status,
      p_reason: body.reason ?? undefined,
    });
    if (error) return failFromRpc(error);

    // RLS already refuses a deactivated account everything, but its access
    // token stays syntactically valid until it expires. The ban ends the
    // session now instead of up to an hour later.
    const { error: banError } = await asService.auth.admin.updateUserById(body.userId, {
      ban_duration: body.status === 'INACTIVE' ? '876000h' : 'none',
    });

    if (banError) {
      // The row is the source of truth and it is already written, so this is
      // reported rather than rolled back: the person cannot read or write
      // anything, they simply keep a dead token for a while.
      console.error('Account status written but the auth ban failed:', banError.message);
      return ok({ ...(data as Record<string, unknown>), sessionRevoked: false });
    }

    return ok({ ...(data as Record<string, unknown>), sessionRevoked: true });
  }

  return fail('VALIDATION_ERROR', 'Unknown action.');
});
