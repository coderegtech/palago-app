-- ---------------------------------------------------------------------------
-- A ₱10 convenience fee on every booking, and ID photos per passenger.
--
-- 1. THE FEE. Every booking carries `convenience_fee` — ₱10.00, always: not
--    scaled by the fare, not reduced by any discount or reward, and charged on
--    counter sales as on app bookings ("every booking"). It is its own column,
--    on the booking, the payment and the receipt, rather than folded into the
--    fare, so a report can tell fares from fees and a receipt can show both.
--    The total is now
--
--      total = subtotal − discount − loyalty_discount + convenience_fee
--
--    and `bookings_total_adds_up` says so, so no code path can persist a total
--    that forgets it. Rewards still cannot exceed the fare, so the fee is
--    always payable. Loyalty points stay on the fare: floor((paid − fee) / ₱100).
--    Bookings made before this migration have a fee of 0 and are unchanged.
--
-- 2. ID PHOTOS PER PASSENGER. Until now a senior/student/PWD discount came only
--    from the BOOKER's approved account eligibility, which cannot cover someone
--    booking for another person. Decided with the product owner: a passenger
--    line whose type is SENIOR, STUDENT or PWD and which carries an uploaded ID
--    photo is discounted at booking, and the photo is checked against the real
--    card at the door — the scan now says "Check ID" and the crew can open the
--    photo. That relaxes the rule "a claimed passenger type is not a discount"
--    from "only after review" to "only with a photo, checked at boarding", and
--    it is recorded as such in AGENTS.md and the deviations log.
--
--    What keeps it honest:
--      * The photo must already be in the private `passenger-proofs` bucket,
--        in the CALLER's own folder, uploaded by the caller, as an image of at
--        most 5 MB. A path to someone else's file, to a missing file, or to a
--        non-image is refused outright — not silently priced at full fare,
--        because the booker would then pay more than the screen said.
--      * The path is stored on the passenger line, so the document belongs to
--        that passenger on that booking.
--      * Only the uploader, the booking's owner, the crew who can scan that
--        trip, its operator's managers and admins can read the photo. It is a
--        government ID.
--      * The account-approved path still works exactly as before, for one line.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. The fee
-- ===========================================================================

create or replace function public.convenience_fee()
returns integer
language sql
immutable
set search_path = ''
as $$ select 1000 $$;

comment on function public.convenience_fee() is
  'The convenience fee on every booking, in centavos: ₱10.00. Fixed — not affected by fare, passenger type, discount or reward.';

alter table public.bookings
  add column convenience_fee integer not null default 0
    constraint bookings_fee_not_negative check (convenience_fee >= 0);

comment on column public.bookings.convenience_fee is
  'Fixed convenience fee in centavos, set by create_booking (₱10.00). Never discounted. 0 on bookings made before 20260921000042.';

alter table public.bookings drop constraint bookings_total_adds_up;
alter table public.bookings add constraint bookings_total_adds_up
  check (total_amount = subtotal - discount - loyalty_discount + convenience_fee);

alter table public.payments
  add column convenience_fee integer not null default 0
    constraint payments_fee_not_negative check (convenience_fee >= 0);
alter table public.receipts
  add column convenience_fee integer not null default 0
    constraint receipts_fee_not_negative check (convenience_fee >= 0);

comment on column public.payments.convenience_fee is
  'The part of `amount` that is the convenience fee, copied from the booking when the payment is created.';
comment on column public.receipts.convenience_fee is
  'The part of `amount` that is the convenience fee, copied from the payment when the receipt is issued.';

-- Copied by trigger rather than by each payment function: three functions
-- create payments today (mock provider, wallet, counter) and a real provider
-- would be a fourth. The same reasoning as the loyalty trigger in
-- 20260919000041 — whatever path writes the row, the fee is recorded.
create or replace function public.payments_copy_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.convenience_fee := coalesce(
    (select convenience_fee from public.bookings where id = new.booking_id), 0
  );
  return new;
end;
$$;

revoke all on function public.payments_copy_fee() from public, anon, authenticated;

create trigger payments_copy_fee
  before insert on public.payments
  for each row execute function public.payments_copy_fee();

create or replace function public.receipts_copy_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.convenience_fee := coalesce(
    (select convenience_fee from public.payments where id = new.payment_id), 0
  );
  return new;
end;
$$;

revoke all on function public.receipts_copy_fee() from public, anon, authenticated;

create trigger receipts_copy_fee
  before insert on public.receipts
  for each row execute function public.receipts_copy_fee();

-- ---------------------------------------------------------------------------
-- The functions that recompute a total must keep the fee in it. Patched from
-- their live definitions with anchored replacements, each asserted to have
-- applied exactly once — rewriting them from memory is how `reserve_seats` once
-- lost its deadlock guard (AGENTS.md).
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text;
  v_new text;

  procedure_patch constant text[][] := array[
    -- redeem_reward: the total after a reward.
    array['redeem_reward',
          'v_new_total := v_booking.subtotal - v_booking.discount - v_discount;',
          'v_new_total := v_booking.subtotal - v_booking.discount - v_discount + v_booking.convenience_fee;'],
    -- releasing a reward restores the total with the fee still in it.
    array['release_booking_redemption',
          'total_amount = v_booking.subtotal - v_booking.discount',
          'total_amount = v_booking.subtotal - v_booking.discount + v_booking.convenience_fee'],
    -- the public payment page shows the fee as its own line.
    array['get_public_payment',
          '''loyaltyDiscount'', b.loyalty_discount,',
          '''loyaltyDiscount'', b.loyalty_discount, ''convenienceFee'', b.convenience_fee,'],
    -- loyalty points are for the fare, not the fee.
    array['award_loyalty_for_booking',
          'v_points := public.loyalty_points_for(v_paid);',
          'v_points := public.loyalty_points_for(greatest(0, v_paid - v_booking.convenience_fee));']
  ];
  i int;
begin
  for i in 1 .. array_length(procedure_patch, 1) loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = procedure_patch[i][1];

    if v_def is null then
      raise exception 'patch: function % not found', procedure_patch[i][1];
    end if;

    if (length(v_def) - length(replace(v_def, procedure_patch[i][2], ''))) / length(procedure_patch[i][2]) <> 1 then
      raise exception 'patch: expected exactly one "%" in %', procedure_patch[i][2], procedure_patch[i][1];
    end if;

    v_new := replace(v_def, procedure_patch[i][2], procedure_patch[i][3]);
    execute v_new;
  end loop;
end;
$$;

-- ===========================================================================
-- 2. ID photos per passenger
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'passenger-proofs',
  'passenger-proofs',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

alter table public.booking_passengers add column proof_path text;

comment on column public.booking_passengers.proof_path is
  'Path in the private passenger-proofs bucket of the ID photo attached for this passenger. Present ⇒ the crew must check the real ID at boarding.';

-- Who may see a passenger's ID photo: whoever uploaded it (their own folder),
-- the booking's owner or creator, the crew who can scan the trip, the
-- operator's managers, and admins. SECURITY DEFINER so the storage policy can
-- ask without the caller being able to read the tables it consults.
create or replace function public.can_view_passenger_proof(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.booking_passengers bp
      join public.bookings b on b.id = bp.booking_id
      join public.trips t on t.id = b.trip_id
     where bp.proof_path = p_path
       and (
         b.user_id = public.active_uid()
         or b.created_by = public.active_uid()
         or public.can_scan_trip(b.trip_id)
         or coalesce(public.can_manage_operator(t.operator_id), false)
         or coalesce(public.is_admin(), false)
       )
  );
$$;

revoke all on function public.can_view_passenger_proof(text) from public, anon;
grant execute on function public.can_view_passenger_proof(text) to authenticated;

-- Upload only into your own folder. No update and no delete: a photo a
-- discount was granted against stays as it was.
create policy "Bookers upload passenger ID photos to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'passenger-proofs'
    and (storage.foldername(name))[1] = (select public.active_uid())::text
  );

create policy "Passenger ID photos are read by uploader, booking and crew"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'passenger-proofs'
    and (
      (storage.foldername(name))[1] = (select public.active_uid())::text
      or public.can_view_passenger_proof(name)
    )
  );

-- Checks a proof path the client supplied. Raises rather than returns false:
-- a booking must never be priced differently from what the screen promised.
create or replace function public.assert_passenger_proof(p_path text, p_uploader uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_obj record;
begin
  if p_path is null or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$' then
    raise exception 'VALIDATION_ERROR' using detail = 'The ID photo reference is not valid.';
  end if;

  if split_part(p_path, '/', 1) <> p_uploader::text then
    raise exception 'FORBIDDEN' using detail = 'That ID photo was not uploaded by you.';
  end if;

  select o.owner_id, o.metadata into v_obj
    from storage.objects o
   where o.bucket_id = 'passenger-proofs' and o.name = p_path;

  if not found then
    raise exception 'VALIDATION_ERROR' using detail = 'The ID photo was not found. Upload it again.';
  end if;

  if v_obj.owner_id is distinct from p_uploader::text then
    raise exception 'FORBIDDEN' using detail = 'That ID photo was not uploaded by you.';
  end if;

  if coalesce(v_obj.metadata ->> 'mimetype', '') not in ('image/jpeg', 'image/png', 'image/webp')
     or coalesce((v_obj.metadata ->> 'size')::bigint, 0) not between 1 and 5 * 1024 * 1024 then
    raise exception 'VALIDATION_ERROR' using detail = 'The ID photo must be a JPEG, PNG or WebP image of at most 5 MB.';
  end if;
end;
$$;

revoke all on function public.assert_passenger_proof(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_booking — the fee, and a discount per passenger with a photo.
--
-- From 20260915000032's definition. Changed: the passenger-proof block, the
-- per-line discount, and the fee in the total. Unchanged and load-bearing: the
-- staff gate on counter sales, the inactive-resource refusal, the lapsed-hold
-- reclaim, SKIP LOCKED allocation, ordered locking of chosen seats.
-- ---------------------------------------------------------------------------

create or replace function public.create_booking(
  p_trip_id uuid,
  p_passengers jsonb,
  p_seat_ids uuid[] default null,
  p_walk_in boolean default false,
  p_source public.booking_source default 'MOBILE_APP',
  p_ticket_type public.ticket_type default 'DIGITAL'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id       uuid := (select auth.uid());
  v_owner         uuid;
  v_is_staff      boolean;
  v_trip          public.trips%rowtype;
  v_seat_ids      uuid[];
  v_seat_count    integer;
  v_booking_id    uuid;
  v_reference     text;
  v_subtotal      integer;
  v_expires_at    timestamptz;
  v_kind          public.discount_kind;
  v_account_ord   bigint;
  v_line_discount integer;
  v_discount      integer := 0;
  v_fee           integer := public.convenience_fee();
  v_line          record;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if jsonb_typeof(p_passengers) <> 'array' or jsonb_array_length(p_passengers) = 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- A booking with no account holder, a chosen seat, or a counter source is a
  -- counter sale. Only staff may make one — otherwise anyone could create
  -- ownerless bookings that no passenger could be billed for or contacted about.
  if p_walk_in or p_seat_ids is not null
     or p_source <> 'MOBILE_APP' or p_ticket_type <> 'DIGITAL' then
    select public.can_manage_operator(t.operator_id) or coalesce(public.is_admin(), false)
      into v_is_staff
      from public.trips t
     where t.id = p_trip_id;

    if not coalesce(v_is_staff, false) then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  v_owner := case when p_walk_in then null else v_user_id end;

  v_seat_count := jsonb_array_length(p_passengers);

  if v_seat_count > 10 then
    raise exception 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_passengers) as p
    where coalesce(trim(p ->> 'name'), '') = ''
  ) then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- A photo only means something on a discounted type. Every photo given is
  -- checked before anything is held: the caller's own upload, present, an image.
  for v_line in
    select t.p ->> 'proofPath' as proof_path,
           coalesce(nullif(t.p ->> 'type', ''), 'ADULT') as ptype
      from jsonb_array_elements(p_passengers) as t(p)
     where nullif(t.p ->> 'proofPath', '') is not null
  loop
    if v_line.ptype not in ('SENIOR', 'STUDENT', 'PWD') then
      raise exception 'VALIDATION_ERROR'
        using detail = 'An ID photo is only for senior, student and PWD passengers.';
    end if;
    perform public.assert_passenger_proof(v_line.proof_path, v_user_id);
  end loop;

  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_trip.status not in ('SCHEDULED', 'BOARDING') then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not v_trip.is_active then
    raise exception 'INACTIVE_RESOURCE';
  end if;

  if not exists (
    select 1
      from public.operators o
      join public.routes r on r.id = v_trip.route_id
      join public.buses b on b.id = v_trip.bus_id
     where o.id = v_trip.operator_id
       and o.status = 'ACTIVE'
       and r.status = 'ACTIVE'
       and b.status = 'ACTIVE'
  ) then
    raise exception 'INACTIVE_RESOURCE';
  end if;

  update public.trip_seats
     set status = 'AVAILABLE', booking_id = null, held_by = null, held_until = null
   where trip_id = p_trip_id
     and status = 'HELD'
     and held_until < now();

  if p_seat_ids is null then
    select coalesce(array_agg(s.seat_id), '{}')
      into v_seat_ids
      from (
        select ts.seat_id
          from public.trip_seats ts
          join public.bus_seats bs on bs.id = ts.seat_id
         where ts.trip_id = p_trip_id
           and ts.status = 'AVAILABLE'
         order by bs.row_number, bs.column_number, bs.seat_number
         limit v_seat_count
         for update of ts skip locked
      ) s;

    if coalesce(array_length(v_seat_ids, 1), 0) <> v_seat_count then
      raise exception 'SEAT_UNAVAILABLE';
    end if;
  else
    v_seat_ids := p_seat_ids;

    if coalesce(array_length(v_seat_ids, 1), 0) <> v_seat_count
       or (select count(distinct s) from unnest(v_seat_ids) as s) <> v_seat_count then
      raise exception 'VALIDATION_ERROR';
    end if;

    perform 1
       from public.trip_seats
      where trip_id = p_trip_id
        and seat_id = any(v_seat_ids)
      order by seat_id
      for update;

    if (
      select count(*) from public.trip_seats
       where trip_id = p_trip_id and seat_id = any(v_seat_ids) and status = 'AVAILABLE'
    ) <> v_seat_count then
      raise exception 'SEAT_UNAVAILABLE';
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- Price, from the trip's own fare. Nothing about the amount comes from the
  -- caller.
  -- -------------------------------------------------------------------------
  v_subtotal      := v_trip.fare * v_seat_count;
  v_expires_at    := now() + interval '10 minutes';
  v_reference     := public.next_booking_reference();
  v_line_discount := round(v_trip.fare * public.discount_rate_bps() / 10000.0);

  -- The booker's own approved eligibility still discounts ONE line of their
  -- kind with no photo needed — unchanged from before. A walk-in has no account.
  v_kind := case when v_owner is null then null else public.active_discount_kind(v_owner) end;

  if v_kind is not null then
    select t.ord
      into v_account_ord
      from jsonb_array_elements(p_passengers) with ordinality as t(p, ord)
     where coalesce(nullif(t.p ->> 'type', ''), 'ADULT') = v_kind::text
       and nullif(t.p ->> 'proofPath', '') is null
     order by t.ord
     limit 1;
  end if;

  -- Discounted lines: the account-approved one, plus every line with a photo.
  select coalesce(count(*), 0) * v_line_discount
    into v_discount
    from jsonb_array_elements(p_passengers) with ordinality as t(p, ord)
   where t.ord = v_account_ord
      or nullif(t.p ->> 'proofPath', '') is not null;

  insert into public.bookings (
    user_id, created_by, source, ticket_type, trip_id, booking_reference, status,
    subtotal, discount, loyalty_discount, convenience_fee, total_amount, expires_at
  )
  values (
    v_owner, v_user_id, p_source, p_ticket_type, p_trip_id, v_reference, 'PAYMENT_PENDING',
    v_subtotal, v_discount, 0, v_fee, v_subtotal - v_discount + v_fee, v_expires_at
  )
  returning id into v_booking_id;

  insert into public.booking_passengers (
    booking_id, user_id, seat_id, passenger_name, phone, email, passenger_type,
    discount_amount, discount_kind, proof_path
  )
  select
    v_booking_id,
    v_owner,
    null,
    trim(t.p ->> 'name'),
    nullif(trim(coalesce(t.p ->> 'phone', '')), ''),
    nullif(trim(coalesce(t.p ->> 'email', '')), ''),
    coalesce(nullif(t.p ->> 'type', ''), 'ADULT')::public.passenger_type,
    case when t.ord = v_account_ord or nullif(t.p ->> 'proofPath', '') is not null
         then v_line_discount else 0 end,
    case when t.ord = v_account_ord then v_kind
         when nullif(t.p ->> 'proofPath', '') is not null
         then (t.p ->> 'type')::public.discount_kind
         else null end,
    nullif(t.p ->> 'proofPath', '')
  from jsonb_array_elements(p_passengers) with ordinality as t(p, ord);

  update public.trip_seats
     set status = 'HELD',
         booking_id = v_booking_id,
         held_by = v_user_id,
         held_until = v_expires_at
   where trip_id = p_trip_id
     and seat_id = any(v_seat_ids);

  return jsonb_build_object(
    'bookingId', v_booking_id,
    'reference', v_reference,
    'status', 'PAYMENT_PENDING',
    'subtotal', v_subtotal,
    'discount', v_discount,
    'discountKind', v_kind,
    'loyaltyDiscount', 0,
    'convenienceFee', v_fee,
    'totalAmount', v_subtotal - v_discount + v_fee,
    'currency', 'PHP',
    'seatCount', v_seat_count,
    'source', p_source,
    'ticketType', p_ticket_type,
    'seatsAssigned', false,
    'expiresAt', v_expires_at
  );
end;
$$;

revoke all on function public.create_booking(
  uuid, jsonb, uuid[], boolean, public.booking_source, public.ticket_type
) from public, anon;
grant execute on function public.create_booking(
  uuid, jsonb, uuid[], boolean, public.booking_source, public.ticket_type
) to authenticated;

-- ---------------------------------------------------------------------------
-- The door: a passenger with a photo is flagged "check ID", with the photo's
-- path so the crew can open it. Patched into validate_booking_qr's passenger
-- payload the same asserted way.
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text;
  v_old constant text := '''boardedAt'', bp.boarded_at';
  v_new constant text := '''boardedAt'', bp.boarded_at, '
    || '''idCheck'', (bp.proof_path is not null or bp.discount_kind is not null), '
    || '''proofPath'', bp.proof_path';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'validate_booking_qr';

  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'patch: expected exactly one boardedAt in validate_booking_qr';
  end if;

  execute replace(v_def, v_old, v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- The data reset must not leave government IDs behind. Every object in the
-- bucket — linked to a booking or abandoned mid-checkout — for the reset-data
-- function to remove after the database commit, as it does discount proofs.
-- ---------------------------------------------------------------------------

create or replace function public.passenger_proof_objects()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'FORBIDDEN';
  end if;
  return coalesce(
    (select array_agg(name) from storage.objects where bucket_id = 'passenger-proofs'),
    '{}'
  );
end;
$$;

revoke all on function public.passenger_proof_objects() from public, anon;
grant execute on function public.passenger_proof_objects() to authenticated;
