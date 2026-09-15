/**
 * Staff accounts and crew records.
 *
 * Two kinds of call live here and they are not interchangeable:
 *
 *   - anything that creates, resets or disables a LOGIN goes through the
 *     `manage-staff` Edge Function, because `auth.admin.createUser` needs the
 *     service-role key and that must never reach the app;
 *   - everything else — crew records, availability, edits — is an ordinary RPC,
 *     where the database is the one deciding who may do it.
 *
 * Nothing here decides anything. Whether an operator may provision this driver,
 * or deactivate that account, is answered by `authorize_staff_provision` and
 * `authorize_staff_manage` in SQL, as the signed-in caller. A screen that hides
 * a button is a courtesy; it is not the control.
 */

import { AccountStatus, AvailabilityStatus, CrewKind, UserRole } from '@/constants/enums';
import { env } from '@/lib/env';
import { AppError, fromRpcError, toAppError } from '@/lib/errors';
import { ErrorCode } from '@/constants/errors';
import { supabase } from '@/lib/supabase';
import type { ISODate, UUID } from '@/types/models';

/** A row of `operator_crew`: the crew record and its account, side by side. */
export interface CrewMember {
  id: UUID;
  kind: CrewKind;
  operatorId: UUID;
  /** The auth account, when there is one. */
  userId: UUID | null;
  name: string;
  phone: string | null;
  /** Drivers only. */
  licenseNumber: string | null;
  licenseExpirationDate: ISODate | null;
  /** Whether they may be given a NEW trip. */
  availabilityStatus: AvailabilityStatus;
  unavailableReason: string | null;
  hasAccount: boolean;
  accountEmail: string | null;
  /** Whether they may sign in. Null when there is no account at all. */
  accountStatus: AccountStatus | null;
  mustChangePassword: boolean | null;
  createdAt: string;
}

interface CrewRow {
  id: string;
  crew_kind: CrewKind;
  operator_id: string;
  user_id: string | null;
  name: string;
  phone: string | null;
  license_number: string | null;
  license_expiration_date: string | null;
  availability_status: AvailabilityStatus;
  unavailable_reason: string | null;
  has_account: boolean;
  account_email: string | null;
  account_status: AccountStatus | null;
  must_change_password: boolean | null;
  created_at: string;
}

const CREW_COLUMNS =
  'id, crew_kind, operator_id, user_id, name, phone, license_number, ' +
  'license_expiration_date, availability_status, unavailable_reason, ' +
  'has_account, account_email, account_status, must_change_password, created_at';

function toCrewMember(row: CrewRow): CrewMember {
  return {
    id: row.id,
    kind: row.crew_kind,
    operatorId: row.operator_id,
    userId: row.user_id,
    name: row.name,
    phone: row.phone,
    licenseNumber: row.license_number,
    licenseExpirationDate: row.license_expiration_date,
    availabilityStatus: row.availability_status,
    unavailableReason: row.unavailable_reason,
    hasAccount: row.has_account,
    accountEmail: row.account_email,
    accountStatus: row.account_status,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at,
  };
}

/** What comes back once, and only once, when an account is provisioned. */
export interface ProvisionedAccount {
  userId: UUID;
  email: string;
  /** Shown to whoever created the account. It is not stored anywhere readable. */
  temporaryPassword: string;
  crewId: UUID | null;
}

export interface CreateStaffInput {
  email: string;
  fullName: string;
  role: Extract<UserRole, 'OPERATOR' | 'DRIVER' | 'ASSISTANT'>;
  operatorId: UUID;
  phone?: string;
  licenseNumber?: string;
  licenseExpirationDate?: ISODate;
  /** Attach the login to a crew record that already exists. */
  crewId?: UUID;
}

export interface CreateCrewInput {
  kind: CrewKind;
  name: string;
  phone?: string;
  licenseNumber?: string;
  licenseExpirationDate?: ISODate;
  /** Admins act on any operator; an operator's own is inferred server-side. */
  operatorId?: UUID;
}

interface FunctionEnvelope<T> {
  success: boolean;
  data?: T;
  code?: string;
  message?: string;
}

/**
 * Calls `manage-staff` with the caller's session.
 *
 * `supabase.functions.invoke` swallows the body of a non-2xx response, and the
 * body is where the error code is — so this does the fetch itself, the same way
 * `payment-service` does, and turns the envelope into an AppError the screens
 * can branch on.
 */
async function manageStaff<T>(body: Record<string, unknown>): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const accessToken = session.session?.access_token;
  if (!accessToken) throw new AppError(ErrorCode.UNAUTHORIZED);

  let envelope: FunctionEnvelope<T>;
  try {
    const response = await fetch(`${env.supabaseUrl}/functions/v1/manage-staff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.supabasePublishableKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
    envelope = (await response.json()) as FunctionEnvelope<T>;
  } catch {
    throw new AppError(ErrorCode.NETWORK_ERROR);
  }

  if (!envelope.success) {
    const code = (envelope.code ?? ErrorCode.INTERNAL_ERROR) as ErrorCode;
    throw new AppError(code, envelope.message);
  }

  return envelope.data as T;
}

export const staffService = {
  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * Crew for the caller's operator, or all of it for an admin.
   *
   * Reads `operator_crew`, never `drivers`/`assistants` directly: the account
   * status lives on `profiles`, which an operator cannot read, so the view is
   * the only place the two statuses appear together.
   */
  async listCrew(kind?: CrewKind): Promise<CrewMember[]> {
    let query = supabase.from('operator_crew').select(CREW_COLUMNS).order('name');
    if (kind) query = query.eq('crew_kind', kind);

    const { data, error } = await query;
    if (error) throw toAppError(error);
    return (data as unknown as CrewRow[]).map(toCrewMember);
  },

  /** Recent administrative activity for one account. Admin only. */
  async activity(userId: UUID, limit = 50) {
    const { data, error } = await supabase.rpc('staff_activity', {
      p_user_id: userId,
      p_limit: limit,
    });
    if (error) throw fromRpcError(error);
    return (data ?? []) as unknown as {
      id: UUID;
      action: string;
      entity_type: string;
      entity_id: UUID | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }[];
  },

  // -------------------------------------------------------------------------
  // Accounts — through the Edge Function
  // -------------------------------------------------------------------------

  async createAccount(input: CreateStaffInput): Promise<ProvisionedAccount> {
    const result = await manageStaff<{
      userId: UUID;
      email: string;
      temporaryPassword: string;
      crewId: UUID | null;
    }>({
      action: 'create',
      email: input.email.trim().toLowerCase(),
      fullName: input.fullName.trim(),
      role: input.role,
      operatorId: input.operatorId,
      phone: input.phone?.trim() || undefined,
      licenseNumber: input.licenseNumber?.trim() || undefined,
      licenseExpirationDate: input.licenseExpirationDate || undefined,
      crewId: input.crewId || undefined,
    });

    return {
      userId: result.userId,
      email: result.email,
      temporaryPassword: result.temporaryPassword,
      crewId: result.crewId ?? null,
    };
  },

  async resetPassword(userId: UUID): Promise<{ temporaryPassword: string }> {
    return manageStaff<{ userId: UUID; temporaryPassword: string }>({
      action: 'reset-password',
      userId,
    });
  },

  /**
   * Opens or closes the door. Deletes nothing: the trips they drove, the
   * tickets they scanned and the assignments they held all stay.
   */
  async setAccountStatus(
    userId: UUID,
    status: AccountStatus,
    reason?: string,
  ): Promise<{ accountStatus: AccountStatus; sessionRevoked: boolean }> {
    return manageStaff({
      action: 'set-account-status',
      userId,
      status,
      reason: reason?.trim() || undefined,
    });
  },

  // -------------------------------------------------------------------------
  // Crew records — ordinary RPCs
  // -------------------------------------------------------------------------

  async createCrew(input: CreateCrewInput): Promise<{ id: UUID }> {
    const { data, error } = await supabase.rpc('create_crew_member', {
      p_kind: input.kind,
      p_name: input.name.trim(),
      p_phone: input.phone?.trim() || undefined,
      p_license_number: input.licenseNumber?.trim() || undefined,
      p_license_expiration_date: input.licenseExpirationDate || undefined,
      p_operator_id: input.operatorId || undefined,
    });
    if (error) throw fromRpcError(error);
    return data as unknown as { id: UUID };
  },

  async updateCrew(
    kind: CrewKind,
    crewId: UUID,
    input: { name: string; phone?: string; licenseNumber?: string; licenseExpirationDate?: ISODate },
  ): Promise<void> {
    const { error } = await supabase.rpc('update_crew_member', {
      p_kind: kind,
      p_crew_id: crewId,
      p_name: input.name.trim(),
      p_phone: input.phone?.trim() || undefined,
      p_license_number: input.licenseNumber?.trim() || undefined,
      p_license_expiration_date: input.licenseExpirationDate || undefined,
    });
    if (error) throw fromRpcError(error);
  },

  /**
   * The rest-day switch. Sign-in is untouched, and so is any trip they have
   * already been given — what changes is eligibility for the next one.
   */
  async setAvailability(
    kind: CrewKind,
    crewId: UUID,
    status: AvailabilityStatus,
    reason?: string,
  ): Promise<void> {
    const { error } = await supabase.rpc('set_crew_availability', {
      p_kind: kind,
      p_crew_id: crewId,
      p_status: status,
      p_reason: reason?.trim() || undefined,
    });
    if (error) throw fromRpcError(error);
  },

  /** Clears the forced-change flag, after the account holder has actually set one. */
  async markPasswordChanged(): Promise<void> {
    const { error } = await supabase.rpc('mark_password_changed');
    if (error) throw fromRpcError(error);
  },
};
