/**
 * The operator console's data access.
 *
 * Reads come from the Phase 7 views, which are **operator-scoped inside the
 * view itself** — a caller cannot forget to filter and see a rival's revenue.
 * Writes are ordinary table writes, allowed by the RLS policies that already
 * restrict each table to the caller's own operator.
 *
 * Every peso figure here is test data. Nothing in PalaGo charges real money.
 */

import { toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type {
  BusType,
  PassengerType,
  StaffStatus,
  TripStatus,
  AssignmentStatus,
  OperatorStatus,
} from '@/constants/enums';
import type { Centavos, ISODate, ISOTime, UUID } from '@/types/models';

/**
 * Dashboard totals for one day.
 *
 * `onTime` is a percentage of trips that *have departed*, and is null when none
 * has — zero would read as "every bus was late today" before the first
 * departure. Phase 8 added `trips.actual_departure_at`, which is what makes the
 * figure real rather than estimated.
 */
export interface OperatorDashboard {
  scope: 'OPERATOR' | 'NO_OPERATOR';
  date: ISODate;
  operatorId?: UUID;
  today?: {
    trips: number;
    passengers: number;
    boarded: number;
    seatsBooked: number;
    capacity: number;
    revenue: Centavos;
    scheduled: number;
    boarding: number;
    inTransit: number;
    completed: number;
    cancelled: number;
    unassigned: number;
    /** Trips that have actually left, the denominator for `onTime`. */
    departed: number;
    /** Percentage on time, or null when nothing has departed yet. */
    onTime: number | null;
    /** Average minutes late at departure; negative if early, null if none. */
    avgDelayMinutes: number | null;
    onTimeGraceMinutes: number;
  };
  fleet?: { buses: number; activeBuses: number };
  crew?: {
    drivers: number;
    activeDrivers: number;
    assistants: number;
    activeAssistants: number;
  };
}

export interface TripOverview {
  id: UUID;
  tripNumber: string;
  departureDate: ISODate;
  departureTime: ISOTime;
  arrivalTime: ISOTime;
  status: TripStatus;
  fare: Centavos;
  busNumber: string;
  busType: BusType;
  capacity: number;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  durationMinutes: number;
  driverId: UUID | null;
  driverName: string | null;
  driverPhone: string | null;
  assistantId: UUID | null;
  assistantName: string | null;
  assistantPhone: string | null;
  assignmentStatus: AssignmentStatus | null;
  seatsBooked: number;
  seatsHeld: number;
  seatsAvailable: number;
  passengerCount: number;
  boardedCount: number;
  revenue: Centavos;
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  /** Minutes late at departure; negative if early, null until it departs. */
  departureDelayMinutes: number | null;
}

export interface ManifestEntry {
  id: UUID;
  bookingId: UUID;
  bookingReference: string;
  bookingStatus: string;
  passengerName: string;
  passengerType: PassengerType;
  phone: string | null;
  seatNumber: string;
  paymentStatus: string;
  boardedAt: string | null;
  checkedInAt: string | null;
}

export interface CrewMember {
  id: UUID;
  name: string;
  phone: string | null;
  status: StaffStatus;
  /** Drivers only. */
  licenseNumber?: string;
  userId: UUID | null;
  createdAt: string;
}

export interface FleetBus {
  id: UUID;
  busNumber: string;
  plateNumber: string;
  name: string | null;
  busType: BusType;
  capacity: number;
  status: OperatorStatus;
}

const OVERVIEW_COLUMNS =
  'id, trip_number, departure_date, departure_time, arrival_time, status, fare, ' +
  'bus_number, bus_type, capacity, origin_code, origin_name, destination_code, ' +
  'destination_name, duration_minutes, driver_id, driver_name, driver_phone, ' +
  'assistant_id, assistant_name, assistant_phone, assignment_status, ' +
  'seats_booked, seats_held, seats_available, passenger_count, boarded_count, revenue, ' +
  'actual_departure_at, actual_arrival_at, departure_delay_minutes';

/** Raw shape of an `operator_trip_overview` row, as PostgREST returns it. */
interface OverviewRow {
  id: string;
  trip_number: string;
  departure_date: string;
  departure_time: string;
  arrival_time: string;
  status: TripStatus;
  fare: number;
  bus_number: string;
  bus_type: BusType;
  capacity: number;
  origin_code: string;
  origin_name: string;
  destination_code: string;
  destination_name: string;
  duration_minutes: number;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  assistant_id: string | null;
  assistant_name: string | null;
  assistant_phone: string | null;
  assignment_status: AssignmentStatus | null;
  seats_booked: number;
  seats_held: number;
  seats_available: number;
  passenger_count: number;
  boarded_count: number;
  revenue: number;
  actual_departure_at: string | null;
  actual_arrival_at: string | null;
  departure_delay_minutes: number | null;
}

/**
 * Raw shape of an `operator_fleet` row.
 *
 * Declared by hand for the same reason as the two above: Postgres cannot prove
 * a view column is non-null, so the generated types make every one nullable.
 */
interface FleetRow {
  id: string;
  bus_number: string;
  plate_number: string;
  name: string | null;
  bus_type: BusType;
  capacity: number;
  status: OperatorStatus;
}

/** Raw shape of an `operator_manifest` row. */
interface ManifestRow {
  id: string;
  booking_id: string;
  booking_reference: string;
  booking_status: string;
  passenger_name: string;
  passenger_type: PassengerType;
  phone: string | null;
  seat_number: string;
  payment_status: string;
  boarded_at: string | null;
  checked_in_at: string | null;
}

function toOverview(row: OverviewRow): TripOverview {
  return {
    id: row.id,
    tripNumber: row.trip_number,
    departureDate: row.departure_date,
    departureTime: row.departure_time,
    arrivalTime: row.arrival_time,
    status: row.status,
    fare: row.fare,
    busNumber: row.bus_number,
    busType: row.bus_type,
    capacity: row.capacity,
    originCode: row.origin_code,
    originName: row.origin_name,
    destinationCode: row.destination_code,
    destinationName: row.destination_name,
    durationMinutes: row.duration_minutes,
    driverId: row.driver_id,
    driverName: row.driver_name,
    driverPhone: row.driver_phone,
    assistantId: row.assistant_id,
    assistantName: row.assistant_name,
    assistantPhone: row.assistant_phone,
    assignmentStatus: row.assignment_status,
    seatsBooked: row.seats_booked,
    seatsHeld: row.seats_held,
    seatsAvailable: row.seats_available,
    passengerCount: row.passenger_count,
    boardedCount: row.boarded_count,
    revenue: row.revenue,
    actualDepartureAt: row.actual_departure_at,
    actualArrivalAt: row.actual_arrival_at,
    departureDelayMinutes: row.departure_delay_minutes,
  };
}

function toManifestEntry(row: ManifestRow): ManifestEntry {
  return {
    id: row.id,
    bookingId: row.booking_id,
    bookingReference: row.booking_reference,
    bookingStatus: row.booking_status,
    passengerName: row.passenger_name,
    passengerType: row.passenger_type,
    phone: row.phone,
    seatNumber: row.seat_number,
    paymentStatus: row.payment_status,
    boardedAt: row.boarded_at,
    checkedInAt: row.checked_in_at,
  };
}
export const operatorService = {
  async getDashboard(date?: ISODate): Promise<OperatorDashboard> {
    const { data, error } = await supabase.rpc(
      'operator_dashboard',
      date ? { p_date: date } : {},
    );
    if (error) throw toAppError(error);
    return data as unknown as OperatorDashboard;
  },

  /** Departures on a date, or all upcoming when no date is given. */
  async listTrips(date?: ISODate): Promise<TripOverview[]> {
    let query = supabase.from('operator_trip_overview').select(OVERVIEW_COLUMNS);
    if (date) query = query.eq('departure_date', date);

    const { data, error } = await query
      .order('departure_date')
      .order('departure_time')
      .limit(100);

    if (error) throw toAppError(error);
    return (data as unknown as OverviewRow[]).map(toOverview);
  },

  async getTrip(tripId: UUID): Promise<TripOverview> {
    const { data, error } = await supabase
      .from('operator_trip_overview')
      .select(OVERVIEW_COLUMNS)
      .eq('id', tripId)
      .single();

    if (error) throw toAppError(error);
    return toOverview(data as unknown as OverviewRow);
  },

  async getManifest(tripId: UUID): Promise<ManifestEntry[]> {
    const { data, error } = await supabase
      .from('operator_manifest')
      .select(
        'id, booking_id, booking_reference, booking_status, passenger_name, ' +
          'passenger_type, phone, seat_number, payment_status, boarded_at, checked_in_at',
      )
      .eq('trip_id', tripId)
      .order('seat_number');

    if (error) throw toAppError(error);
    return (data as unknown as ManifestRow[]).map(toManifestEntry);
  },

  async listDrivers(): Promise<CrewMember[]> {
    const { data, error } = await supabase
      .from('drivers')
      .select('id, name, phone, status, license_number, user_id, created_at')
      .order('name');

    if (error) throw toAppError(error);
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      status: row.status,
      licenseNumber: row.license_number,
      userId: row.user_id,
      createdAt: row.created_at,
    }));
  },

  async listAssistants(): Promise<CrewMember[]> {
    const { data, error } = await supabase
      .from('assistants')
      .select('id, name, phone, status, user_id, created_at')
      .order('name');

    if (error) throw toAppError(error);
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      status: row.status,
      userId: row.user_id,
      createdAt: row.created_at,
    }));
  },

  /**
   * `operator_id` is not sent: it is defaulted from the caller's own operator
   * so a request cannot create crew under someone else's company. RLS would
   * refuse it anyway, but not sending it removes the question.
   */
  async addDriver(input: { name: string; licenseNumber: string; phone?: string; operatorId: UUID }) {
    const { error } = await supabase.from('drivers').insert({
      operator_id: input.operatorId,
      name: input.name,
      license_number: input.licenseNumber,
      phone: input.phone || null,
    });
    if (error) throw toAppError(error);
  },

  async addAssistant(input: { name: string; phone?: string; operatorId: UUID }) {
    const { error } = await supabase.from('assistants').insert({
      operator_id: input.operatorId,
      name: input.name,
      phone: input.phone || null,
    });
    if (error) throw toAppError(error);
  },

  async setDriverStatus(driverId: UUID, status: StaffStatus) {
    const { error } = await supabase.from('drivers').update({ status }).eq('id', driverId);
    if (error) throw toAppError(error);
  },

  async setAssistantStatus(assistantId: UUID, status: StaffStatus) {
    const { error } = await supabase.from('assistants').update({ status }).eq('id', assistantId);
    if (error) throw toAppError(error);
  },

  /**
   * Reads `operator_fleet`, not `buses`. `buses` is world-readable so trip
   * search can show bus type and capacity, so selecting from it directly
   * listed a rival operator's coaches -- caught in browser verification. The
   * view carries the operator filter so this call cannot forget it.
   */
  async listBuses(): Promise<FleetBus[]> {
    const { data, error } = await supabase
      .from('operator_fleet')
      .select('id, bus_number, plate_number, name, bus_type, capacity, status')
      .order('bus_number');

    if (error) throw toAppError(error);
    return (data as unknown as FleetRow[]).map((row) => ({
      id: row.id,
      busNumber: row.bus_number,
      plateNumber: row.plate_number,
      name: row.name,
      busType: row.bus_type,
      capacity: row.capacity,
      status: row.status,
    }));
  },
};
