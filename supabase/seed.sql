-- PalaGo development seed.
--
-- Applied by `pnpm db:reset`. Everything here is TEST DATA — the accounts,
-- the schedules, the payments, the wallet and loyalty movement, and every
-- peso figure. Never load this into a real project.
--
-- Test accounts (all share the password below). Full reference, including what
-- each one is for and where it lands after sign-in: docs/test-accounts.md
--
--   passenger@palago.test    USER
--   passenger2@palago.test   USER       (a second passenger, for isolation tests)
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
-- make from SQL. The Phase 2 `on_auth_user_created` trigger still fires, so
-- each of these gets a profile automatically; roles are applied afterwards.
-- ---------------------------------------------------------------------------

create temporary table seed_users (email text, full_name text, phone text) on commit drop;

insert into seed_users (email, full_name, phone) values
  ('passenger@palago.test', 'Juan Dela Cruz',  '09171234567'),
  -- A second ordinary passenger. Needed to test anything about isolation
  -- between users: an admin makes a poor stand-in, because an admin is
  -- legitimately allowed to see and cancel other people's bookings.
  ('passenger2@palago.test', 'Ana Villanueva', '09175556666'),
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
-- Two extra Cherry Bus trips: one already finished, one currently under way.
-- Slots 'Z' and 'Y' so they cannot collide with A-F above. Everything from
-- here to the end of the file builds realistic activity on top of the plain
-- schedule — bookings, payments, boarding, tracking, wallet and loyalty
-- movement — so every table has more than an empty shell to render against.
-- ---------------------------------------------------------------------------

create temporary table seed_extra_trips (label text primary key, trip_id uuid not null) on commit drop;

with ins as (
  insert into public.trips (
    operator_id, route_id, bus_id, trip_number, departure_date, departure_time, arrival_time, fare, status
  )
  select
    o.id, r.id, b.id,
    'CHERRY-' || to_char(current_date - 1, 'MMDD') || '-Z',
    current_date - 1, '06:00'::time,
    ('06:00'::time + make_interval(mins => r.duration_minutes)),
    70000, 'ARRIVED'::public.trip_status
  from public.operators o
  join public.routes r on r.operator_id = o.id
  join public.terminals orig on orig.id = r.origin_terminal_id and orig.code = 'PPS'
  join public.terminals dest on dest.id = r.destination_terminal_id and dest.code = 'ELN'
  join public.buses b on b.operator_id = o.id and b.bus_number = 'CB-001'
  where o.code = 'CHERRY'
  returning id
)
insert into seed_extra_trips select 'HISTORICAL', id from ins;

with ins as (
  insert into public.trips (
    operator_id, route_id, bus_id, trip_number, departure_date, departure_time, arrival_time, fare, status
  )
  select
    o.id, r.id, b.id,
    'CHERRY-' || to_char(current_date, 'MMDD') || '-Y',
    current_date, '08:00'::time,
    ('08:00'::time + make_interval(mins => r.duration_minutes)),
    70000, 'DEPARTED'::public.trip_status
  from public.operators o
  join public.routes r on r.operator_id = o.id
  join public.terminals orig on orig.id = r.origin_terminal_id and orig.code = 'PPS'
  join public.terminals dest on dest.id = r.destination_terminal_id and dest.code = 'ELN'
  join public.buses b on b.operator_id = o.id and b.bus_number = 'CB-003'
  where o.code = 'CHERRY'
  returning id
)
insert into seed_extra_trips select 'LIVE', id from ins;

-- ---------------------------------------------------------------------------
-- Crew assignments
--
-- Runs after the extra trips above, so 'Z' and 'Y' pick up the same default
-- crew as every other Cherry Bus departure; the two updates that follow move
-- them to the assignment status each trip's stage of the journey implies.
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

update public.trip_assignments
   set status = 'COMPLETED'
 where trip_id = (select trip_id from seed_extra_trips where label = 'HISTORICAL');

update public.trip_assignments
   set status = 'ACTIVE'
 where trip_id = (select trip_id from seed_extra_trips where label = 'LIVE');

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

-- ---------------------------------------------------------------------------
-- Actual departure/arrival times for the two extra trips. Never defaulted to
-- the schedule (docs/database.md) — set explicitly here instead, the same way
-- `start_trip` / `end_trip` would.
-- ---------------------------------------------------------------------------

update public.trips
   set actual_departure_at = departure_date + departure_time,
       actual_arrival_at = (departure_date + departure_time) + interval '338 minutes'
 where id = (select trip_id from seed_extra_trips where label = 'HISTORICAL');

update public.trips
   set actual_departure_at = now() - interval '18 minutes'
 where id = (select trip_id from seed_extra_trips where label = 'LIVE');

-- ---------------------------------------------------------------------------
-- bus_locations
--
-- A finished trail for the completed trip (Puerto Princesa to El Nido, four
-- fixes across the 338-minute run) and a short, recent trail for the trip
-- still under way (three fixes in the last 18 minutes, barely out of Puerto
-- Princesa). Coordinates are linear interpolation between the two terminals —
-- illustrative, not a real road route.
-- ---------------------------------------------------------------------------

insert into public.bus_locations (trip_id, driver_id, latitude, longitude, speed_kph, heading, accuracy_m, recorded_at)
select t.id, ta.driver_id, v.latitude, v.longitude, v.speed_kph, v.heading, v.accuracy_m,
       t.actual_departure_at + make_interval(mins => v.minute_offset)
from public.trips t
join public.trip_assignments ta on ta.trip_id = t.id
cross join (values
  (34::integer,  9.9283::numeric, 118.8000::numeric, 58.0::numeric, 38.0::numeric,  9.0::numeric),
  (135::integer, 10.3457::numeric, 118.9978::numeric, 62.0::numeric, 35.0::numeric,  7.5::numeric),
  (237::integer, 10.7631::numeric, 119.1955::numeric, 60.0::numeric, 32.0::numeric,  8.0::numeric),
  (338::integer, 11.1805::numeric, 119.3933::numeric,  8.0::numeric, null::numeric, 12.0::numeric)
) as v(minute_offset, latitude, longitude, speed_kph, heading, accuracy_m)
where t.id = (select trip_id from seed_extra_trips where label = 'HISTORICAL');

insert into public.bus_locations (trip_id, driver_id, latitude, longitude, speed_kph, heading, accuracy_m, recorded_at)
select t.id, ta.driver_id, v.latitude, v.longitude, v.speed_kph, v.heading, v.accuracy_m,
       now() - make_interval(mins => v.minutes_ago)
from public.trips t
join public.trip_assignments ta on ta.trip_id = t.id
cross join (values
  (16::integer, 9.7976::numeric, 118.7381::numeric, 45.0::numeric, 40.0::numeric, 10.0::numeric),
  (9::integer,  9.8268::numeric, 118.7519::numeric, 52.0::numeric, 42.0::numeric,  9.0::numeric),
  (2::integer,  9.8560::numeric, 118.7657::numeric, 58.0::numeric, 41.0::numeric,  8.0::numeric)
) as v(minutes_ago, latitude, longitude, speed_kph, heading, accuracy_m)
where t.id = (select trip_id from seed_extra_trips where label = 'LIVE');

-- ---------------------------------------------------------------------------
-- Wallet activity
--
-- `wallets` rows already exist — `profiles_create_wallet` made one for every
-- seeded account when the profile was inserted above. `wallet_post` is the
-- same internal function `top_up_wallet` calls; it moves the balance and
-- writes the ledger entry together, so calling it here keeps the invariant
-- (`sum(amount) = balance`) true without re-deriving it by hand.
-- ---------------------------------------------------------------------------

select public.wallet_post(
  (select id from public.wallets where user_id = (select id from auth.users where email = 'passenger@palago.test')),
  'TOP_UP', 20000, null, 'Wallet top-up', null, null, null
);

-- passenger2 gets the larger top-up: Booking 6 below pays a Trip D booking
-- from this wallet after a reward discount, and needs the headroom.
select public.wallet_post(
  (select id from public.wallets where user_id = (select id from auth.users where email = 'passenger2@palago.test')),
  'TOP_UP', 100000, null, 'Wallet top-up', null, null, null
);

select public.wallet_post(
  (select id from public.wallets where user_id = (select id from auth.users where email = 'passenger@palago.test')),
  'ADJUSTMENT', 1000, null, 'Customer support credit', null, null, null
);

-- ---------------------------------------------------------------------------
-- Booking 1: Trip A (Cherry, Puerto Princesa to El Nido), paid by QR.
--
-- Mirrors `reserve_seats` + `create_test_payment` + `confirm_test_payment`
-- exactly, except the first two are plain inserts rather than RPC calls —
-- those functions read `auth.uid()`, which has no meaning for a script with
-- no session. `confirm_test_payment` reads the payment by reference and
-- token instead (it is what the public, session-less payment page calls), so
-- it runs here unmodified and produces a real receipt, ledger entry, audit
-- row and notification.
-- ---------------------------------------------------------------------------

with target_trip as (
  select id as trip_id, bus_id, fare from public.trips where trip_number like 'CHERRY-%-A'
),
target_seat as (
  select bs.id as seat_id from public.bus_seats bs, target_trip
  where bs.bus_id = target_trip.bus_id and bs.seat_number = '2A'
),
new_booking as (
  insert into public.bookings (user_id, trip_id, status, subtotal, discount, loyalty_discount, total_amount, expires_at)
  select
    (select id from auth.users where email = 'passenger@palago.test'),
    target_trip.trip_id, 'PAYMENT_PENDING', target_trip.fare, 0, 0, target_trip.fare, now() + interval '10 minutes'
  from target_trip
  returning id, trip_id, user_id, total_amount, expires_at
),
new_passenger as (
  insert into public.booking_passengers (booking_id, user_id, seat_id, passenger_name, phone, passenger_type)
  select new_booking.id, new_booking.user_id, target_seat.seat_id, 'Juan Dela Cruz', '09171234567', 'ADULT'
  from new_booking, target_seat
  returning booking_id
)
update public.trip_seats ts
   set status = 'HELD', booking_id = new_booking.id, held_by = new_booking.user_id, held_until = new_booking.expires_at
  from new_booking, target_seat, new_passenger
 where ts.trip_id = new_booking.trip_id and ts.seat_id = target_seat.seat_id;

insert into public.payments (booking_id, amount, currency, status, expires_at)
select b.id, b.total_amount, 'PHP', 'PENDING', b.expires_at
from public.bookings b
join public.trips t on t.id = b.trip_id
where t.trip_number like 'CHERRY-%-A' and b.status = 'PAYMENT_PENDING';

-- confirm_test_payment runs as its own statement, not chained onto the
-- booking/hold/payment statement above: its internal trip_seats update
-- matches by `booking_id`, a value the hold above set moments earlier in the
-- same statement would silently see as still null (see the note on
-- Booking 3) — a fresh statement gives it a correct, fully-committed view.
select public.confirm_test_payment(p.reference, p.token, null)
from public.payments p
join public.bookings b on b.id = p.booking_id
join public.trips t on t.id = b.trip_id
where t.trip_number like 'CHERRY-%-A' and p.status = 'PENDING';

-- ---------------------------------------------------------------------------
-- Booking 2: Trip B (Cherry, Puerto Princesa to El Nido) — seats held and a
-- QR payment created, but never paid. The "awaiting payment" state a
-- passenger sees between reserving seats and deciding to pay.
-- ---------------------------------------------------------------------------

with target_trip as (
  select id as trip_id, bus_id, fare from public.trips where trip_number like 'CHERRY-%-B'
),
target_seat as (
  select bs.id as seat_id from public.bus_seats bs, target_trip
  where bs.bus_id = target_trip.bus_id and bs.seat_number = '2A'
),
new_booking as (
  insert into public.bookings (user_id, trip_id, status, subtotal, discount, loyalty_discount, total_amount, expires_at)
  select
    (select id from auth.users where email = 'passenger2@palago.test'),
    target_trip.trip_id, 'PAYMENT_PENDING', target_trip.fare, 0, 0, target_trip.fare, now() + interval '10 minutes'
  from target_trip
  returning id, trip_id, user_id, total_amount, expires_at
),
new_passenger as (
  insert into public.booking_passengers (booking_id, user_id, seat_id, passenger_name, phone, passenger_type)
  select new_booking.id, new_booking.user_id, target_seat.seat_id, 'Ana Villanueva', '09175556666', 'ADULT'
  from new_booking, target_seat
  returning booking_id
),
hold_seat as (
  update public.trip_seats ts
     set status = 'HELD', booking_id = new_booking.id, held_by = new_booking.user_id, held_until = new_booking.expires_at
    from new_booking, target_seat
   where ts.trip_id = new_booking.trip_id and ts.seat_id = target_seat.seat_id
  returning ts.trip_id
),
new_payment as (
  insert into public.payments (booking_id, amount, currency, status, expires_at)
  select new_booking.id, new_booking.total_amount, 'PHP', 'PENDING', new_booking.expires_at
  from new_booking
  returning id, reference, amount
),
log_txn as (
  insert into public.payment_transactions (payment_id, type, amount, status, reference)
  select new_payment.id, 'CREATED', new_payment.amount, 'PENDING', new_payment.reference
  from new_payment
  returning payment_id
)
insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
select
  new_booking.user_id, 'PAYMENT_CREATED', 'payment', new_payment.id,
  jsonb_build_object('bookingId', new_booking.id, 'amount', new_payment.amount, 'provider', 'MOCK')
from new_booking, new_payment, log_txn;

-- ---------------------------------------------------------------------------
-- Booking 3: Trip C (Cherry, El Nido to Puerto Princesa) — reserved, then
-- cancelled before payment. `cancel_booking`'s own precondition (status
-- PENDING/PAYMENT_PENDING) is exactly this state.
-- ---------------------------------------------------------------------------

-- Postgres note: every multi-CTE statement below writes each table at most
-- once. A second CTE re-updating a row an earlier CTE in the *same*
-- statement already touched is documented as unspecified — it silently
-- matched zero rows when tried here — so any second write to the same table
-- (the cancellation itself, then releasing the seat) is its own statement.

with target_trip as (
  select id as trip_id, bus_id, fare from public.trips where trip_number like 'CHERRY-%-C'
),
target_seat as (
  select bs.id as seat_id from public.bus_seats bs, target_trip
  where bs.bus_id = target_trip.bus_id and bs.seat_number = '2A'
),
new_booking as (
  insert into public.bookings (user_id, trip_id, status, subtotal, discount, loyalty_discount, total_amount, expires_at)
  select
    (select id from auth.users where email = 'passenger2@palago.test'),
    target_trip.trip_id, 'PAYMENT_PENDING', target_trip.fare, 0, 0, target_trip.fare, now() + interval '10 minutes'
  from target_trip
  returning id, trip_id, user_id
),
new_passenger as (
  insert into public.booking_passengers (booking_id, user_id, seat_id, passenger_name, phone, passenger_type)
  select new_booking.id, new_booking.user_id, target_seat.seat_id, 'Ana Villanueva', '09175556666', 'ADULT'
  from new_booking, target_seat
  returning booking_id
)
update public.trip_seats ts
   set status = 'HELD', booking_id = new_booking.id, held_by = new_booking.user_id, held_until = now() + interval '10 minutes'
  from new_booking, target_seat, new_passenger
 where ts.trip_id = new_booking.trip_id and ts.seat_id = target_seat.seat_id;

update public.bookings b
   set status = 'CANCELLED', cancelled_at = now()
  from public.trips t
 where b.trip_id = t.id
   and t.trip_number like 'CHERRY-%-C'
   and b.user_id = (select id from auth.users where email = 'passenger2@palago.test')
   and b.status = 'PAYMENT_PENDING';

update public.trip_seats ts
   set status = 'AVAILABLE', booking_id = null, held_by = null, held_until = null
  from public.bookings b
  join public.trips t on t.id = b.trip_id
 where ts.booking_id = b.id
   and t.trip_number like 'CHERRY-%-C'
   and b.status = 'CANCELLED';

-- ---------------------------------------------------------------------------
-- Booking 4: the RoRo Bus Puerto Princesa - Coron trip, paid by QR and then
-- refunded — a payment moving through its full PENDING -> PAID -> REFUNDED
-- life, with the wallet-credit branch skipped because this one was never
-- paid from a wallet (see `refund_test_payment`).
-- ---------------------------------------------------------------------------

with target_trip as (
  select id as trip_id, bus_id, fare from public.trips where trip_number like 'RORO-%-A'
),
target_seat as (
  select bs.id as seat_id from public.bus_seats bs, target_trip
  where bs.bus_id = target_trip.bus_id and bs.seat_number = '2A'
),
new_booking as (
  insert into public.bookings (user_id, trip_id, status, subtotal, discount, loyalty_discount, total_amount, expires_at)
  select
    (select id from auth.users where email = 'passenger@palago.test'),
    target_trip.trip_id, 'PAYMENT_PENDING', target_trip.fare, 0, 0, target_trip.fare, now() + interval '10 minutes'
  from target_trip
  returning id, trip_id, user_id, total_amount, expires_at
),
new_passenger as (
  insert into public.booking_passengers (booking_id, user_id, seat_id, passenger_name, phone, passenger_type)
  select new_booking.id, new_booking.user_id, target_seat.seat_id, 'Juan Dela Cruz', '09171234567', 'ADULT'
  from new_booking, target_seat
  returning booking_id
)
update public.trip_seats ts
   set status = 'HELD', booking_id = new_booking.id, held_by = new_booking.user_id, held_until = new_booking.expires_at
  from new_booking, target_seat, new_passenger
 where ts.trip_id = new_booking.trip_id and ts.seat_id = target_seat.seat_id;

insert into public.payments (booking_id, amount, currency, status, expires_at)
select b.id, b.total_amount, 'PHP', 'PENDING', b.expires_at
from public.bookings b
join public.trips t on t.id = b.trip_id
where t.trip_number like 'RORO-%-A' and b.status = 'PAYMENT_PENDING';

-- Its own statement for the same reason as Booking 1's — see the note there.
select public.confirm_test_payment(p.reference, p.token, null)
from public.payments p
join public.bookings b on b.id = p.booking_id
join public.trips t on t.id = b.trip_id
where t.trip_number like 'RORO-%-A' and p.status = 'PENDING';

with target as (
  select b.id as booking_id, b.booking_reference, b.user_id, p.id as payment_id,
         p.reference as payment_reference, p.amount
  from public.bookings b
  join public.trips t on t.id = b.trip_id
  join public.payments p on p.booking_id = b.id and p.status = 'PAID'
  where t.trip_number like 'RORO-%-A'
),
refund_payment as (
  update public.payments set status = 'REFUNDED', refunded_at = now()
   where id = (select payment_id from target)
  returning id
),
refund_booking as (
  update public.bookings set status = 'REFUNDED', cancelled_at = now()
    from refund_payment
   where public.bookings.id = (select booking_id from target)
  returning public.bookings.id
),
release_seat as (
  update public.trip_seats
     set status = 'AVAILABLE', booking_id = null, held_by = null, held_until = null, confirmed_at = null
    from refund_booking
   where booking_id = (select booking_id from target)
  returning trip_id
),
log_txn as (
  insert into public.payment_transactions (payment_id, type, amount, status, reference, metadata)
  select target.payment_id, 'REFUNDED', target.amount, 'REFUNDED', target.payment_reference,
    jsonb_build_object('provider', 'MOCK', 'toWallet', false, 'pointsReturned', 0, 'note', 'Test refund - no funds moved')
  from target, release_seat
  returning payment_id
),
log_audit as (
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  select target.user_id, 'TEST_PAYMENT_REFUNDED', 'payment', target.payment_id,
    jsonb_build_object('bookingId', target.booking_id, 'amount', target.amount, 'toWallet', false, 'pointsReturned', 0)
  from target, log_txn
  returning id
)
insert into public.notifications (user_id, type, title, message, data)
select
  target.user_id, 'SYSTEM', 'Booking refunded',
  'Your booking ' || target.booking_reference || ' has been refunded.',
  jsonb_build_object('bookingId', target.booking_id, 'toWallet', false, 'pointsReturned', 0)
from target, log_audit;

-- ---------------------------------------------------------------------------
-- Booking 5: the completed historical trip (Trip Z). Paid by QR, boarded,
-- and carried through to the trip's end — the one status a booking can only
-- reach by actually being travelled, which is why loyalty points are awarded
-- here through the real `award_loyalty_for_booking` function rather than by
-- hand: it re-derives the points from what was actually paid, exactly as
-- `end_trip` would when a driver ends the trip for real.
-- ---------------------------------------------------------------------------

with target_trip as (
  select id as trip_id, bus_id, fare from public.trips
  where id = (select trip_id from seed_extra_trips where label = 'HISTORICAL')
),
target_seat as (
  select bs.id as seat_id from public.bus_seats bs, target_trip
  where bs.bus_id = target_trip.bus_id and bs.seat_number = '2A'
),
new_booking as (
  insert into public.bookings (user_id, trip_id, status, subtotal, discount, loyalty_discount, total_amount, expires_at)
  select
    (select id from auth.users where email = 'passenger2@palago.test'),
    target_trip.trip_id, 'PAYMENT_PENDING', target_trip.fare, 0, 0, target_trip.fare, now() + interval '10 minutes'
  from target_trip
  returning id, trip_id, user_id, total_amount, expires_at
),
new_passenger as (
  insert into public.booking_passengers (booking_id, user_id, seat_id, passenger_name, phone, passenger_type)
  select new_booking.id, new_booking.user_id, target_seat.seat_id, 'Ana Villanueva', '09175556666', 'ADULT'
  from new_booking, target_seat
  returning booking_id
)
update public.trip_seats ts
   set status = 'HELD', booking_id = new_booking.id, held_by = new_booking.user_id, held_until = new_booking.expires_at
  from new_booking, target_seat, new_passenger
 where ts.trip_id = new_booking.trip_id and ts.seat_id = target_seat.seat_id;

insert into public.payments (booking_id, amount, currency, status, expires_at)
select b.id, b.total_amount, 'PHP', 'PENDING', b.expires_at
from public.bookings b
where b.trip_id = (select trip_id from seed_extra_trips where label = 'HISTORICAL')
  and b.status = 'PAYMENT_PENDING';

-- Its own statement for the same reason as Booking 1's — see the note there.
select public.confirm_test_payment(p.reference, p.token, null)
from public.payments p
join public.bookings b on b.id = p.booking_id
where b.trip_id = (select trip_id from seed_extra_trips where label = 'HISTORICAL')
  and p.status = 'PENDING';

with ctx as (
  select b.id as booking_id, b.booking_reference, b.user_id, b.trip_id, t.actual_departure_at
  from public.bookings b
  join public.trips t on t.id = b.trip_id
  where t.id = (select trip_id from seed_extra_trips where label = 'HISTORICAL')
    and b.user_id = (select id from auth.users where email = 'passenger2@palago.test')
),
scanner as (
  select id as scanner_id from auth.users where email = 'assistant@palago.test'
),
board as (
  update public.bookings b
     set status = 'BOARDED', checked_in_at = ctx.actual_departure_at, boarded_at = ctx.actual_departure_at
    from ctx
   where b.id = ctx.booking_id
  returning b.id
),
scan_validate as (
  insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
  select ctx.booking_id, scanner.scanner_id, ctx.trip_id, 'VALIDATION', 'VALID'
  from ctx, scanner, board
  returning id
),
scan_board as (
  insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
  select ctx.booking_id, scanner.scanner_id, ctx.trip_id, 'BOARDING', 'VALID'
  from ctx, scanner, board
  returning id
),
-- The assistant scans the same boarding pass again by accident. The status
-- transition itself is what refuses the second boarding — see
-- docs and 20260909000011_boarding.sql — this row is that refusal's evidence.
scan_repeat as (
  insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
  select ctx.booking_id, scanner.scanner_id, ctx.trip_id, 'BOARDING', 'ALREADY_BOARDED'
  from ctx, scanner, board
  returning id
),
log_audit as (
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  select scanner.scanner_id, 'BOARDING_CONFIRMED', 'booking', ctx.booking_id,
    jsonb_build_object('bookingReference', ctx.booking_reference, 'tripId', ctx.trip_id)
  from ctx, scanner, board
  returning id
)
insert into public.notifications (user_id, type, title, message, data)
select ctx.user_id, 'BOARDING', 'You have boarded',
  'Boarding confirmed for ' || ctx.booking_reference || '. Have a safe trip.',
  jsonb_build_object('bookingId', ctx.booking_id)
from ctx, board;

-- A second write to `bookings` in the same statement as `board` above would
-- silently match zero rows (see the note by Booking 3), so completing the
-- trip is its own statement, and the loyalty award — which re-reads the
-- booking's own status and paid amount — runs only once that has committed.
update public.bookings b
   set status = 'COMPLETED'
  from public.trips t
 where b.trip_id = t.id
   and t.id = (select trip_id from seed_extra_trips where label = 'HISTORICAL')
   and b.user_id = (select id from auth.users where email = 'passenger2@palago.test')
   and b.status = 'BOARDED';

select public.award_loyalty_for_booking(b.id)
  from public.bookings b
  join public.trips t on t.id = b.trip_id
 where t.id = (select trip_id from seed_extra_trips where label = 'HISTORICAL')
   and b.user_id = (select id from auth.users where email = 'passenger2@palago.test');

-- Something scanned at the Cherry Bus gate that was not one of ours —
-- `validate_booking_qr` logs exactly this shape when the reference does not
-- match any booking: no booking id, no trip id, just the refusal.
insert into public.qr_scans (operator_user_id, scan_type, result)
select id, 'VALIDATION', 'INVALID_QR' from auth.users where email = 'operator@palago.test';

-- ---------------------------------------------------------------------------
-- One closed emergency alert, on the trip that has already finished.
--
-- Inserted directly rather than through `trigger_sos`, because that function
-- reads `auth.uid()` and this script has no session — the same reason the
-- bookings above are built by hand. The row is the exact shape the function
-- leaves behind once an operator has worked it through to RESOLVED.
--
-- Deliberately *closed*: an alert left ACTIVE in seed data would show every
-- developer a standing emergency on the operator dashboard that no one is
-- attending to.
-- ---------------------------------------------------------------------------

insert into public.sos_incidents (
  user_id, booking_id, trip_id, latitude, longitude, status, note,
  created_at, acknowledged_at, acknowledged_by, responding_at, resolved_at, resolved_by
)
select
  b.user_id,
  b.id,
  b.trip_id,
  10.345700, 118.997800,
  'RESOLVED',
  'Passenger felt unwell. Crew stopped at Roxas; passenger continued after a rest.',
  t.actual_departure_at + interval '135 minutes',
  t.actual_departure_at + interval '138 minutes',
  (select id from auth.users where email = 'operator@palago.test'),
  t.actual_departure_at + interval '141 minutes',
  t.actual_departure_at + interval '190 minutes',
  (select id from auth.users where email = 'operator@palago.test')
from public.bookings b
join public.trips t on t.id = b.trip_id
where t.id = (select trip_id from seed_extra_trips where label = 'HISTORICAL')
  and b.user_id = (select id from auth.users where email = 'passenger2@palago.test');

-- ---------------------------------------------------------------------------
-- Booking 6: Trip D (Cherry, Puerto Princesa to Roxas), two seats, a
-- redeemed reward and payment from the wallet. The redemption needs points,
-- which is why this runs after Booking 5 above has already credited some.
-- ---------------------------------------------------------------------------

with target_trip as (
  select id as trip_id, bus_id, fare from public.trips where trip_number like 'CHERRY-%-D'
),
seat1 as (
  select bs.id as seat_id from public.bus_seats bs, target_trip
  where bs.bus_id = target_trip.bus_id and bs.seat_number = '2A'
),
seat2 as (
  select bs.id as seat_id from public.bus_seats bs, target_trip
  where bs.bus_id = target_trip.bus_id and bs.seat_number = '2B'
),
new_booking as (
  insert into public.bookings (user_id, trip_id, status, subtotal, discount, loyalty_discount, total_amount, expires_at)
  select
    (select id from auth.users where email = 'passenger2@palago.test'),
    target_trip.trip_id, 'PAYMENT_PENDING', target_trip.fare * 2, 0, 0, target_trip.fare * 2, now() + interval '10 minutes'
  from target_trip
  returning id, trip_id, user_id, expires_at
),
both_seats as (
  select seat_id from seat1 union all select seat_id from seat2
),
new_passengers as (
  insert into public.booking_passengers (booking_id, user_id, seat_id, passenger_name, phone, passenger_type)
  select new_booking.id, new_booking.user_id, both_seats.seat_id, 'Ana Villanueva', '09175556666', 'ADULT'
  from new_booking, both_seats
  returning booking_id
)
update public.trip_seats ts
   set status = 'HELD', booking_id = new_booking.id, held_by = new_booking.user_id, held_until = new_booking.expires_at
  from new_booking, both_seats
 where ts.trip_id = new_booking.trip_id and ts.seat_id = both_seats.seat_id;

with target as (
  select b.id as booking_id, b.booking_reference, b.user_id, b.subtotal, b.discount
  from public.bookings b
  join public.trips t on t.id = b.trip_id
  where t.trip_number like 'CHERRY-%-D'
),
reward as (
  select id as reward_id, name, points_required, discount_value from public.rewards where code = 'FIFTY_OFF'
),
spend_points as (
  select public.loyalty_post(
    target.user_id, 'REDEEMED', -reward.points_required, target.booking_reference,
    reward.name || ' on booking ' || target.booking_reference, target.booking_id
  ) as txn
  from target, reward
),
new_redemption as (
  insert into public.reward_redemptions (user_id, reward_id, booking_id, points_used, discount_applied)
  select target.user_id, reward.reward_id, target.booking_id, reward.points_required, reward.discount_value
  from target, reward, spend_points
  returning id
)
update public.bookings b
   set loyalty_discount = reward.discount_value,
       total_amount = target.subtotal - target.discount - reward.discount_value
  from target, reward, new_redemption
 where b.id = target.booking_id;

with target as (
  select b.id as booking_id, b.booking_reference, b.user_id, b.trip_id, b.total_amount, b.currency
  from public.bookings b
  join public.trips t on t.id = b.trip_id
  where t.trip_number like 'CHERRY-%-D'
),
wallet as (
  select id as wallet_id from public.wallets where user_id = (select user_id from target)
),
new_payment as (
  insert into public.payments (booking_id, provider, amount, currency, status, paid_at)
  select target.booking_id, 'MOCK', target.total_amount, target.currency, 'PAID', now()
  from target
  returning id, reference, amount
),
new_receipt as (
  insert into public.receipts (payment_id, booking_id, amount, currency, payment_method, status)
  select new_payment.id, target.booking_id, new_payment.amount, target.currency, 'PalaGo Wallet', 'PAID'
  from new_payment, target
  returning id, receipt_number, payment_id
),
-- Stamping the receipt number back onto `payments` happens in its own
-- statement further down: a second write to a row `new_payment` already
-- inserted, in the same WITH, would silently match zero rows (see the note
-- on Booking 3).
charge_wallet as (
  select public.wallet_post(
    wallet.wallet_id, 'BOOKING_PAYMENT', -target.total_amount, target.booking_reference,
    'Booking ' || target.booking_reference, target.booking_id, new_payment.id, null
  ) as txn
  from target, wallet, new_payment, new_receipt
),
confirm_booking as (
  update public.bookings b
     set status = 'CONFIRMED', confirmed_at = now(), expires_at = null
    from charge_wallet
   where b.id = (select booking_id from target)
  returning b.id
),
-- mark_seats touches two rows (Trip D is a two-seat booking): joining a
-- later CTE straight to it would cross the result with every seat and
-- duplicate every insert from here on. An EXISTS check keeps the ordering
-- dependency without multiplying rows.
mark_seats as (
  update public.trip_seats ts
     set status = 'BOOKED', confirmed_at = now(), held_until = null
    from confirm_booking
   where ts.booking_id = confirm_booking.id
  returning ts.id
),
log_txn as (
  insert into public.payment_transactions (payment_id, type, amount, status, reference, metadata)
  select new_payment.id, 'PAID', new_payment.amount, 'PAID', new_receipt.receipt_number,
    jsonb_build_object('provider', 'MOCK', 'method', 'WALLET', 'note', 'Test payment from mock wallet - no funds moved')
  from new_payment, new_receipt
  where exists (select 1 from mark_seats)
  returning payment_id
),
log_audit as (
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  select target.user_id, 'WALLET_BOOKING_PAID', 'payment', new_payment.id,
    jsonb_build_object('bookingId', target.booking_id, 'bookingReference', target.booking_reference,
                       'receiptNumber', new_receipt.receipt_number, 'amount', new_payment.amount)
  from target, new_payment, new_receipt
  where exists (select 1 from log_txn)
  returning id
)
insert into public.notifications (user_id, type, title, message, data)
select target.user_id, 'PAYMENT_CONFIRMED', 'Paid from your wallet',
  'Booking ' || target.booking_reference || ' is confirmed.',
  jsonb_build_object('bookingId', target.booking_id, 'bookingReference', target.booking_reference,
                     'receiptNumber', new_receipt.receipt_number)
from target, new_payment, new_receipt
where exists (select 1 from log_audit);

update public.payments p
   set receipt_number = r.receipt_number
  from public.receipts r
 where r.payment_id = p.id
   and p.receipt_number is null
   and r.booking_id in (
     select b.id from public.bookings b
     join public.trips t on t.id = b.trip_id
     where t.trip_number like 'CHERRY-%-D'
   );

-- ---------------------------------------------------------------------------
-- Booking 7: the trip currently under way (Trip Y). Paid, boarded, and moved
-- to ON_TRIP the way `start_trip` moves every already-boarded passenger the
-- moment the bus actually leaves — the live map and the driver's manifest
-- have someone to show.
-- ---------------------------------------------------------------------------

with target_trip as (
  select id as trip_id, bus_id, fare from public.trips
  where id = (select trip_id from seed_extra_trips where label = 'LIVE')
),
target_seat as (
  select bs.id as seat_id from public.bus_seats bs, target_trip
  where bs.bus_id = target_trip.bus_id and bs.seat_number = '3A'
),
new_booking as (
  insert into public.bookings (user_id, trip_id, status, subtotal, discount, loyalty_discount, total_amount, expires_at)
  select
    (select id from auth.users where email = 'passenger2@palago.test'),
    target_trip.trip_id, 'PAYMENT_PENDING', target_trip.fare, 0, 0, target_trip.fare, now() + interval '10 minutes'
  from target_trip
  returning id, trip_id, user_id, total_amount, expires_at
),
new_passenger as (
  insert into public.booking_passengers (booking_id, user_id, seat_id, passenger_name, phone, passenger_type)
  select new_booking.id, new_booking.user_id, target_seat.seat_id, 'Ana Villanueva', '09175556666', 'ADULT'
  from new_booking, target_seat
  returning booking_id
)
update public.trip_seats ts
   set status = 'HELD', booking_id = new_booking.id, held_by = new_booking.user_id, held_until = new_booking.expires_at
  from new_booking, target_seat, new_passenger
 where ts.trip_id = new_booking.trip_id and ts.seat_id = target_seat.seat_id;

insert into public.payments (booking_id, amount, currency, status, expires_at)
select b.id, b.total_amount, 'PHP', 'PENDING', b.expires_at
from public.bookings b
where b.trip_id = (select trip_id from seed_extra_trips where label = 'LIVE')
  and b.status = 'PAYMENT_PENDING';

-- Its own statement for the same reason as Booking 1's — see the note there.
select public.confirm_test_payment(p.reference, p.token, null)
from public.payments p
join public.bookings b on b.id = p.booking_id
where b.trip_id = (select trip_id from seed_extra_trips where label = 'LIVE')
  and p.status = 'PENDING';

with ctx as (
  select b.id as booking_id, b.booking_reference, b.user_id, b.trip_id
  from public.bookings b
  where b.trip_id = (select trip_id from seed_extra_trips where label = 'LIVE')
    and b.user_id = (select id from auth.users where email = 'passenger2@palago.test')
),
scanner as (
  select id as scanner_id from auth.users where email = 'assistant@palago.test'
),
board as (
  update public.bookings
     set status = 'BOARDED', checked_in_at = now() - interval '17 minutes', boarded_at = now() - interval '17 minutes'
   where id = (select booking_id from ctx)
  returning id
),
scan_validate as (
  insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
  select ctx.booking_id, scanner.scanner_id, ctx.trip_id, 'VALIDATION', 'VALID'
  from ctx, scanner, board
  returning id
),
scan_board as (
  insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
  select ctx.booking_id, scanner.scanner_id, ctx.trip_id, 'BOARDING', 'VALID'
  from ctx, scanner, board
  returning id
)
insert into public.notifications (user_id, type, title, message, data)
select ctx.user_id, 'BOARDING', 'You have boarded',
  'Boarding confirmed for ' || ctx.booking_reference || '. Have a safe trip.',
  jsonb_build_object('bookingId', ctx.booking_id)
from ctx, board;

-- A second write to `bookings` in the same statement as `board` above would
-- silently match zero rows (see the note on Booking 3), so moving the
-- now-boarded passenger to ON_TRIP — what `start_trip` does the moment the
-- bus actually leaves — is its own statement.
update public.bookings b
   set status = 'ON_TRIP'
  from public.trips t
 where b.trip_id = t.id
   and t.id = (select trip_id from seed_extra_trips where label = 'LIVE')
   and b.user_id = (select id from auth.users where email = 'passenger2@palago.test')
   and b.status = 'BOARDED';

commit;
