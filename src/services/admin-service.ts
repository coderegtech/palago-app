/**
 * Admin console.
 *
 * Analytics come from `admin_dashboard`, a SECURITY DEFINER RPC — the operator
 * views are scoped through `current_operator_id()` and an admin has no
 * operator, so they would correctly return nothing.
 *
 * Every write here is a function call, not a table write. Reference data used
 * to be inserted straight through RLS, which was fine while the only action was
 * "add one"; it is not fine now that there is an edit form and a deactivate
 * button, because a change with no audit trail cannot answer "who took that
 * coach off the road, and when". `20260915000032_bookable_trips.sql` withdrew
 * the client INSERT, UPDATE and DELETE on all four tables.
 *
 * There is no delete. An operator, a terminal, a route and a coach are all
 * referenced by trips, bookings, payments and tickets, so the console's
 * "remove" is deactivation: the row stays, the history stays, and nothing new
 * can be built on it.
 */

import type { AccountStatus, BusType, OperatorStatus, UserRole } from '@/constants/enums';
import { fromRpcError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { operatorService } from '@/services/operator-service';
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

/** A staff login attached to an operator, as an admin sees it. */
export interface StaffAccount {
  id: UUID;
  fullName: string;
  email: string;
  phone: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  mustChangePassword: boolean;
  createdAt: string;
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
    const { data, error } = await supabase.rpc('create_operator', {
      p_name: input.name.trim(),
      p_code: input.code.trim().toUpperCase(),
      p_description: input.description?.trim() || undefined,
      p_contact_phone: input.contactPhone?.trim() || undefined,
      p_contact_email: input.contactEmail?.trim() || undefined,
    });

    if (error) throw fromRpcError(error);
    return (data as unknown as { id: UUID }).id;
  },

  /** The code is identity and is not editable — it is what routes, buses and staff resolve through. */
  async updateOperator(
    operatorId: UUID,
    input: Omit<CreateOperatorInput, 'code'>,
  ): Promise<void> {
    const { error } = await supabase.rpc('update_operator', {
      p_operator_id: operatorId,
      p_name: input.name.trim(),
      p_description: input.description?.trim() || undefined,
      p_contact_phone: input.contactPhone?.trim() || undefined,
      p_contact_email: input.contactEmail?.trim() || undefined,
    });
    if (error) throw fromRpcError(error);
  },

  /**
   * Stops a company's trips being sold. It does NOT lock its staff out — that
   * is a separate action on each account, so the people who have to wind the
   * schedule down can still get in.
   */
  async setOperatorStatus(
    operatorId: UUID,
    status: OperatorStatus,
    reason?: string,
  ): Promise<{ upcomingTrips: number }> {
    const { data, error } = await supabase.rpc('set_operator_status', {
      p_operator_id: operatorId,
      p_status: status,
      p_reason: reason?.trim() || undefined,
    });
    if (error) throw fromRpcError(error);
    const result = data as unknown as { upcomingTrips?: number };
    return { upcomingTrips: result.upcomingTrips ?? 0 };
  },

  /**
   * Staff accounts belonging to one operator.
   *
   * Straight off `profiles`, which only an admin may read beyond their own row.
   * Crew are also in `operator_crew`, but that is scoped to the caller's own
   * operator; this is the platform-wide view an admin needs to see who can sign
   * in for a company they do not belong to.
   */
  async listStaff(operatorId: UUID): Promise<StaffAccount[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, role, account_status, must_change_password, created_at')
      .eq('operator_id', operatorId)
      .order('role')
      .order('full_name');

    if (error) throw toAppError(error);
    return data.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      accountStatus: row.account_status,
      mustChangePassword: row.must_change_password,
      createdAt: row.created_at,
    }));
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
    const { data, error } = await supabase.rpc('create_terminal', {
      p_name: input.name.trim(),
      p_code: input.code.trim().toUpperCase(),
      p_city: input.city.trim(),
      p_latitude: input.latitude,
      p_longitude: input.longitude,
      p_province: input.province?.trim() || undefined,
      p_address: input.address?.trim() || undefined,
    });

    if (error) throw fromRpcError(error);
    return (data as unknown as { id: UUID }).id;
  },

  async updateTerminal(
    terminalId: UUID,
    input: Omit<CreateTerminalInput, 'code'>,
  ): Promise<void> {
    const { error } = await supabase.rpc('update_terminal', {
      p_terminal_id: terminalId,
      p_name: input.name.trim(),
      p_city: input.city.trim(),
      p_latitude: input.latitude,
      p_longitude: input.longitude,
      p_province: input.province?.trim() || undefined,
      p_address: input.address?.trim() || undefined,
    });
    if (error) throw fromRpcError(error);
  },

  async setTerminalStatus(terminalId: UUID, status: OperatorStatus): Promise<void> {
    const { error } = await supabase.rpc('set_terminal_status', {
      p_terminal_id: terminalId,
      p_status: status,
    });
    if (error) throw fromRpcError(error);
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
    const { data, error } = await supabase.rpc('create_route', {
      p_operator_id: input.operatorId,
      p_origin_terminal_id: input.originTerminalId,
      p_destination_terminal_id: input.destinationTerminalId,
      p_duration_minutes: input.durationMinutes,
      p_distance_km: input.distanceKm ?? undefined,
    });

    if (error) throw fromRpcError(error);
    return (data as unknown as { id: UUID }).id;
  },

  /**
   * Only the journey time and distance. Where a route goes is not editable:
   * re-pointing it would silently change every trip and every ticket already
   * sold on it. That is a new route, not an edit.
   */
  async updateRoute(
    routeId: UUID,
    input: { durationMinutes: number; distanceKm?: number | null },
  ): Promise<void> {
    const { error } = await supabase.rpc('update_route', {
      p_route_id: routeId,
      p_duration_minutes: input.durationMinutes,
      p_distance_km: input.distanceKm ?? undefined,
    });
    if (error) throw fromRpcError(error);
  },

  async setRouteStatus(routeId: UUID, status: OperatorStatus): Promise<void> {
    const { error } = await supabase.rpc('set_route_status', {
      p_route_id: routeId,
      p_status: status,
    });
    if (error) throw fromRpcError(error);
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
   *
   * The same call an operator makes for their own fleet — `create_bus` decides
   * whose it is from `p_operator_id` and refuses a company that is not yours —
   * so there is one implementation, in `operator-service`.
   */
  createBus(input: CreateBusInput): Promise<{ id: UUID; seats: number }> {
    return operatorService.createBus(input);
  },

  updateBus(input: {
    busId: UUID;
    busNumber: string;
    plateNumber: string;
    name?: string | null;
    /** Moving a coach between companies is an admin action. */
    operatorId?: UUID;
  }): Promise<void> {
    return operatorService.updateBus(input);
  },

  setBusStatus(
    busId: UUID,
    status: OperatorStatus,
    reason?: string,
  ): Promise<{ upcomingTrips: number }> {
    return operatorService.setBusStatus(busId, status, reason);
  },
};
