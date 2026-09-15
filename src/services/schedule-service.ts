/**
 * Scheduling: putting a coach on a route on a day, and rostering a crew onto it.
 *
 * Every write is an RPC. `trips` has no client INSERT or UPDATE grant at all,
 * which is what stops a form deciding that a bus is free — the answer to that
 * comes from an exclusion constraint, under concurrency, not from a check the
 * client remembered to make.
 *
 * A clash comes back as `SCHEDULE_CONFLICT` with the clashing trip named in
 * `details`, so the screen can say which departure is in the way rather than
 * "that bus is busy".
 */

import { fromRpcError, toAppError, AppError } from '@/lib/errors';
import { ErrorCode } from '@/constants/errors';
import { supabase } from '@/lib/supabase';
import type { Centavos, ISODate, ISOTime, UUID } from '@/types/models';

export interface CreateTripInput {
  routeId: UUID;
  busId: UUID;
  tripNumber: string;
  departureDate: ISODate;
  departureTime: ISOTime;
  arrivalTime: ISOTime;
  fare: Centavos;
  /** Admins schedule for any operator; an operator's own is inferred server-side. */
  operatorId?: UUID;
}

export interface UpdateTripInput extends Omit<CreateTripInput, 'operatorId'> {
  tripId: UUID;
}

/**
 * A schedule clash, carrying the departure it clashes with.
 *
 * `AppError` has no room for that, and the trip number is the whole difference
 * between a message somebody can act on and one they cannot.
 */
export class ScheduleConflictError extends AppError {
  readonly clashesWith: string | null;

  constructor(clashesWith: string | null, cause?: unknown) {
    super(
      ErrorCode.SCHEDULE_CONFLICT,
      clashesWith
        ? `That clashes with ${clashesWith}, which has the same bus or crew at that time.`
        : undefined,
      cause,
    );
    this.name = 'ScheduleConflictError';
    this.clashesWith = clashesWith;
  }
}

/** PostgREST puts a raised `DETAIL` in `details`. */
function rpcError(error: { message?: string; details?: string } | null): AppError {
  if (error?.message === ErrorCode.SCHEDULE_CONFLICT) {
    return new ScheduleConflictError(error.details?.trim() || null, error);
  }
  return fromRpcError(error);
}

export const scheduleService = {
  async createTrip(input: CreateTripInput): Promise<{ id: UUID; tripNumber: string }> {
    const { data, error } = await supabase.rpc('create_trip', {
      p_route_id: input.routeId,
      p_bus_id: input.busId,
      p_trip_number: input.tripNumber.trim(),
      p_departure_date: input.departureDate,
      p_departure_time: input.departureTime,
      p_arrival_time: input.arrivalTime,
      p_fare: input.fare,
      p_operator_id: input.operatorId || undefined,
    });
    if (error) throw rpcError(error);
    return data as unknown as { id: UUID; tripNumber: string };
  },

  async updateTrip(input: UpdateTripInput): Promise<void> {
    const { error } = await supabase.rpc('update_trip', {
      p_trip_id: input.tripId,
      p_route_id: input.routeId,
      p_bus_id: input.busId,
      p_trip_number: input.tripNumber.trim(),
      p_departure_date: input.departureDate,
      p_departure_time: input.departureTime,
      p_arrival_time: input.arrivalTime,
      p_fare: input.fare,
    });
    if (error) throw rpcError(error);
  },

  /**
   * Cancels the trip and every live booking on it, releases the seats and the
   * crew, and tells the passengers. Nothing is deleted — a ticket has to keep
   * resolving to the trip it was for.
   */
  async cancelTrip(tripId: UUID, reason?: string): Promise<{ bookingsCancelled: number }> {
    const { data, error } = await supabase.rpc('cancel_trip', {
      p_trip_id: tripId,
      p_reason: reason?.trim() || undefined,
    });
    if (error) throw rpcError(error);
    const result = data as unknown as { bookingsCancelled?: number };
    return { bookingsCancelled: result.bookingsCancelled ?? 0 };
  },

  /** Withdraws a schedule from sale without claiming the trip was cancelled. */
  async setTripActive(tripId: UUID, active: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_trip_active', {
      p_trip_id: tripId,
      p_active: active,
    });
    if (error) throw rpcError(error);
  },

  /**
   * Rosters a driver and/or a conductor. The server checks all five conditions
   * — active account, available, same operator, no clash, licence in date —
   * and supersedes whoever was on it rather than editing the old row away.
   */
  async assignCrew(
    tripId: UUID,
    crew: { driverId?: UUID | null; assistantId?: UUID | null },
  ): Promise<void> {
    const { error } = await supabase.rpc('assign_trip_crew', {
      p_trip_id: tripId,
      p_driver_id: crew.driverId || undefined,
      p_assistant_id: crew.assistantId || undefined,
    });
    if (error) throw rpcError(error);
  },

  async unassignCrew(tripId: UUID): Promise<void> {
    const { error } = await supabase.rpc('unassign_trip_crew', { p_trip_id: tripId });
    if (error) throw rpcError(error);
  },

  /**
   * Minutes a coach stays spoken for after it arrives. Readable by any signed-in
   * user through an allowlist, so a screen can explain a clash without
   * `app_settings` — which holds secrets — being readable.
   */
  async turnaroundMinutes(): Promise<number> {
    const { data, error } = await supabase.rpc('public_setting', {
      p_key: 'trip_turnaround_minutes',
    });
    if (error) throw fromRpcError(error);
    const parsed = Number(data);
    return Number.isFinite(parsed) ? parsed : 30;
  },

  /** Admin only. Refused, naming the pair, if widening it would cause a clash. */
  async setTurnaroundMinutes(minutes: number): Promise<{ tripsRestamped: number }> {
    const { data, error } = await supabase.rpc('set_turnaround_minutes', { p_minutes: minutes });
    if (error) throw rpcError(error);
    const result = data as unknown as { tripsRestamped?: number };
    return { tripsRestamped: result.tripsRestamped ?? 0 };
  },

  /**
   * Every trip on the platform, for the admin schedule screen.
   *
   * Reads `trip_search`, which carries the operator, both terminals, the coach
   * and the status of each — an admin needs to see a departure whose bus has
   * been withdrawn, which is exactly what the operator views filter out.
   */
  async listAllTrips(limit = 500) {
    const { data, error } = await supabase
      .from('trip_search')
      .select(
        'id, trip_number, departure_date, departure_time, arrival_time, fare, status, is_active, ' +
          'operator_id, operator_name, operator_code, operator_status, ' +
          'route_id, origin_code, origin_name, destination_code, destination_name, route_status, ' +
          'bus_id, bus_number, bus_type, capacity, bus_status, available_seats',
      )
      .order('departure_date', { ascending: false })
      .order('departure_time')
      .limit(limit);

    if (error) throw toAppError(error);
    return (data ?? []) as unknown as ScheduleRow[];
  },
};

/** A row of the admin schedule table. */
export interface ScheduleRow {
  id: UUID;
  trip_number: string;
  departure_date: ISODate;
  departure_time: ISOTime;
  arrival_time: ISOTime;
  fare: Centavos;
  status: string;
  is_active: boolean;
  operator_id: UUID;
  operator_name: string;
  operator_code: string;
  operator_status: string;
  route_id: UUID;
  origin_code: string;
  origin_name: string;
  destination_code: string;
  destination_name: string;
  route_status: string;
  bus_id: UUID;
  bus_number: string;
  bus_type: string;
  capacity: number;
  bus_status: string;
  available_seats: number;
}
