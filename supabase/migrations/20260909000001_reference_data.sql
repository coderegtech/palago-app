-- Phase 3a: operators, terminals, routes, buses and seat layouts.
--
-- This is the reference data the booking funnel reads: who runs the service,
-- where it goes from and to, with which vehicles, and how those vehicles are
-- laid out. It changes rarely and is written by operators and admins only.
--
-- Every enum here mirrors src/constants/enums.ts exactly. Change both together.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.operator_status as enum ('ACTIVE', 'INACTIVE');
create type public.bus_type as enum ('BUS', 'RORO');
create type public.seat_type as enum ('REGULAR', 'PRIORITY', 'DRIVER', 'RESERVED');

-- ---------------------------------------------------------------------------
-- Operators
-- ---------------------------------------------------------------------------

create table public.operators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  logo_url text,
  description text,
  contact_phone text,
  contact_email text,
  status public.operator_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.operators is 'Bus companies using PalaGo, e.g. Cherry Bus and RoRo Bus.';

create trigger operators_set_updated_at
  before update on public.operators
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Operator membership
--
-- `profiles.role` says *what kind* of account this is; `operator_id` says
-- *whose*. Every operator-scoped RLS policy in PalaGo resolves through this
-- column, which is why it is set administratively and is not writable by the
-- account holder (the Phase 2 column grants already exclude it).
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column operator_id uuid references public.operators (id) on delete set null;

comment on column public.profiles.operator_id is
  'Operator this staff account belongs to. NULL for passengers and admins.';

create index profiles_operator_id_idx on public.profiles (operator_id);

/**
 * The caller's operator, or NULL.
 *
 * SECURITY DEFINER so it can read `profiles` without tripping that table's own
 * RLS, exactly as `is_admin()` does.
 */
create or replace function public.current_operator_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select operator_id from public.profiles where id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Terminals
-- ---------------------------------------------------------------------------

create table public.terminals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  address text,
  latitude numeric(9, 6) not null,
  longitude numeric(9, 6) not null,
  city text not null,
  province text not null default 'Palawan',
  status public.operator_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint terminals_latitude_valid check (latitude between -90 and 90),
  constraint terminals_longitude_valid check (longitude between -180 and 180)
);

create trigger terminals_set_updated_at
  before update on public.terminals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Routes
-- ---------------------------------------------------------------------------

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators (id) on delete cascade,
  origin_terminal_id uuid not null references public.terminals (id) on delete restrict,
  destination_terminal_id uuid not null references public.terminals (id) on delete restrict,
  duration_minutes integer not null,
  distance_km numeric(7, 2),
  status public.operator_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routes_distinct_terminals check (origin_terminal_id <> destination_terminal_id),
  constraint routes_duration_positive check (duration_minutes > 0),
  constraint routes_unique unique (operator_id, origin_terminal_id, destination_terminal_id)
);

create index routes_operator_id_idx on public.routes (operator_id);
create index routes_origin_idx on public.routes (origin_terminal_id);
create index routes_destination_idx on public.routes (destination_terminal_id);

create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Buses
-- ---------------------------------------------------------------------------

create table public.buses (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators (id) on delete cascade,
  plate_number text not null unique,
  bus_number text not null,
  name text,
  bus_type public.bus_type not null default 'BUS',
  capacity integer not null,
  status public.operator_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buses_capacity_positive check (capacity > 0),
  constraint buses_number_unique unique (operator_id, bus_number)
);

create index buses_operator_id_idx on public.buses (operator_id);

create trigger buses_set_updated_at
  before update on public.buses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seat layout
--
-- The physical seats of a bus. A trip's *sellable inventory* is `trip_seats`,
-- created per departure — these rows describe the vehicle, not availability.
-- ---------------------------------------------------------------------------

create table public.bus_seats (
  id uuid primary key default gen_random_uuid(),
  bus_id uuid not null references public.buses (id) on delete cascade,
  seat_number text not null,
  row_number integer not null,
  column_number integer not null,
  seat_type public.seat_type not null default 'REGULAR',
  is_window boolean not null default false,
  is_aisle boolean not null default false,
  status public.operator_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  constraint bus_seats_number_unique unique (bus_id, seat_number),
  constraint bus_seats_position_unique unique (bus_id, row_number, column_number),
  constraint bus_seats_row_positive check (row_number > 0),
  constraint bus_seats_column_positive check (column_number > 0)
);

create index bus_seats_bus_id_idx on public.bus_seats (bus_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Reference data is readable by any signed-in user — you cannot search for a
-- trip without seeing operators, terminals and routes. Writes are restricted to
-- the owning operator and admins.
--
-- Note there is no `anon` access: the public payment page reads through an Edge
-- Function, never straight from these tables.
-- ---------------------------------------------------------------------------

alter table public.operators enable row level security;
alter table public.terminals enable row level security;
alter table public.routes enable row level security;
alter table public.buses enable row level security;
alter table public.bus_seats enable row level security;

create policy "Signed-in users read operators"
  on public.operators for select to authenticated using (true);

create policy "Admins write operators"
  on public.operators for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Operators update their own record"
  on public.operators for update to authenticated
  using (id = public.current_operator_id())
  with check (id = public.current_operator_id());

create policy "Signed-in users read terminals"
  on public.terminals for select to authenticated using (true);

create policy "Admins write terminals"
  on public.terminals for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Signed-in users read routes"
  on public.routes for select to authenticated using (true);

create policy "Operators write their own routes"
  on public.routes for all to authenticated
  using (operator_id = public.current_operator_id() or public.is_admin())
  with check (operator_id = public.current_operator_id() or public.is_admin());

create policy "Signed-in users read buses"
  on public.buses for select to authenticated using (true);

create policy "Operators write their own buses"
  on public.buses for all to authenticated
  using (operator_id = public.current_operator_id() or public.is_admin())
  with check (operator_id = public.current_operator_id() or public.is_admin());

create policy "Signed-in users read seat layouts"
  on public.bus_seats for select to authenticated using (true);

create policy "Operators write their own seat layouts"
  on public.bus_seats for all to authenticated
  using (
    exists (
      select 1 from public.buses b
      where b.id = bus_id
        and (b.operator_id = public.current_operator_id() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.buses b
      where b.id = bus_id
        and (b.operator_id = public.current_operator_id() or public.is_admin())
    )
  );
