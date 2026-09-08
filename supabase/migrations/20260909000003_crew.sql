-- Phase 3c: drivers, assistants and their trip assignments.

create type public.staff_status as enum ('ACTIVE', 'INACTIVE', 'SUSPENDED');
create type public.assignment_status as enum ('ASSIGNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- ---------------------------------------------------------------------------
-- Drivers and assistants
--
-- `user_id` is nullable on purpose: an operator records crew before those
-- people necessarily have PalaGo accounts. Once linked, that column is what
-- lets a driver see their own assignments and publish GPS for their trip.
-- ---------------------------------------------------------------------------

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators (id) on delete cascade,
  user_id uuid unique references auth.users (id) on delete set null,
  license_number text not null,
  name text not null,
  phone text,
  status public.staff_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drivers_license_unique unique (operator_id, license_number)
);

create index drivers_operator_id_idx on public.drivers (operator_id);
create index drivers_user_id_idx on public.drivers (user_id);

create trigger drivers_set_updated_at
  before update on public.drivers
  for each row execute function public.set_updated_at();

create table public.assistants (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators (id) on delete cascade,
  user_id uuid unique references auth.users (id) on delete set null,
  name text not null,
  phone text,
  status public.staff_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assistants_operator_id_idx on public.assistants (operator_id);
create index assistants_user_id_idx on public.assistants (user_id);

create trigger assistants_set_updated_at
  before update on public.assistants
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Trip assignments
-- ---------------------------------------------------------------------------

create table public.trip_assignments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  driver_id uuid references public.drivers (id) on delete set null,
  assistant_id uuid references public.assistants (id) on delete set null,
  assigned_at timestamptz not null default now(),
  status public.assignment_status not null default 'ASSIGNED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One *live* crew assignment per trip. A partial index rather than
-- `unique (trip_id, status)`, which would have allowed an ASSIGNED and an
-- ACTIVE row side by side while wrongly blocking a second CANCELLED one.
create unique index trip_assignments_one_live_idx
  on public.trip_assignments (trip_id)
  where status in ('ASSIGNED', 'ACTIVE');

create index trip_assignments_trip_id_idx on public.trip_assignments (trip_id);
create index trip_assignments_driver_id_idx on public.trip_assignments (driver_id);
create index trip_assignments_assistant_id_idx on public.trip_assignments (assistant_id);

create trigger trip_assignments_set_updated_at
  before update on public.trip_assignments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Crew self-lookup
--
-- SECURITY DEFINER, for the same reason as `is_admin()`: a driver policy that
-- reads `drivers` would recurse into that table's own policy.
-- ---------------------------------------------------------------------------

create or replace function public.current_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.drivers where user_id = (select auth.uid());
$$;

create or replace function public.current_assistant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.assistants where user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Crew records are operator-internal: unlike trips and terminals they are NOT
-- readable by every signed-in user. A passenger has no business enumerating
-- driver names, licence numbers and phone numbers. The passenger-facing subset
-- (the driver's name on an active trip) is exposed through a view or Edge
-- Function in Phase 7 rather than by opening this table up.
-- ---------------------------------------------------------------------------

alter table public.drivers enable row level security;
alter table public.assistants enable row level security;
alter table public.trip_assignments enable row level security;

create policy "Operators read their own drivers"
  on public.drivers for select to authenticated
  using (
    operator_id = public.current_operator_id()
    or user_id = (select auth.uid())
    or public.is_admin()
  );

create policy "Operators write their own drivers"
  on public.drivers for all to authenticated
  using (operator_id = public.current_operator_id() or public.is_admin())
  with check (operator_id = public.current_operator_id() or public.is_admin());

create policy "Operators read their own assistants"
  on public.assistants for select to authenticated
  using (
    operator_id = public.current_operator_id()
    or user_id = (select auth.uid())
    or public.is_admin()
  );

create policy "Operators write their own assistants"
  on public.assistants for all to authenticated
  using (operator_id = public.current_operator_id() or public.is_admin())
  with check (operator_id = public.current_operator_id() or public.is_admin());

create policy "Operators and assigned crew read assignments"
  on public.trip_assignments for select to authenticated
  using (
    public.is_admin()
    or driver_id = public.current_driver_id()
    or assistant_id = public.current_assistant_id()
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and t.operator_id = public.current_operator_id()
    )
  );

create policy "Operators write their own assignments"
  on public.trip_assignments for all to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and t.operator_id = public.current_operator_id()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and t.operator_id = public.current_operator_id()
    )
  );
