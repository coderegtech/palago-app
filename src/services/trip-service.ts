/**
 * Terminals, trip search and seat maps.
 *
 * Read-only. Nothing here creates a booking or touches seat state — that is
 * `booking-service.ts`, which goes through `reserve_seats`.
 */

import { toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { TripSearchInput } from '@/schemas/booking';
import type { Tables } from '@/types/database';
import type { BusType, SeatType, TripSeatStatus, TripStatus } from '@/constants/enums';
import type { Centavos, ISODate, ISOTime, UUID } from '@/types/models';

type TerminalRow = Tables<'terminals'>;

export interface TerminalOption {
  id: UUID;
  name: string;
  code: string;
  city: string;
}

export interface OperatorSummary {
  id: UUID;
  name: string;
  code: string;
  description: string | null;
  contactPhone: string | null;
}

/** A row of the `trip_search` view, camel-cased. */
export interface TripSearchResult {
  id: UUID;
  tripNumber: string;
  departureDate: ISODate;
  departureTime: ISOTime;
  arrivalTime: ISOTime;
  fare: Centavos;
  status: TripStatus;
  operatorId: UUID;
  operatorName: string;
  operatorCode: string;
  durationMinutes: number;
  distanceKm: number | null;
  originTerminalId: UUID;
  originName: string;
  originCode: string;
  destinationTerminalId: UUID;
  destinationName: string;
  destinationCode: string;
  busId: UUID;
  busNumber: string;
  busType: BusType;
  capacity: number;
  availableSeats: number;
}

/** A seat on a specific departure: its place on the bus plus its live status. */
export interface TripSeatView {
  tripSeatId: UUID;
  seatId: UUID;
  seatNumber: string;
  rowNumber: number;
  columnNumber: number;
  seatType: SeatType;
  isWindow: boolean;
  isAisle: boolean;
  status: TripSeatStatus;
  /** True when the row says HELD but the hold has already lapsed. */
  isSelectable: boolean;
}

const SEARCH_COLUMNS =
  'id, trip_number, departure_date, departure_time, arrival_time, fare, status, ' +
  'operator_id, operator_name, operator_code, duration_minutes, distance_km, ' +
  'origin_terminal_id, origin_name, origin_code, ' +
  'destination_terminal_id, destination_name, destination_code, ' +
  'bus_id, bus_number, bus_type, capacity, available_seats, ' +
  'is_active, operator_status, route_status, bus_status';

type TripSearchRow = {
  id: string;
  trip_number: string;
  departure_date: string;
  departure_time: string;
  arrival_time: string;
  fare: number;
  status: TripStatus;
  operator_id: string;
  operator_name: string;
  operator_code: string;
  duration_minutes: number;
  distance_km: number | null;
  origin_terminal_id: string;
  origin_name: string;
  origin_code: string;
  destination_terminal_id: string;
  destination_name: string;
  destination_code: string;
  bus_id: string;
  bus_number: string;
  bus_type: BusType;
  capacity: number;
  available_seats: number;
};

function toSearchResult(row: TripSearchRow): TripSearchResult {
  return {
    id: row.id,
    tripNumber: row.trip_number,
    departureDate: row.departure_date,
    departureTime: row.departure_time,
    arrivalTime: row.arrival_time,
    fare: row.fare,
    status: row.status,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    operatorCode: row.operator_code,
    durationMinutes: row.duration_minutes,
    distanceKm: row.distance_km,
    originTerminalId: row.origin_terminal_id,
    originName: row.origin_name,
    originCode: row.origin_code,
    destinationTerminalId: row.destination_terminal_id,
    destinationName: row.destination_name,
    destinationCode: row.destination_code,
    busId: row.bus_id,
    busNumber: row.bus_number,
    busType: row.bus_type,
    capacity: row.capacity,
    availableSeats: row.available_seats,
  };
}

export interface TripFilters {
  operatorCode?: string;
  busType?: BusType;
  /** Inclusive upper bound, in centavos. */
  maxFare?: Centavos;
  /** `MORNING` 00:00-11:59, `AFTERNOON` 12:00-17:59, `EVENING` 18:00-23:59. */
  departureWindow?: 'MORNING' | 'AFTERNOON' | 'EVENING';
}

export const tripService = {
  async listOperators(): Promise<OperatorSummary[]> {
    const { data, error } = await supabase
      .from('operators')
      .select('id, name, code, description, contact_phone')
      .eq('status', 'ACTIVE')
      .order('name');

    if (error) throw toAppError(error);
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      contactPhone: row.contact_phone,
    }));
  },

  async listTerminals(): Promise<TerminalOption[]> {
    const { data, error } = await supabase
      .from('terminals')
      .select('id, name, code, city')
      .eq('status', 'ACTIVE')
      .order('name');

    if (error) throw toAppError(error);
    return (data as Pick<TerminalRow, 'id' | 'name' | 'code' | 'city'>[]).map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      city: row.city,
    }));
  },

  /**
   * Trips on a route and date that can still be sold.
   *
   * Filtering happens in the database rather than over the returned array: on a
   * slow connection, downloading every trip to discard most of them is the
   * wrong trade.
   */
  async searchTrips(
    input: TripSearchInput,
    filters: TripFilters = {},
  ): Promise<TripSearchResult[]> {
    let query = supabase
      .from('trip_search')
      .select(SEARCH_COLUMNS)
      .eq('origin_terminal_id', input.originTerminalId)
      .eq('destination_terminal_id', input.destinationTerminalId)
      .eq('departure_date', input.departureDate)
      .in('status', ['SCHEDULED', 'BOARDING'])
      // A trip that cannot seat the whole party is not a result.
      .gte('available_seats', input.passengers)
      // Withdrawn from sale, but still a real trip. `create_booking` refuses
      // all four of these with INACTIVE_RESOURCE, so without them here a
      // passenger picks a departure, names their fellow travellers and is
      // turned away at the payment step for a reason they were never shown.
      // The enforcement is the server's; this is only about not offering
      // something that cannot be sold.
      //
      // `getTrip` deliberately does NOT filter: somebody holding a ticket on a
      // coach that has since been withdrawn must still be able to open it.
      .eq('is_active', true)
      .eq('operator_status', 'ACTIVE')
      .eq('route_status', 'ACTIVE')
      .eq('bus_status', 'ACTIVE');

    if (filters.operatorCode) query = query.eq('operator_code', filters.operatorCode);
    if (filters.busType) query = query.eq('bus_type', filters.busType);
    if (filters.maxFare !== undefined) query = query.lte('fare', filters.maxFare);

    if (filters.departureWindow === 'MORNING') query = query.lt('departure_time', '12:00');
    if (filters.departureWindow === 'AFTERNOON') {
      query = query.gte('departure_time', '12:00').lt('departure_time', '18:00');
    }
    if (filters.departureWindow === 'EVENING') query = query.gte('departure_time', '18:00');

    const { data, error } = await query.order('departure_time');
    if (error) throw toAppError(error);

    return (data as unknown as TripSearchRow[]).map(toSearchResult);
  },

  async getTrip(tripId: UUID): Promise<TripSearchResult> {
    const { data, error } = await supabase
      .from('trip_search')
      .select(SEARCH_COLUMNS)
      .eq('id', tripId)
      .single();

    if (error) throw toAppError(error);
    return toSearchResult(data as unknown as TripSearchRow);
  },

  /**
   * The seat map for one departure.
   *
   * `isSelectable` folds in the lapsed-hold case so the UI does not have to
   * reason about clock skew: a seat whose `held_until` has passed is bookable
   * again even though the expiry sweep may not have run.
   */
  async getTripSeats(tripId: UUID): Promise<TripSeatView[]> {
    const { data, error } = await supabase
      .from('trip_seats')
      .select(
        'id, seat_id, status, held_until, ' +
          'bus_seats!inner(seat_number, row_number, column_number, seat_type, is_window, is_aisle)',
      )
      .eq('trip_id', tripId);

    if (error) throw toAppError(error);

    const now = Date.now();

    type Row = {
      id: string;
      seat_id: string;
      status: TripSeatStatus;
      held_until: string | null;
      bus_seats: {
        seat_number: string;
        row_number: number;
        column_number: number;
        seat_type: SeatType;
        is_window: boolean;
        is_aisle: boolean;
      };
    };

    return (data as unknown as Row[])
      .map((row) => {
        const holdLapsed =
          row.status === 'HELD' && row.held_until !== null && new Date(row.held_until).getTime() < now;

        return {
          tripSeatId: row.id,
          seatId: row.seat_id,
          seatNumber: row.bus_seats.seat_number,
          rowNumber: row.bus_seats.row_number,
          columnNumber: row.bus_seats.column_number,
          seatType: row.bus_seats.seat_type,
          isWindow: row.bus_seats.is_window,
          isAisle: row.bus_seats.is_aisle,
          status: row.status,
          isSelectable: row.status === 'AVAILABLE' || holdLapsed,
        };
      })
      .sort((a, b) => a.rowNumber - b.rowNumber || a.columnNumber - b.columnNumber);
  },
};
