-- PalaGo cloud seed — accounts and schedule only.
--
-- A trimmed, re-runnable version of supabase/seed.sql for a HOSTED project you
-- want to sign in to and demo. It contains exactly what the app needs to be
-- usable — the test accounts, the two operators, terminals, routes, buses, seat
-- layouts, crew, and a rolling set of scheduled trips — and NOTHING that
-- fabricates a transaction: no bookings, payments, receipts, wallet balances,
-- loyalty points, boarding scans or GPS history. Those are demo artefacts and
-- have no business sitting in a shared project looking real (AGENTS.md:
-- "Never load [seed.sql] into a real project").
--
-- This build is MOCK PAYMENT ONLY, so there is no real money anywhere — but a
-- receipt or a balance here would still be indistinguishable from a genuine
-- one. Keep this file pointed at a staging / demo project, not anything meant
-- to be a record of truth.
--
-- PREREQUISITE: the schema must already be there. Push migrations first:
--   SUPABASE_PROJECT_REF=<ref> pnpm db:push:prod -- --yes
--
-- THEN run this file against the same project, either:
--   * Supabase Studio → SQL Editor → paste this file → Run, or
--   * psql "<connection string from Project Settings → Database>" \
--       -f supabase/seed.cloud.sql
--
-- Every statement is guarded, so running it a second time is a no-op (trips are
-- the exception — their number embeds today's date, so a later run adds a fresh
-- window of departures and leaves the old ones alone).
--
-- Accounts (all share the password): full reference in docs/test-accounts.md
--
--   passenger@palago.test    USER
--   passenger2@palago.test   USER
--   operator@palago.test     OPERATOR   Cherry Bus
--   roro@palago.test         OPERATOR   RoRo Bus
--   driver@palago.test       DRIVER     Cherry Bus
--   assistant@palago.test    ASSISTANT  Cherry Bus
--   admin@palago.test        ADMIN
--
--   password: PalawanGo2026

begin;

-- ---------------------------------------------------------------------------
-- Accounts
--
-- Inserted straight into auth.users because there is no sign-up request to
-- make from SQL. The Phase 2 `handle_new_user` trigger still fires, so each of
-- these gets a profile automatically; roles are applied afterwards.
-- ---------------------------------------------------------------------------

create temporary table seed_users (email text, full_name text, phone text) on commit drop;

insert into seed_users (email, full_name, phone) values
  ('passenger@palago.test',  'Juan Dela Cruz',  '09171234567'),
  ('passenger2@palago.test',  'Ana Villanueva',  '09175556666'),
  ('operator@palago.test',    'Cherry Bus Ops',  '09181234567'),
  ('roro@palago.test',        'RoRo Bus Ops',    '09191234567'),
  ('driver@palago.test',      'Juan Santos',     '09171112222'),
  ('assistant@palago.test',   'Maria Reyes',     '09173334444'),
  ('admin@palago.test',       'PalaGo Admin',    '09170000000');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  -- These four have no column default and GoTrue reads them into non-nullable
  -- Go strings. Leaving them NULL makes every sign-in fail with
  -- "Database error querying schema", which looks nothing like the real cause.
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  su.email,
  extensions.crypt('PalawanGo2026', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', su.full_name, 'phone', su.phone),
  now(),
  now(),
  '', '', '', ''
from seed_users su
where not exists (select 1 from auth.users u where u.email = su.email);

-- Supabase requires a matching identity row for email sign-in to work.
insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
select
  gen_random_uuid(),
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  u.id::text,
  now(),
  now()
from auth.users u
where u.email in (select email from seed_users)
  and not exists (
    select 1 from auth.identities i
    where i.provider = 'email' and i.provider_id = u.id::text
  );

-- ---------------------------------------------------------------------------
-- Operators
-- ---------------------------------------------------------------------------

insert into public.operators (name, code, description, contact_phone, contact_email) values
  ('Cherry Bus', 'CHERRY',
   'Air-conditioned coaches serving the Puerto Princesa to El Nido and Coron corridors.',
   '+63 917 555 0101', 'support@cherrybus.test'),
  ('RoRo Bus', 'RORO',
   'Roll-on/roll-off coach services connecting Palawan with the wider Visayas.',
   '+63 917 555 0202', 'support@rorobus.test')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Roles and operator membership (idempotent — re-sets the same values)
-- ---------------------------------------------------------------------------

update public.profiles p set role = 'SUPER_ADMIN' where p.email = 'admin@palago.test';

-- The team's testing account: survives an admin data reset with its history
-- emptied, so the passenger app can still be tested afterwards. See
-- 20260918000036_data_reset.sql.
update public.profiles set is_test_account = true where email = 'passenger@palago.test';

update public.profiles p
set role = 'OPERATOR_ADMIN', operator_id = (select id from public.operators where code = 'CHERRY')
where p.email = 'operator@palago.test';

update public.profiles p
set role = 'OPERATOR_ADMIN', operator_id = (select id from public.operators where code = 'RORO')
where p.email = 'roro@palago.test';

update public.profiles p
set role = 'DRIVER', operator_id = (select id from public.operators where code = 'CHERRY')
where p.email = 'driver@palago.test';

update public.profiles p
set role = 'CREW', operator_id = (select id from public.operators where code = 'CHERRY')
where p.email = 'assistant@palago.test';

update public.profiles p
set emergency_contact_name = 'Maria Dela Cruz', emergency_contact_phone = '09177654321'
where p.email = 'passenger@palago.test';

-- ---------------------------------------------------------------------------
-- Terminals
-- ---------------------------------------------------------------------------

insert into public.terminals (name, code, address, latitude, longitude, city) values
  ('Puerto Princesa Terminal', 'PPS', 'San Jose Terminal, Puerto Princesa', 9.789200, 118.734100, 'Puerto Princesa'),
  ('El Nido Terminal',         'ELN', 'Corong-Corong, El Nido',             11.180500, 119.393300, 'El Nido'),
  ('Coron Terminal',           'CRN', 'Poblacion, Coron',                   12.005400, 120.204200, 'Coron'),
  ('Roxas Terminal',           'RXS', 'Poblacion, Roxas',                   10.310800, 119.345000, 'Roxas'),
  ('Brooke''s Point Terminal', 'BKP', 'Poblacion, Brooke''s Point',          8.777800, 117.834400, 'Brooke''s Point'),
  ('Taytay Terminal',          'TAY', 'Poblacion, Taytay',                  10.813300, 119.516700, 'Taytay')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Routes
-- ---------------------------------------------------------------------------

insert into public.routes (operator_id, origin_terminal_id, destination_terminal_id, duration_minutes, distance_km)
select o.id, orig.id, dest.id, r.duration_minutes, r.distance_km
from (values
  ('CHERRY', 'PPS', 'ELN', 330, 238.0),
  ('CHERRY', 'ELN', 'PPS', 330, 238.0),
  ('CHERRY', 'PPS', 'RXS', 150, 128.0),
  ('CHERRY', 'RXS', 'PPS', 150, 128.0),
  ('CHERRY', 'PPS', 'BKP', 240, 192.0),
  ('RORO',   'PPS', 'CRN', 600, 402.0),
  ('RORO',   'CRN', 'PPS', 600, 402.0),
  ('RORO',   'ELN', 'CRN', 270, 180.0),
  ('RORO',   'PPS', 'TAY', 300, 218.0)
) as r(operator_code, origin_code, destination_code, duration_minutes, distance_km)
join public.operators o on o.code = r.operator_code
join public.terminals orig on orig.code = r.origin_code
join public.terminals dest on dest.code = r.destination_code
on conflict on constraint routes_unique do nothing;

-- ---------------------------------------------------------------------------
-- Buses
-- ---------------------------------------------------------------------------

insert into public.buses (operator_id, plate_number, bus_number, name, bus_type, capacity)
select o.id, b.plate_number, b.bus_number, b.name, b.bus_type::public.bus_type, b.capacity
from (values
  ('CHERRY', 'PLW 1001', 'CB-001', 'Cherry Bus 001', 'BUS',  44),
  ('CHERRY', 'PLW 1002', 'CB-002', 'Cherry Bus 002', 'BUS',  44),
  ('CHERRY', 'PLW 1003', 'CB-003', 'Cherry Bus 003', 'BUS',  36),
  ('RORO',   'PLW 2001', 'RB-001', 'RoRo Bus 001',   'RORO', 48),
  ('RORO',   'PLW 2002', 'RB-002', 'RoRo Bus 002',   'RORO', 48)
) as b(operator_code, plate_number, bus_number, name, bus_type, capacity)
join public.operators o on o.code = b.operator_code
on conflict (plate_number) do nothing;

-- ---------------------------------------------------------------------------
-- Seat layouts
--
-- A 2+2 coach: columns 1-2, aisle, columns 3-4. Row 1 is priority seating.
-- Generated rather than typed out, so capacity and layout cannot disagree.
-- ---------------------------------------------------------------------------

insert into public.bus_seats (bus_id, seat_number, row_number, column_number, seat_type, is_window, is_aisle)
select
  b.id,
  s.row_number || chr(64 + s.column_number),
  s.row_number,
  s.column_number,
  case when s.row_number = 1 then 'PRIORITY' else 'REGULAR' end::public.seat_type,
  s.column_number in (1, 4),
  s.column_number in (2, 3)
from public.buses b
cross join lateral (
  select gs.row_number, gc.column_number
  from generate_series(1, ceil(b.capacity / 4.0)::int) as gs(row_number)
  cross join generate_series(1, 4) as gc(column_number)
) s
where (s.row_number - 1) * 4 + s.column_number <= b.capacity
on conflict (bus_id, seat_number) do nothing;

-- ---------------------------------------------------------------------------
-- Crew
-- ---------------------------------------------------------------------------

insert into public.drivers (operator_id, user_id, license_number, name, phone)
select
  (select id from public.operators where code = 'CHERRY'),
  (select id from auth.users where email = 'driver@palago.test'),
  'DRV-001', 'Juan Santos', '+63 917 123 4567'
on conflict (operator_id, license_number) do nothing;

insert into public.drivers (operator_id, license_number, name, phone)
select (select id from public.operators where code = 'RORO'), 'DRV-002', 'Pedro Ramos', '+63 917 222 3333'
on conflict (operator_id, license_number) do nothing;

insert into public.assistants (operator_id, user_id, name, phone)
select
  (select id from public.operators where code = 'CHERRY'),
  (select id from auth.users where email = 'assistant@palago.test'),
  'Maria Reyes', '+63 905 987 6543'
where not exists (
  select 1 from public.assistants a
  join public.operators o on o.id = a.operator_id
  where o.code = 'CHERRY' and a.name = 'Maria Reyes'
);

insert into public.assistants (operator_id, name, phone)
select (select id from public.operators where code = 'RORO'), 'Ana Lim', '+63 905 111 2222'
where not exists (
  select 1 from public.assistants a
  join public.operators o on o.id = a.operator_id
  where o.code = 'RORO' and a.name = 'Ana Lim'
);

-- ---------------------------------------------------------------------------
-- Trips
--
-- Dated relative to current_date, so a fresh run always leaves a usable window
-- of upcoming departures. Seat inventory is created automatically by the
-- `trips_create_seat_inventory` trigger.
-- ---------------------------------------------------------------------------

insert into public.trips (
  operator_id, route_id, bus_id, trip_number, departure_date, departure_time, arrival_time, fare, status
)
select
  r.operator_id,
  r.id,
  b.id,
  t.operator_code || '-' || to_char(current_date + t.day_offset, 'MMDD') || '-' || t.slot,
  current_date + t.day_offset,
  t.departure_time::time,
  (t.departure_time::time + make_interval(mins => r.duration_minutes)),
  t.fare,
  t.status::public.trip_status
from (values
  ('CHERRY', 'PPS', 'ELN', 'CB-001', 0, '06:00', 70000,  'SCHEDULED', 'A'),
  ('CHERRY', 'PPS', 'ELN', 'CB-002', 0, '13:00', 70000,  'SCHEDULED', 'B'),
  ('CHERRY', 'ELN', 'PPS', 'CB-001', 1, '06:00', 70000,  'SCHEDULED', 'C'),
  ('CHERRY', 'PPS', 'RXS', 'CB-003', 1, '08:30', 35000,  'SCHEDULED', 'D'),
  ('CHERRY', 'PPS', 'ELN', 'CB-002', 2, '06:00', 70000,  'SCHEDULED', 'E'),
  ('CHERRY', 'PPS', 'BKP', 'CB-003', 2, '09:00', 45000,  'SCHEDULED', 'F'),
  ('RORO',   'PPS', 'CRN', 'RB-001', 0, '20:00', 120000, 'SCHEDULED', 'A'),
  ('RORO',   'CRN', 'PPS', 'RB-002', 1, '20:00', 120000, 'SCHEDULED', 'B'),
  ('RORO',   'ELN', 'CRN', 'RB-001', 2, '07:00', 95000,  'SCHEDULED', 'C'),
  ('RORO',   'PPS', 'TAY', 'RB-002', 3, '10:00', 60000,  'SCHEDULED', 'D')
) as t(operator_code, origin_code, destination_code, bus_number, day_offset, departure_time, fare, status, slot)
join public.operators o on o.code = t.operator_code
join public.terminals orig on orig.code = t.origin_code
join public.terminals dest on dest.code = t.destination_code
join public.routes r
  on r.operator_id = o.id
 and r.origin_terminal_id = orig.id
 and r.destination_terminal_id = dest.id
join public.buses b on b.operator_id = o.id and b.bus_number = t.bus_number
on conflict (operator_id, trip_number) do nothing;

-- ---------------------------------------------------------------------------
-- Crew assignments — Cherry Bus crew on every Cherry departure that has none
-- ---------------------------------------------------------------------------

insert into public.trip_assignments (trip_id, driver_id, assistant_id, status)
select t.id, d.id, a.id, 'ASSIGNED'
from public.trips t
join public.operators o on o.id = t.operator_id and o.code = 'CHERRY'
join public.drivers d on d.operator_id = o.id and d.license_number = 'DRV-001'
join public.assistants a on a.operator_id = o.id and a.name = 'Maria Reyes'
where not exists (
  select 1 from public.trip_assignments ta where ta.trip_id = t.id
);

commit;
