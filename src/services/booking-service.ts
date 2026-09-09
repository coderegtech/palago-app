/**
 * Bookings.
 *
 * Creating and cancelling a booking are RPC calls, not table writes — the
 * client has no INSERT or UPDATE privilege on `bookings` or `trip_seats` at
 * all. `reserve_seats` computes the price from the trip's own fare, so nothing
 * this module sends can influence what a booking costs.
 */

import { fromRpcError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { PassengerDetailInput } from '@/schemas/booking';
import type { BookingStatus, PassengerType } from '@/constants/enums';
import type { Centavos, ISODate, ISOTime, UUID } from '@/types/models';

// The reservation functions raise exceptions whose message is one of our own
// `ErrorCode`s (see `20260909000005_reserve_seats.sql`); `fromRpcError` maps
// those back to a typed `AppError`. It lives in `@/lib/errors` because the
// tracking RPCs added in Phase 8 need exactly the same translation.

export interface ReservationResult {
  bookingId: UUID;
  reference: string;
  status: BookingStatus;
  subtotal: Centavos;
  discount: Centavos;
  loyaltyDiscount: Centavos;
  totalAmount: Centavos;
  currency: string;
  seatCount: number;
  expiresAt: string;
}

export interface BookingPassengerView {
  id: UUID;
  name: string;
  seatNumber: string;
  type: PassengerType;
  phone: string | null;
  email: string | null;
}

/** A booking with everything the detail screen shows. */
export interface BookingDetail extends BookingSummary {
  subtotal: Centavos;
  discount: Centavos;
  loyaltyDiscount: Centavos;
  confirmedAt: string | null;
  cancelledAt: string | null;
  checkedInAt: string | null;
  /** Set once boarding is confirmed. Its presence marks the pass as used. */
  boardedAt: string | null;
  arrivalTime: ISOTime;
  durationMinutes: number;
  busNumber: string;
  tripStatus: string;
  passengers: BookingPassengerView[];
}

export interface BookingSummary {
  id: UUID;
  reference: string;
  status: BookingStatus;
  totalAmount: Centavos;
  /** Fare x passengers, before any discount. */
  subtotal: Centavos;
  discount: Centavos;
  /** Reduction from a redeemed reward. Phase 10. */
  loyaltyDiscount: Centavos;
  currency: string;
  expiresAt: string | null;
  createdAt: string;
  tripId: UUID;
  tripNumber: string;
  departureDate: ISODate;
  departureTime: ISOTime;
  operatorName: string;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  passengerCount: number;
  seatNumbers: string[];
}

const DETAIL_COLUMNS =
  'id, booking_reference, status, total_amount, subtotal, discount, loyalty_discount, ' +
  'currency, expires_at, created_at, confirmed_at, cancelled_at, ' +
  'checked_in_at, boarded_at, trip_id, ' +
  'trips!inner(trip_number, departure_date, departure_time, arrival_time, status, ' +
  '  operators!inner(name), ' +
  '  buses!inner(bus_number), ' +
  '  routes!inner(duration_minutes, ' +
  '               origin:terminals!routes_origin_terminal_id_fkey(name, code), ' +
  '               destination:terminals!routes_destination_terminal_id_fkey(name, code))), ' +
  'booking_passengers(id, passenger_name, passenger_type, phone, email, ' +
  '  bus_seats!inner(seat_number))';

const BOOKING_COLUMNS =
  'id, booking_reference, status, total_amount, subtotal, discount, loyalty_discount, ' +
  'currency, expires_at, created_at, confirmed_at, cancelled_at, trip_id, ' +
  'trips!inner(trip_number, departure_date, departure_time, ' +
  '  operators!inner(name), ' +
  '  routes!inner(origin:terminals!routes_origin_terminal_id_fkey(name, code), ' +
  '               destination:terminals!routes_destination_terminal_id_fkey(name, code))), ' +
  'booking_passengers(id, passenger_name, passenger_type, bus_seats!inner(seat_number))';

type BookingRow = {
  id: string;
  booking_reference: string;
  status: BookingStatus;
  total_amount: number;
  subtotal: number;
  discount: number;
  loyalty_discount: number;
  currency: string;
  expires_at: string | null;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  trip_id: string;
  trips: {
    trip_number: string;
    departure_date: string;
    departure_time: string;
    operators: { name: string };
    routes: {
      origin: { name: string; code: string };
      destination: { name: string; code: string };
    };
  };
  booking_passengers: {
    id: string;
    passenger_name: string;
    passenger_type: PassengerType;
    bus_seats: { seat_number: string };
  }[];
};

/**
 * `Omit` then re-add, rather than an intersection: `A[] & B[]` does not merge
 * into an array of `A & B`, so the extra passenger columns would be invisible.
 */
type DetailRow = Omit<BookingRow, 'trips' | 'booking_passengers'> & {
  checked_in_at: string | null;
  boarded_at: string | null;
  trips: Omit<BookingRow['trips'], 'routes'> & {
    arrival_time: string;
    status: string;
    buses: { bus_number: string };
    routes: BookingRow['trips']['routes'] & { duration_minutes: number };
  };
  booking_passengers: (BookingRow['booking_passengers'][number] & {
    phone: string | null;
    email: string | null;
  })[];
};

function toSummary(row: BookingRow): BookingSummary {
  return {
    id: row.id,
    reference: row.booking_reference,
    status: row.status,
    totalAmount: row.total_amount,
    subtotal: row.subtotal,
    discount: row.discount,
    loyaltyDiscount: row.loyalty_discount,
    currency: row.currency,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    tripId: row.trip_id,
    tripNumber: row.trips.trip_number,
    departureDate: row.trips.departure_date,
    departureTime: row.trips.departure_time,
    operatorName: row.trips.operators.name,
    originCode: row.trips.routes.origin.code,
    originName: row.trips.routes.origin.name,
    destinationCode: row.trips.routes.destination.code,
    destinationName: row.trips.routes.destination.name,
    passengerCount: row.booking_passengers.length,
    seatNumbers: row.booking_passengers
      .map((p) => p.bus_seats.seat_number)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  };
}

export const bookingService = {
  /**
   * Hold seats and open a booking, atomically.
   *
   * The user id is not sent: `reserve_seats` takes the owner from `auth.uid()`,
   * so a caller cannot create a booking in someone else's name.
   *
   * Throws `SEAT_UNAVAILABLE` when another passenger took a seat first — which
   * is normal, not exceptional, and the seat map should be refetched.
   */
  async reserveSeats(tripId: UUID, passengers: PassengerDetailInput[]): Promise<ReservationResult> {
    const { data, error } = await supabase.rpc('reserve_seats', {
      p_trip_id: tripId,
      p_passengers: passengers.map((p) => ({
        seatId: p.seatId,
        name: p.name,
        phone: p.phone || null,
        email: p.email || null,
        type: p.type,
      })),
    });

    if (error) throw fromRpcError(error);
    return data as unknown as ReservationResult;
  },

  async cancelBooking(bookingId: UUID): Promise<{ bookingId: UUID; status: BookingStatus }> {
    const { data, error } = await supabase.rpc('cancel_booking', { p_booking_id: bookingId });
    if (error) throw fromRpcError(error);
    return data as unknown as { bookingId: UUID; status: BookingStatus };
  },

  async listBookings(): Promise<BookingSummary[]> {
    const { data, error } = await supabase
      .from('bookings')
      .select(BOOKING_COLUMNS)
      .order('created_at', { ascending: false });

    if (error) throw toAppError(error);
    return (data as unknown as BookingRow[]).map(toSummary);
  },

  async getBooking(bookingId: UUID): Promise<BookingSummary> {
    const { data, error } = await supabase
      .from('bookings')
      .select(BOOKING_COLUMNS)
      .eq('id', bookingId)
      .single();

    if (error) throw toAppError(error);
    return toSummary(data as unknown as BookingRow);
  },

  async getBookingDetail(bookingId: UUID): Promise<BookingDetail> {
    const { data, error } = await supabase
      .from('bookings')
      .select(DETAIL_COLUMNS)
      .eq('id', bookingId)
      .single();

    if (error) throw toAppError(error);

    const row = data as unknown as DetailRow;

    return {
      ...toSummary(row as unknown as BookingRow),
      subtotal: row.subtotal,
      discount: row.discount,
      loyaltyDiscount: row.loyalty_discount,
      confirmedAt: row.confirmed_at,
      cancelledAt: row.cancelled_at,
      checkedInAt: row.checked_in_at,
      boardedAt: row.boarded_at,
      arrivalTime: row.trips.arrival_time,
      durationMinutes: row.trips.routes.duration_minutes,
      busNumber: row.trips.buses.bus_number,
      tripStatus: row.trips.status,
      passengers: row.booking_passengers
        .map((p) => ({
          id: p.id,
          name: p.passenger_name,
          seatNumber: p.bus_seats.seat_number,
          type: p.passenger_type,
          phone: p.phone,
          email: p.email,
        }))
        .sort((a, b) =>
          a.seatNumber.localeCompare(b.seatNumber, undefined, { numeric: true }),
        ),
    };
  },
};
