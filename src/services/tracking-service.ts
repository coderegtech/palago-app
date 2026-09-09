/**
 * Live trip tracking.
 *
 * Reads go through `trip_live_position` and `driver_assignments`, both scoped
 * inside the view — a caller cannot forget to filter and read a stranger's bus.
 * Trip status changes go through SECURITY DEFINER RPCs; nothing here writes
 * `trips` directly.
 *
 * The one direct table write in PalaGo outside a hold or a seat lock is the GPS
 * insert, and it is direct on purpose: a ping every ten seconds per bus through
 * an Edge Function buys nothing, because there is no secret involved and no
 * cross-row invariant to keep. RLS ties the insert to the assigned driver on a
 * live trip, and that is the check that matters.
 */

import { AppError, fromRpcError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { ErrorCode } from '@/constants/errors';
import type { AssignmentStatus, TripStatus } from '@/constants/enums';
import type { ISODate, ISOTime, UUID } from '@/types/models';
import type { LngLat } from '@/components/ui/map.types';

export interface LivePosition {
  tripId: UUID;
  tripNumber: string;
  tripStatus: TripStatus;
  departureDate: ISODate;
  departureTime: ISOTime;
  arrivalTime: ISOTime;
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  busNumber: string;
  plateNumber: string;
  origin: { code: string; name: string; coordinate: LngLat };
  destination: { code: string; name: string; coordinate: LngLat };
  /** Null until the driver publishes a first fix. */
  position: {
    coordinate: LngLat;
    speedKph: number | null;
    heading: number | null;
    accuracyM: number | null;
    recordedAt: string;
  } | null;
}

export interface TrailPoint {
  coordinate: LngLat;
  recordedAt: string;
}

export interface DriverAssignment {
  assignmentId: UUID;
  assignmentStatus: AssignmentStatus;
  tripId: UUID;
  tripNumber: string;
  tripStatus: TripStatus;
  departureDate: ISODate;
  departureTime: ISOTime;
  arrivalTime: ISOTime;
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  busNumber: string;
  plateNumber: string;
  capacity: number;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  passengerCount: number;
  boardedCount: number;
}

export interface LocationFix {
  latitude: number;
  longitude: number;
  speedKph?: number | null;
  heading?: number | null;
  accuracyM?: number | null;
  /** Device clock at fix time. Kept distinct from the server's insert time. */
  recordedAt?: string;
}

/**
 * Postgres numerics arrive as strings from PostgREST when they exceed the safe
 * float range, and as numbers otherwise. Coordinates must not be left to that
 * coin flip — a string longitude renders the bus at the map's origin.
 */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface LivePositionRow {
  trip_id: string;
  trip_number: string;
  trip_status: TripStatus;
  departure_date: string;
  departure_time: string;
  arrival_time: string;
  actual_departure_at: string | null;
  actual_arrival_at: string | null;
  bus_number: string;
  plate_number: string;
  origin_code: string;
  origin_name: string;
  origin_latitude: number | string;
  origin_longitude: number | string;
  destination_code: string;
  destination_name: string;
  destination_latitude: number | string;
  destination_longitude: number | string;
  latitude: number | string | null;
  longitude: number | string | null;
  speed_kph: number | string | null;
  heading: number | string | null;
  accuracy_m: number | string | null;
  recorded_at: string | null;
}

/**
 * Raw shape of a `driver_assignments` row.
 *
 * Declared by hand like the Phase 7 view rows: the select list is built by
 * concatenation, which the generated types cannot narrow, and view columns are
 * all nullable in them anyway because Postgres cannot prove otherwise.
 */
interface AssignmentRow {
  assignment_id: string;
  assignment_status: AssignmentStatus;
  trip_id: string;
  trip_number: string;
  trip_status: TripStatus;
  departure_date: string;
  departure_time: string;
  arrival_time: string;
  actual_departure_at: string | null;
  actual_arrival_at: string | null;
  bus_number: string;
  plate_number: string;
  capacity: number;
  origin_code: string;
  origin_name: string;
  destination_code: string;
  destination_name: string;
  passenger_count: number;
  boarded_count: number;
}

const LIVE_COLUMNS =
  'trip_id, trip_number, trip_status, departure_date, departure_time, arrival_time, ' +
  'actual_departure_at, actual_arrival_at, bus_number, plate_number, ' +
  'origin_code, origin_name, origin_latitude, origin_longitude, ' +
  'destination_code, destination_name, destination_latitude, destination_longitude, ' +
  'latitude, longitude, speed_kph, heading, accuracy_m, recorded_at';

function toLivePosition(row: LivePositionRow): LivePosition {
  const lat = num(row.latitude);
  const lng = num(row.longitude);

  return {
    tripId: row.trip_id,
    tripNumber: row.trip_number,
    tripStatus: row.trip_status,
    departureDate: row.departure_date,
    departureTime: row.departure_time,
    arrivalTime: row.arrival_time,
    actualDepartureAt: row.actual_departure_at,
    actualArrivalAt: row.actual_arrival_at,
    busNumber: row.bus_number,
    plateNumber: row.plate_number,
    origin: {
      code: row.origin_code,
      name: row.origin_name,
      coordinate: [num(row.origin_longitude) ?? 0, num(row.origin_latitude) ?? 0],
    },
    destination: {
      code: row.destination_code,
      name: row.destination_name,
      coordinate: [num(row.destination_longitude) ?? 0, num(row.destination_latitude) ?? 0],
    },
    // Both halves of the coordinate, or nothing. Half a fix is not a position.
    position:
      lat !== null && lng !== null && row.recorded_at
        ? {
            coordinate: [lng, lat],
            speedKph: num(row.speed_kph),
            heading: num(row.heading),
            accuracyM: num(row.accuracy_m),
            recordedAt: row.recorded_at,
          }
        : null,
  };
}

export const trackingService = {
  /**
   * Newest position for one trip.
   *
   * Returns null rather than throwing when the caller is not entitled to track
   * it: the view simply has no row for them, which is indistinguishable from a
   * trip that does not exist — and deliberately so.
   */
  async getLivePosition(tripId: UUID): Promise<LivePosition | null> {
    const { data, error } = await supabase
      .from('trip_live_position')
      .select(LIVE_COLUMNS)
      .eq('trip_id', tripId)
      .maybeSingle();

    if (error) throw toAppError(error);
    return data ? toLivePosition(data as unknown as LivePositionRow) : null;
  },

  /**
   * The path travelled so far, oldest first, for drawing behind the bus.
   *
   * Capped because a nine-hour Puerto Princesa–El Nido run at one fix per ten
   * seconds is over three thousand points, and MapLibre does not need them to
   * draw a line across Palawan.
   */
  async getTrail(tripId: UUID, limit = 300): Promise<TrailPoint[]> {
    const { data, error } = await supabase
      .from('bus_locations')
      .select('latitude, longitude, recorded_at')
      .eq('trip_id', tripId)
      .order('recorded_at', { ascending: false })
      .limit(limit);

    if (error) throw toAppError(error);

    return (data ?? [])
      .map((row) => {
        const lat = num(row.latitude);
        const lng = num(row.longitude);
        return lat !== null && lng !== null
          ? { coordinate: [lng, lat] as LngLat, recordedAt: row.recorded_at }
          : null;
      })
      .filter((point): point is TrailPoint => point !== null)
      .reverse();
  },

  /** The signed-in crew member's own assignments, soonest first. */
  async listMyAssignments(): Promise<DriverAssignment[]> {
    const { data, error } = await supabase
      .from('driver_assignments')
      .select(
        'assignment_id, assignment_status, trip_id, trip_number, trip_status, ' +
          'departure_date, departure_time, arrival_time, actual_departure_at, ' +
          'actual_arrival_at, bus_number, plate_number, capacity, origin_code, ' +
          'origin_name, destination_code, destination_name, passenger_count, boarded_count',
      )
      .order('departure_date')
      .order('departure_time')
      .limit(50);

    if (error) throw toAppError(error);

    return (data as unknown as AssignmentRow[]).map((row) => ({
      assignmentId: row.assignment_id,
      assignmentStatus: row.assignment_status,
      tripId: row.trip_id,
      tripNumber: row.trip_number,
      tripStatus: row.trip_status,
      departureDate: row.departure_date,
      departureTime: row.departure_time,
      arrivalTime: row.arrival_time,
      actualDepartureAt: row.actual_departure_at,
      actualArrivalAt: row.actual_arrival_at,
      busNumber: row.bus_number,
      plateNumber: row.plate_number,
      capacity: row.capacity,
      originCode: row.origin_code,
      originName: row.origin_name,
      destinationCode: row.destination_code,
      destinationName: row.destination_name,
      passengerCount: row.passenger_count,
      boardedCount: row.boarded_count,
    }));
  },

  /**
   * Publish one GPS fix.
   *
   * `driver_id` is deliberately not sent: the column defaults to
   * `current_driver_id()`, so the caller cannot name a driver at all, let alone
   * someone else's. The insert policy re-checks it and also refuses once the
   * assignment is no longer ACTIVE.
   */
  async publishLocation(input: { tripId: UUID; fix: LocationFix }): Promise<void> {
    const { error } = await supabase.from('bus_locations').insert({
      trip_id: input.tripId,
      latitude: input.fix.latitude,
      longitude: input.fix.longitude,
      speed_kph: input.fix.speedKph ?? null,
      heading: input.fix.heading ?? null,
      accuracy_m: input.fix.accuracyM ?? null,
      recorded_at: input.fix.recordedAt ?? new Date().toISOString(),
    });

    if (error) {
      // RLS refusing the insert is the *expected* outcome once the trip ends,
      // not a fault. Say so, so the publisher can stop instead of retrying.
      const app = toAppError(error);
      if (app.code === ErrorCode.FORBIDDEN) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'This trip is no longer accepting position updates.',
          error,
        );
      }
      throw app;
    }
  },

  async setBoarding(tripId: UUID) {
    const { data, error } = await supabase.rpc('set_trip_boarding', { p_trip_id: tripId });
    if (error) throw fromRpcError(error);
    return data as unknown as { tripId: UUID; status: TripStatus; changed: boolean };
  },

  async startTrip(tripId: UUID) {
    const { data, error } = await supabase.rpc('start_trip', { p_trip_id: tripId });
    if (error) throw fromRpcError(error);
    return data as unknown as {
      tripId: UUID;
      status: TripStatus;
      actualDepartureAt: string | null;
      alreadyStarted: boolean;
    };
  },

  async endTrip(tripId: UUID) {
    const { data, error } = await supabase.rpc('end_trip', { p_trip_id: tripId });
    if (error) throw fromRpcError(error);
    return data as unknown as {
      tripId: UUID;
      status: TripStatus;
      actualArrivalAt: string | null;
      alreadyEnded: boolean;
    };
  },
};
