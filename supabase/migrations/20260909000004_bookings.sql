-- Phase 4a: bookings and their passengers.

create type public.booking_status as enum (
  'PENDING', 'PAYMENT_PENDING', 'CONFIRMED', 'CHECKED_IN', 'BOARDED',
  'ON_TRIP', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'NO_SHOW'
);

create type public.passenger_type as enum ('ADULT', 'CHILD', 'SENIOR', 'STUDENT', 'PWD');

-- ---------------------------------------------------------------------------
-- Human-readable references
--
-- A sequence, not a count of existing rows: two concurrent bookings counting
-- rows would both compute the same number. The sequence is global rather than
-- per-year — the digits only need to be unique, and resetting a sequence
-- annually is a scheduled job waiting to be forgotten.
-- ---------------------------------------------------------------------------

create sequence public.booking_reference_seq start 1;

create or replace function public.next_booking_reference()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'PG-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('public.booking_reference_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- Bookings
--
-- Money is integer CENTAVOS throughout. Totals are computed server-side in
-- `reserve_seats` from the trip's own fare — a client-supplied price is never
-- accepted, which is why there is no client INSERT policy on this table.
-- ---------------------------------------------------------------------------

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete restrict,
  booking_reference text not null unique default public.next_booking_reference(),
  status public.booking_status not null default 'PENDING',
  subtotal integer not null,
  discount integer not null default 0,
  loyalty_discount integer not null default 0,
  total_amount integer not null,
  currency text not null default 'PHP',
  expires_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_amounts_non_negative
    check (subtotal >= 0 and discount >= 0 and loyalty_discount >= 0 and total_amount >= 0),
  -- The arithmetic is checked by the database, not merely by the code that
  -- writes it, so a future bug cannot persist a total that does not add up.
  constraint bookings_total_adds_up
    check (total_amount = subtotal - discount - loyalty_discount)
);

comment on column public.bookings.subtotal is 'Fare x passengers, in centavos.';
comment on column public.bookings.total_amount is 'subtotal - discount - loyalty_discount, in centavos.';

create index bookings_user_id_idx on public.bookings (user_id);
create index bookings_trip_id_idx on public.bookings (trip_id);
create index bookings_status_idx on public.bookings (status);
create index bookings_reference_idx on public.bookings (booking_reference);
-- The expiry sweep looks for unpaid bookings past their deadline.
create index bookings_expires_at_idx on public.bookings (expires_at)
  where status in ('PENDING', 'PAYMENT_PENDING');

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- Deferred from Phase 3: `trip_seats` was created before `bookings` existed.
alter table public.trip_seats
  add constraint trip_seats_booking_id_fkey
  foreign key (booking_id) references public.bookings (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Passengers
--
-- `seat_id` points at the physical seat. One passenger per seat per booking.
-- ---------------------------------------------------------------------------

create table public.booking_passengers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  seat_id uuid not null references public.bus_seats (id) on delete restrict,
  passenger_name text not null,
  phone text,
  email text,
  passenger_type public.passenger_type not null default 'ADULT',
  created_at timestamptz not null default now(),
  constraint booking_passengers_seat_unique unique (booking_id, seat_id),
  constraint booking_passengers_name_present check (length(trim(passenger_name)) > 0)
);

create index booking_passengers_booking_id_idx on public.booking_passengers (booking_id);
create index booking_passengers_seat_id_idx on public.booking_passengers (seat_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Read-only from the client. Bookings are created, confirmed and cancelled by
-- SECURITY DEFINER functions, so there is no INSERT, UPDATE or DELETE policy
-- and those privileges are revoked outright. A client that could INSERT a
-- booking could set its own total; one that could UPDATE could mark itself
-- CONFIRMED without paying.
-- ---------------------------------------------------------------------------

alter table public.bookings enable row level security;
alter table public.booking_passengers enable row level security;

create policy "Users read their own bookings"
  on public.bookings for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin()
    -- Operators need the manifest for their own trips.
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and t.operator_id = public.current_operator_id()
    )
  );

create policy "Users read their own booking passengers"
  on public.booking_passengers for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and (
          b.user_id = (select auth.uid())
          or public.is_admin()
          or exists (
            select 1 from public.trips t
            where t.id = b.trip_id and t.operator_id = public.current_operator_id()
          )
        )
    )
  );

revoke insert, update, delete on public.bookings from anon, authenticated;
revoke insert, update, delete on public.booking_passengers from anon, authenticated;
