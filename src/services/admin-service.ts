/**
 * Admin console.
 *
 * Analytics come from `admin_dashboard`, a SECURITY DEFINER RPC — the operator
 * views are scoped through `current_operator_id()` and an admin has no
 * operator, so they would correctly return nothing.
 *
 * Creating a bus goes through `create_bus`, because the coach and its seat
 * layout must arrive together: a bus with no `bus_seats` rows looks sellable
 * but cannot be booked. Operators, terminals and routes are ordinary inserts —
 * standalone rows with no cross-row invariant, guarded by the Phase 3a policies
 * that already end `or public.is_admin()`. RLS is the check, here as everywhere.
 */

import type { BusType, OperatorStatus } from '@/constants/enums';
import { fromRpcError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Centavos, ISODate, UUID } from '@/types/models';

export interface AdminOperatorStat {
  id: UUID;
  name: string;
  code: string;
  status: OperatorStatus;
  trips: number;
  passengers: number;
  boarded: number;
  revenue: Centavos;
  seatsBooked: number;
  capacity: number;
  buses: number;
  routes: number;
  drivers: number;
}

export interface AdminDashboard {
  date: ISODate;
  today: {
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
    departed: number;
    onTimeGraceMinutes: number;
    /** Null until something has departed — never an invented 100%. */
    onTime: number | null;
  };
  platform: {
    operators: number;
    activeOperators: number;
    terminals: number;
    routes: number;
    buses: number;
    activeBuses: number;
    drivers: number;
    assistants: number;
    passengerAccounts: number;
    bookingsAllTime: number;
    revenueAllTime: Centavos;
  };
  operators: AdminOperatorStat[];
}

export interface OperatorRecord {
  id: UUID;
  name: string;
  code: string;
  status: OperatorStatus;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface TerminalRecord {
  id: UUID;
  name: string;
  code: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
  status: OperatorStatus;
}

export interface RouteRecord {
  id: UUID;
  operatorId: UUID;
  operatorName: string;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  durationMinutes: number;
  distanceKm: number | null;
  status: OperatorStatus;
}

export interface BusRecord {
  id: UUID;
  operatorId: UUID;
  operatorName: string;
  plateNumber: string;
  busNumber: string;
  name: string | null;
  busType: BusType;
  capacity: number;
  status: OperatorStatus;
}

export interface CreateOperatorInput {
  name: string;
  code: string;
  description?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export interface CreateTerminalInput {
  name: string;
  code: string;
  city: string;
  province?: string;
  latitude: number;
  longitude: number;
  address?: string | null;
}

export interface CreateRouteInput {
  operatorId: UUID;
  originTerminalId: UUID;
  destinationTerminalId: UUID;
  durationMinutes: number;
  distanceKm?: number | null;
}

export interface CreateBusInput {
  operatorId: UUID;
  plateNumber: string;
  busNumber: string;
  capacity: number;
  busType: BusType;
  name?: string | null;
}

/**
 * Raw shape of the routes select.
 *
 * Declared by hand for the same reason the Phase 7 view rows are: the select
 * list is built by concatenation and the two terminal joins are aliased to
 * disambiguate the origin and destination foreign keys, neither of which the
 * generated types can narrow.
 */
interface RouteRow {
  id: string;
  operator_id: string;
  duration_minutes: number;
  distance_km: number | string | null;
  status: OperatorStatus;
  operators: { name: string } | null;
  origin: { code: string; name: string } | null;
  destination: { code: string; name: string } | null;
}

/** PostgREST returns `numeric` as a string once it leaves the safe float range. */
function num(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const adminService = {
  async getDashboard(date?: ISODate): Promise<AdminDashboard> {
    const { data, error } = await supabase.rpc('admin_dashboard', date ? { p_date: date } : {});
    if (error) throw fromRpcError(error);
    return data as unknown as AdminDashboard;
  },

  async listOperators(): Promise<OperatorRecord[]> {
    const { data, error } = await supabase
      .from('operators')
      .select('id, name, code, status, contact_phone, contact_email')
      .order('name');

    if (error) throw toAppError(error);
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      status: row.status,
      contactPhone: row.contact_phone,
      contactEmail: row.contact_email,
    }));
  },

  async createOperator(input: CreateOperatorInput): Promise<UUID> {
    const { data, error } = await supabase
      .from('operators')
      .insert({
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
        description: input.description?.trim() || null,
        contact_phone: input.contactPhone?.trim() || null,
        contact_email: input.contactEmail?.trim() || null,
      })
      .select('id')
      .single();

    if (error) throw toAppError(error);
    return data.id;
  },

  async listTerminals(): Promise<TerminalRecord[]> {
    const { data, error } = await supabase
      .from('terminals')
      .select('id, name, code, city, province, latitude, longitude, status')
      .order('name');

    if (error) throw toAppError(error);
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      city: row.city,
      province: row.province,
      latitude: num(row.latitude) ?? 0,
      longitude: num(row.longitude) ?? 0,
      status: row.status,
    }));
  },

  async createTerminal(input: CreateTerminalInput): Promise<UUID> {
    const { data, error } = await supabase
      .from('terminals')
      .insert({
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
        city: input.city.trim(),
        province: input.province?.trim() || 'Palawan',
        latitude: input.latitude,
        longitude: input.longitude,
        address: input.address?.trim() || null,
      })
      .select('id')
      .single();

    if (error) throw toAppError(error);
    return data.id;
  },

  async listRoutes(): Promise<RouteRecord[]> {
    const { data, error } = await supabase
      .from('routes')
      .select(
        'id, operator_id, duration_minutes, distance_km, status, ' +
          'operators(name), ' +
          'origin:terminals!routes_origin_terminal_id_fkey(code, name), ' +
          'destination:terminals!routes_destination_terminal_id_fkey(code, name)',
      )
      .order('created_at');

    if (error) throw toAppError(error);

    return (data as unknown as RouteRow[]).map((row) => ({
      id: row.id,
      operatorId: row.operator_id,
      operatorName: row.operators?.name ?? '',
      originCode: row.origin?.code ?? '',
      originName: row.origin?.name ?? '',
      destinationCode: row.destination?.code ?? '',
      destinationName: row.destination?.name ?? '',
      durationMinutes: row.duration_minutes,
      distanceKm: num(row.distance_km),
      status: row.status,
    }));
  },

  async createRoute(input: CreateRouteInput): Promise<UUID> {
    const { data, error } = await supabase
      .from('routes')
      .insert({
        operator_id: input.operatorId,
        origin_terminal_id: input.originTerminalId,
        destination_terminal_id: input.destinationTerminalId,
        duration_minutes: input.durationMinutes,
        distance_km: input.distanceKm ?? null,
      })
      .select('id')
      .single();

    if (error) throw toAppError(error);
    return data.id;
  },

  async listBuses(): Promise<BusRecord[]> {
    const { data, error } = await supabase
      .from('buses')
      .select('id, operator_id, plate_number, bus_number, name, bus_type, capacity, status, operators(name)')
      .order('bus_number');

    if (error) throw toAppError(error);
    return data.map((row) => ({
      id: row.id,
      operatorId: row.operator_id,
      operatorName: row.operators?.name ?? '',
      plateNumber: row.plate_number,
      busNumber: row.bus_number,
      name: row.name,
      busType: row.bus_type,
      capacity: row.capacity,
      status: row.status,
    }));
  },

  /**
   * Creates the coach and its seat layout in one transaction. The layout is
   * generated from `capacity` server-side, so the two cannot disagree.
   */
  async createBus(input: CreateBusInput): Promise<{ id: UUID; seats: number }> {
    const { data, error } = await supabase.rpc('create_bus', {
      p_operator_id: input.operatorId,
      p_plate_number: input.plateNumber,
      p_bus_number: input.busNumber,
      p_capacity: input.capacity,
      p_bus_type: input.busType,
      p_name: input.name ?? undefined,
    });

    if (error) throw fromRpcError(error);
    const result = data as unknown as { id: UUID; seats: number };
    return { id: result.id, seats: result.seats };
  },
};
