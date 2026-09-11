/**
 * Emergency assistance.
 *
 * Nothing here writes `sos_incidents` directly — the table has no client write
 * policy at all. Raising an alert goes through `trigger_sos`, which validates
 * the coordinates, resolves the trip from the caller's own booking, and writes
 * the audit and notification rows in the same transaction. Every status change
 * goes through its own SECURITY DEFINER RPC, because who is responding to an
 * emergency is not the client's to assert.
 *
 * Reads are ordinary selects: RLS shows a passenger their own alerts and shows
 * an operator, its crew, or an admin the alerts raised on their trips.
 */

import { ErrorCode } from '@/constants/errors';
import type { SOSStatus } from '@/constants/enums';
import { AppError, fromRpcError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { UUID } from '@/types/models';

export interface SOSIncident {
  id: UUID;
  userId: UUID;
  bookingId: UUID | null;
  tripId: UUID | null;
  latitude: number;
  longitude: number;
  status: SOSStatus;
  /** The responder's closing note, once there is one. */
  note: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  respondingAt: string | null;
  resolvedAt: string | null;
}

export interface TriggerSOSInput {
  latitude: number;
  longitude: number;
  /** Optional: the booking this relates to. The trip is derived from it. */
  bookingId?: UUID | null;
}

export interface TriggerSOSResult {
  id: UUID;
  status: SOSStatus;
  tripId: UUID | null;
  createdAt: string;
  /** True when an alert was already open and this call returned that one. */
  alreadyOpen: boolean;
}

export interface SOSTransitionResult {
  id: UUID;
  status: SOSStatus;
  /** False when the incident was already in that state — a retry, not an error. */
  changed: boolean;
}

/** Statuses that still need somebody to do something. */
export const OPEN_SOS_STATUSES: readonly SOSStatus[] = ['ACTIVE', 'ACKNOWLEDGED', 'RESPONDING'];

interface SOSRow {
  id: string;
  user_id: string;
  booking_id: string | null;
  trip_id: string | null;
  latitude: number | string;
  longitude: number | string;
  status: SOSStatus;
  note: string | null;
  created_at: string;
  acknowledged_at: string | null;
  responding_at: string | null;
  resolved_at: string | null;
}

/**
 * PostgREST hands back `numeric` as a string. A string latitude silently
 * becomes NaN downstream and puts the incident at the map's origin, so the
 * coercion happens once, here.
 */
function num(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function toIncident(row: SOSRow): SOSIncident {
  return {
    id: row.id,
    userId: row.user_id,
    bookingId: row.booking_id,
    tripId: row.trip_id,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    respondingAt: row.responding_at,
    resolvedAt: row.resolved_at,
  };
}

const COLUMNS =
  'id, user_id, booking_id, trip_id, latitude, longitude, status, note, created_at, acknowledged_at, responding_at, resolved_at';

export const sosService = {
  /**
   * Raise an alert.
   *
   * Idempotent: a second call while an alert is still open returns that alert
   * with `alreadyOpen: true` rather than raising a second one. Somebody
   * pressing twice in a panic is the expected case, not an error.
   */
  async trigger(input: TriggerSOSInput): Promise<TriggerSOSResult> {
    const { data, error } = await supabase.rpc('trigger_sos', {
      p_latitude: input.latitude,
      p_longitude: input.longitude,
      p_booking_id: input.bookingId ?? undefined,
    });

    if (error) throw fromRpcError(error);
    if (!data) throw new AppError(ErrorCode.INTERNAL_ERROR);

    const result = data as {
      id: string;
      status: SOSStatus;
      tripId: string | null;
      createdAt: string;
      alreadyOpen: boolean;
    };

    return {
      id: result.id,
      status: result.status,
      tripId: result.tripId,
      createdAt: result.createdAt,
      alreadyOpen: result.alreadyOpen,
    };
  },

  /** The caller's own alerts, newest first. */
  async listMine(limit = 20): Promise<SOSIncident[]> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new AppError(ErrorCode.UNAUTHORIZED);

    const { data, error } = await supabase
      .from('sos_incidents')
      .select(COLUMNS)
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw toAppError(error);
    return (data as SOSRow[]).map(toIncident);
  },

  /**
   * Alerts that still need attention, for whoever is allowed to see them.
   *
   * There is no operator filter in this query on purpose: RLS already returns
   * only the incidents raised on the caller's own trips (plus their own).
   * Filtering here as well would be a second, drifting copy of that rule — the
   * mistake Phase 7 made twice with the operator views.
   */
  async listOpen(): Promise<SOSIncident[]> {
    const { data, error } = await supabase
      .from('sos_incidents')
      .select(COLUMNS)
      .in('status', OPEN_SOS_STATUSES)
      .order('created_at', { ascending: false });

    if (error) throw toAppError(error);
    return (data as SOSRow[]).map(toIncident);
  },

  async getById(id: UUID): Promise<SOSIncident> {
    const { data, error } = await supabase
      .from('sos_incidents')
      .select(COLUMNS)
      .eq('id', id)
      .single();

    if (error) throw toAppError(error);
    return toIncident(data as SOSRow);
  },

  /** ACTIVE → ACKNOWLEDGED. Operator, crew or admin. */
  async acknowledge(id: UUID): Promise<SOSTransitionResult> {
    return transition(await supabase.rpc('acknowledge_sos', { p_sos_id: id }));
  },

  /** → RESPONDING: someone is physically on their way. */
  async respond(id: UUID): Promise<SOSTransitionResult> {
    return transition(await supabase.rpc('respond_sos', { p_sos_id: id }));
  },

  /** → RESOLVED, with an optional closing note. */
  async resolve(id: UUID, note?: string | null): Promise<SOSTransitionResult> {
    return transition(
      await supabase.rpc('resolve_sos', { p_sos_id: id, p_note: note ?? undefined }),
    );
  },

  /**
   * The passenger stands down their own false alarm. Refused once a responder
   * is already moving — that call belongs to the people responding.
   */
  async cancel(id: UUID): Promise<SOSTransitionResult> {
    return transition(await supabase.rpc('cancel_sos', { p_sos_id: id }));
  },
};

function transition(response: { data: unknown; error: unknown }): SOSTransitionResult {
  if (response.error) throw fromRpcError(response.error);
  if (!response.data) throw new AppError(ErrorCode.INTERNAL_ERROR);

  const result = response.data as { id: string; status: SOSStatus; changed: boolean };
  return { id: result.id, status: result.status, changed: result.changed };
}
