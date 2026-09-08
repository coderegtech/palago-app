-- PalaGo development seed.
--
-- Applied by `pnpm db:reset`. Everything here is TEST DATA — the accounts,
-- the schedules and every peso figure. Never load this into a real project.
--
-- Test accounts (all share the password below):
--
--   passenger@palago.test   USER
--   operator@palago.test    OPERATOR   Cherry Bus
--   roro@palago.test        OPERATOR   RoRo Bus
--   driver@palago.test      DRIVER     Cherry Bus
--   assistant@palago.test   ASSISTANT  Cherry Bus
--   admin@palago.test       ADMIN
--
--   password: PalawanGo2026

begin;

-- ---------------------------------------------------------------------------
-- Accounts
--
-- Inserted straight into auth.users because there is no sign-up request to
-- make from SQL. The Phase 2 `on_auth_user_created` trigger still fires, so
-- each of these gets a profile automatically; roles are applied afterwards.
-- ---------------------------------------------------------------------------

create temporary table seed_users (email text, full_name text, phone text) on commit drop;

insert into seed_users (email, full_name, phone) values
  ('passenger@palago.test', 'Juan Dela Cruz',  '09171234567'),
  ('operator@palago.test',  'Cherry Bus Ops',  '09181234567'),
  ('roro@palago.test',      'RoRo Bus Ops',    '09191234567'),
  ('driver@palago.test',    'Juan Santos',     '09171112222'),
  ('assistant@palago.test', 'Maria Reyes',     '09173334444'),
  ('admin@palago.test',     'PalaGo Admin',    '09170000000');

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
from seed_users su;

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
where u.email in (select email from seed_users);

-- ---------------------------------------------------------------------------
-- Operators
-- ---------------------------------------------------------------------------

insert into public.operators (name, code, description, contact_phone, contact_email) values
  ('Cherry Bus', 'CHERRY',
   'Air-conditioned coaches serving the Puerto Princesa to El Nido and Coron corridors.',
   '+63 917 555 0101', 'support@cherrybus.test'),
  ('RoRo Bus', 'RORO',
   'Roll-on/roll-off coach services connecting Palawan with the wider Visayas.',
   '+63 917 555 0202', 'support@rorobus.test');

-- ---------------------------------------------------------------------------
-- Roles and operator membership
-- ---------------------------------------------------------------------------

update public.profiles p set role = 'ADMIN' where p.email = 'admin@palago.test';

update public.profiles p
set role = 'OPERATOR', operator_id = (select id from public.operators where code = 'CHERRY')
where p.email = 'operator@palago.test';

update public.profiles p
set role = 'OPERATOR', operator_id = (select id from public.operators where code = 'RORO')
where p.email = 'roro@palago.test';

update public.profiles p
set role = 'DRIVER', operator_id = (select id from public.operators where code = 'CHERRY')
where p.email = 'driver@palago.test';

update public.profiles p
set role = 'ASSISTANT', operator_id = (select id from public.operators where code = 'CHERRY')
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
  ('Taytay Terminal',          'TAY', 'Poblacion, Taytay',                  10.813300, 119.516700, 'Taytay');

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
join public.terminals dest on dest.code = r.destination_code;

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
join public.operators o on o.code = b.operator_code;

-- ---------------------------------------------------------------------------
-- Seat layouts
--
-- A 2+2 coach: columns 1-2, aisle, columns 3-4. Row 1 is priority seating
-- (senior / PWD), which is how Philippine coaches are actually arranged.
-- Generated rather than typed out, so capacity and layout cannot disagree.
-- ---------------------------------------------------------------------------

insert into public.bus_seats (bus_id, seat_number, row_number, column_number, seat_type, is_window, is_aisle)
select
  b.id,
  s.row_number || chr(64 + s.column_number),          -- 1A, 1B, 1C, 1D, 2A, …
  s.row_number,
  s.column_number,
  case when s.row_number = 1 then 'PRIORITY' else 'REGULAR' end::public.seat_type,
  s.column_number in (1, 4),                           -- window seats
  s.column_number in (2, 3)                            -- aisle seats
from public.buses b
cross join lateral (
  select gs.row_number, gc.column_number
  from generate_series(1, ceil(b.capacity / 4.0)::int) as gs(row_number)
  cross join generate_series(1, 4) as gc(column_number)
) s
where (s.row_number - 1) * 4 + s.column_number <= b.capacity;

-- ---------------------------------------------------------------------------
-- Crew
-- ---------------------------------------------------------------------------

insert into public.drivers (operator_id, user_id, license_number, name, phone)
select
  (select id from public.operators where code = 'CHERRY'),
  (select id from auth.users where email = 'driver@palago.test'),
  'DRV-001', 'Juan Santos', '+63 917 123 4567';

insert into public.drivers (operator_id, license_number, name, phone)
select (select id from public.operators where code = 'RORO'), 'DRV-002', 'Pedro Ramos', '+63 917 222 3333';

insert into public.assistants (operator_id, user_id, name, phone)
select
  (select id from public.operators where code = 'CHERRY'),
  (select id from auth.users where email = 'assistant@palago.test'),
  'Maria Reyes', '+63 905 987 6543';

insert into public.assistants (operator_id, name, phone)
select (select id from public.operators where code = 'RORO'), 'Ana Lim', '+63 905 111 2222';

-- ---------------------------------------------------------------------------
-- Trips
--
-- Dated relative to now() so the seed stays useful however long after it was
-- written the database is reset. Seat inventory is created automatically by the
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
  -- operator, origin, destination, bus_number, day offset, departure, fare (centavos), status
  ('CHERRY', 'PPS', 'ELN', 'CB-001', 0, '06:00', 70000, 'SCHEDULED', 'A'),
  ('CHERRY', 'PPS', 'ELN', 'CB-002', 0, '13:00', 70000, 'SCHEDULED', 'B'),
  ('CHERRY', 'ELN', 'PPS', 'CB-001', 1, '06:00', 70000, 'SCHEDULED', 'C'),
  ('CHERRY', 'PPS', 'RXS', 'CB-003', 1, '08:30', 35000, 'SCHEDULED', 'D'),
  ('CHERRY', 'PPS', 'ELN', 'CB-002', 2, '06:00', 70000, 'SCHEDULED', 'E'),
  ('CHERRY', 'PPS', 'BKP', 'CB-003', 2, '09:00', 45000, 'SCHEDULED', 'F'),
  ('RORO',   'PPS', 'CRN', 'RB-001', 0, '20:00', 120000, 'SCHEDULED', 'A'),
  ('RORO',   'CRN', 'PPS', 'RB-002', 1, '20:00', 120000, 'SCHEDULED', 'B'),
  ('RORO',   'ELN', 'CRN', 'RB-001', 2, '07:00', 95000, 'SCHEDULED', 'C'),
  ('RORO',   'PPS', 'TAY', 'RB-002', 3, '10:00', 60000, 'SCHEDULED', 'D')
) as t(operator_code, origin_code, destination_code, bus_number, day_offset, departure_time, fare, status, slot)
join public.operators o on o.code = t.operator_code
join public.terminals orig on orig.code = t.origin_code
join public.terminals dest on dest.code = t.destination_code
join public.routes r
  on r.operator_id = o.id
 and r.origin_terminal_id = orig.id
 and r.destination_terminal_id = dest.id
join public.buses b on b.operator_id = o.id and b.bus_number = t.bus_number;

-- ---------------------------------------------------------------------------
-- Crew assignments
-- ---------------------------------------------------------------------------

insert into public.trip_assignments (trip_id, driver_id, assistant_id, status)
select
  t.id,
  d.id,
  a.id,
  'ASSIGNED'
from public.trips t
join public.operators o on o.id = t.operator_id and o.code = 'CHERRY'
join public.drivers d on d.operator_id = o.id and d.license_number = 'DRV-001'
join public.assistants a on a.operator_id = o.id and a.name = 'Maria Reyes';

-- ---------------------------------------------------------------------------
-- A couple of blocked seats, so the seat map has something other than
-- AVAILABLE to render while Phase 4 is being built.
-- ---------------------------------------------------------------------------

update public.trip_seats ts
set status = 'BLOCKED'
from public.bus_seats bs, public.trips t
where ts.seat_id = bs.id
  and ts.trip_id = t.id
  and t.trip_number like 'CHERRY-%-A'
  and bs.seat_number in ('1A', '1B');

commit;
