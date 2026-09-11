-- Phase 11b: verified fare discounts for seniors, students and PWD.
--
-- Philippine law grants seniors, students and persons with disability a 20%
-- fare discount on presentation of a valid ID. PalaGo mirrors that: the
-- passenger uploads their ID, a human approves it, and only then does the fare
-- move. Three consequences shape everything below.
--
--   * **A claimed type is not a discount.** `booking_passengers.passenger_type`
--     has always come straight from the client — before this migration nobody
--     could gain anything by lying, because the field did not touch the price.
--     It touches the price now, so the discount is keyed off an APPROVED
--     eligibility row the client cannot write, never off the claimed type.
--     Claiming SENIOR with no approved proof pays full fare, exactly as the
--     requirement says.
--
--   * **The proof is a government ID.** The bucket is private, the object path
--     is namespaced by user id, and nothing is ever served through a public
--     URL. Operators reviewing an ID see it through a signed URL that expires.
--
--   * **One seat, not the whole booking.** Eligibility belongs to the account
--     holder, so it discounts a single passenger line — the one whose claimed
--     type matches the approved proof. Booking your mother's seat on your own
--     account does not discount hers; she needs her own verified account. That
--     matches how the ID is actually checked at the door, by the person
--     travelling.
--
-- Errors are raised with the message set to an exact code from
-- src/constants/errors.ts.

create type public.discount_kind as enum ('SENIOR', 'STUDENT', 'PWD');

create type public.eligibility_status as enum (
  'PENDING', 'APPROVED', 'REJECTED', 'REVOKED'
);

-- ---------------------------------------------------------------------------
-- The rate, in basis points, in exactly one place.
--
-- A literal 0.20 sprinkled through pricing code is how a rate change becomes a
-- three-week bug hunt. 2000 bps = 20%.
-- ---------------------------------------------------------------------------

create or replace function public.discount_rate_bps()
returns integer language sql immutable
set search_path = ''
as $$ select 2000 $$;

comment on function public.discount_rate_bps is
  'Verified fare discount in basis points. 2000 = 20%, the statutory rate for senior/student/PWD.';

-- ---------------------------------------------------------------------------
-- discount_eligibilities
--
-- One row per submission. History is kept — a rejected submission stays
-- rejected and visible, so a passenger can see why and a reviewer can see what
-- they already turned down.
-- ---------------------------------------------------------------------------

create table public.discount_eligibilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.discount_kind not null,
  status public.eligibility_status not null default 'PENDING',
  -- Object path inside the private `discount-proofs` bucket, always
  -- '<user_id>/<uuid>.<ext>'. Not a URL: URLs expire, paths do not.
  proof_path text not null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  -- Why it was rejected, shown to the passenger. Kept short and factual.
  review_note text,
  -- Student IDs expire; a senior citizen ID does not. Null means no expiry.
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_eligibilities_proof_present
    check (length(trim(proof_path)) > 0),
  -- A decision always carries who made it and when, so an approved discount can
  -- always be traced to a person.
  constraint discount_eligibilities_reviewed_together
    check (
      (status in ('PENDING'))
      or (reviewed_at is not null and reviewed_by is not null)
    )
);

comment on table public.discount_eligibilities is
  'Senior/student/PWD proof submissions. A discount applies only while a row here is APPROVED and unexpired.';
comment on column public.discount_eligibilities.proof_path is
  'Path in the private discount-proofs bucket. Never a public URL — this is a government ID.';

create index discount_eligibilities_user_idx
  on public.discount_eligibilities (user_id, created_at desc);
-- The reviewer queue.
create index discount_eligibilities_pending_idx
  on public.discount_eligibilities (submitted_at)
  where status = 'PENDING';

-- At most one approved eligibility per person: the discounts do not stack, and
-- two approvals would make "which one applies" a coin toss.
create unique index discount_eligibilities_one_approved_idx
  on public.discount_eligibilities (user_id)
  where status = 'APPROVED';

-- One open submission per person per kind, so a queue cannot be flooded by
-- re-uploading the same ID.
create unique index discount_eligibilities_one_pending_idx
  on public.discount_eligibilities (user_id, kind)
  where status = 'PENDING';

create trigger discount_eligibilities_set_updated_at
  before update on public.discount_eligibilities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- A passenger reads their own submissions. Operators and admins read all of
-- them, because they are the reviewers. Nobody writes from the client: both
-- submitting and deciding go through SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------

alter table public.discount_eligibilities enable row level security;

create policy "Passengers read their own eligibility submissions"
  on public.discount_eligibilities for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.current_profile_role() in ('OPERATOR', 'ADMIN')
  );

revoke insert, update, delete on public.discount_eligibilities from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The proof bucket
--
-- Private. `public = false` is the whole security model for the image itself:
-- with it false, the only way to read an object is a signed URL minted by
-- someone whose policy allows the read.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'discount-proofs',
  'discount-proofs',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- Upload only into your own folder. `foldername(name)[1]` is the first path
-- segment, which the client cannot forge past this check.
create policy "Owners upload their own proof"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'discount-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Owners and reviewers read proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'discount-proofs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.current_profile_role() in ('OPERATOR', 'ADMIN')
    )
  );

-- Replacing a rejected upload is ordinary. Deleting is not: a decision must
-- stay auditable against the document it was made about.
create policy "Owners replace their own proof"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'discount-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- active_discount_kind
--
-- The single question pricing asks: what, if anything, is this person verified
-- as right now? Null when nothing is approved or the approval has lapsed.
-- ---------------------------------------------------------------------------

create or replace function public.active_discount_kind(p_user_id uuid)
returns public.discount_kind
language sql
stable
security definer
set search_path = ''
as $$
  select e.kind
    from public.discount_eligibilities e
   where e.user_id = p_user_id
     and e.status = 'APPROVED'
     and (e.expires_at is null or e.expires_at >= current_date)
   limit 1;
$$;

revoke all on function public.active_discount_kind(uuid) from public, anon;
grant execute on function public.active_discount_kind(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_discount_proof
--
-- The upload itself has already happened, straight to storage under a path the
-- policy above pins to the caller. This records it and puts it in the queue.
-- ---------------------------------------------------------------------------

create or replace function public.submit_discount_proof(
  p_kind public.discount_kind,
  p_proof_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_row public.discount_eligibilities%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_proof_path is null or length(trim(p_proof_path)) = 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- The path must sit in the caller's own folder. The storage policy already
  -- enforces this for the upload; re-checking here stops a row pointing at
  -- somebody else's document even if the object never existed.
  if split_part(p_proof_path, '/', 1) <> v_user_id::text then
    raise exception 'FORBIDDEN';
  end if;

  if public.active_discount_kind(v_user_id) is not null then
    -- Already verified. Re-submitting would either stack or silently replace a
    -- live approval; both are worse than saying no.
    raise exception 'REWARD_ALREADY_APPLIED';
  end if;

  begin
    insert into public.discount_eligibilities (user_id, kind, proof_path)
    values (v_user_id, p_kind, trim(p_proof_path))
    returning * into v_row;
  exception when unique_violation then
    raise exception 'VALIDATION_ERROR';
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id, 'DISCOUNT_PROOF_SUBMITTED', 'discount_eligibility', v_row.id,
    jsonb_build_object('kind', p_kind)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'status', v_row.status,
    'submittedAt', v_row.submitted_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- review_discount_eligibility
--
-- Operator or admin only. Approving is what actually moves money on every
-- future booking, so it is audited and attributed.
-- ---------------------------------------------------------------------------

create or replace function public.review_discount_eligibility(
  p_id uuid,
  p_approve boolean,
  p_note text default null,
  p_expires_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row public.discount_eligibilities%rowtype;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if public.current_profile_role() not in ('OPERATOR', 'ADMIN') then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_row from public.discount_eligibilities where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_row.status <> 'PENDING' then
    -- Idempotent when the decision already matches; a contradiction is refused.
    if (v_row.status = 'APPROVED') = p_approve then
      return jsonb_build_object(
        'id', v_row.id, 'status', v_row.status, 'changed', false
      );
    end if;
    raise exception 'VALIDATION_ERROR';
  end if;

  begin
    update public.discount_eligibilities
       -- The cast is required: an unadorned CASE yields text, and the column is
       -- an enum.
       set status = (case when p_approve then 'APPROVED' else 'REJECTED' end)
                      ::public.eligibility_status,
           reviewed_at = now(),
           reviewed_by = v_actor,
           review_note = nullif(trim(coalesce(p_note, '')), ''),
           expires_at = case when p_approve then p_expires_at else null end
     where id = p_id
    returning * into v_row;
  exception when unique_violation then
    -- The one-approved-per-user index. Someone already has a live approval.
    raise exception 'REWARD_ALREADY_APPLIED';
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    case when p_approve then 'DISCOUNT_APPROVED' else 'DISCOUNT_REJECTED' end,
    'discount_eligibility', v_row.id,
    jsonb_build_object('kind', v_row.kind, 'subjectUserId', v_row.user_id)
  );

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_row.user_id, 'SYSTEM',
    case when p_approve then 'Discount approved' else 'Discount not approved' end,
    case
      when p_approve then 'Your ID was verified. A 20% discount now applies to your seat when you book.'
      else coalesce(v_row.review_note, 'Your ID could not be verified. You can upload a clearer photo.')
    end,
    jsonb_build_object('eligibilityId', v_row.id, 'kind', v_row.kind)
  );

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'changed', true);
end;
$$;

revoke all on function public.submit_discount_proof(public.discount_kind, text) from public, anon;
revoke all on function public.review_discount_eligibility(uuid, boolean, text, date) from public, anon;
grant execute on function public.submit_discount_proof(public.discount_kind, text) to authenticated;
grant execute on function public.review_discount_eligibility(uuid, boolean, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Per-passenger discount, recorded on the line it applied to
--
-- `bookings.discount` becomes the sum of these rather than a free-floating
-- number, so "why is this booking cheaper" always has an answer attached to a
-- specific seat and a specific approved document.
-- ---------------------------------------------------------------------------

alter table public.booking_passengers
  add column discount_amount integer not null default 0,
  add column discount_kind public.discount_kind,
  add constraint booking_passengers_discount_non_negative
    check (discount_amount >= 0),
  -- An amount without a reason, or a reason without an amount, is a bug.
  add constraint booking_passengers_discount_has_reason
    check ((discount_amount > 0) = (discount_kind is not null));

comment on column public.booking_passengers.discount_amount is
  'Centavos off this seat, from a verified eligibility. Sums to bookings.discount.';

-- ---------------------------------------------------------------------------
-- reserve_seats, with the discount applied
--
-- Unchanged from Phase 4 except for pricing: the fare, the seat locking and the
-- validation are all as they were. What is new is that after the subtotal is
-- computed, the caller's verified status is looked up server-side and applied
-- to at most one matching passenger line.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_seats(
  p_trip_id uuid,
  p_passengers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := (select auth.uid());
  v_trip        public.trips%rowtype;
  v_seat_ids    uuid[];
  v_seat_count  integer;
  v_available   integer;
  v_valid_seats integer;
  v_booking_id  uuid;
  v_reference   text;
  v_subtotal    integer;
  v_expires_at  timestamptz;
  v_kind        public.discount_kind;
  v_discount    integer := 0;
  v_discounted  uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if jsonb_typeof(p_passengers) <> 'array' or jsonb_array_length(p_passengers) = 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  select array_agg((p ->> 'seatId')::uuid)
    into v_seat_ids
    from jsonb_array_elements(p_passengers) as p;

  v_seat_count := array_length(v_seat_ids, 1);

  if v_seat_count > 10 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Two passengers cannot be given the same seat.
  if (select count(distinct s) from unnest(v_seat_ids) as s) <> v_seat_count then
    raise exception 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_passengers) as p
    where coalesce(trim(p ->> 'name'), '') = ''
  ) then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- Only a scheduled or boarding trip can be sold.
  if v_trip.status not in ('SCHEDULED', 'BOARDING') then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- -------------------------------------------------------------------------
  -- Lock FIRST, then check.
  --
  -- This ordering is the whole point of the function. A concurrent caller
  -- asking for any of the same seats blocks here until this transaction
  -- commits; because READ COMMITTED takes a fresh snapshot per statement, it
  -- then sees the seats as HELD and fails the availability check below.
  --
  -- Checking availability before taking the lock would let both callers read
  -- "AVAILABLE" and both proceed — the classic double-booking race.
  --
  -- ORDER BY is not decoration. Two callers requesting overlapping seat sets in
  -- opposite orders would otherwise each hold one row and wait on the other's,
  -- deadlocking; Postgres kills one at random with a message the client cannot
  -- interpret. Locking in a consistent order makes one caller simply wait.
  -- -------------------------------------------------------------------------
  perform 1
     from public.trip_seats
    where trip_id = p_trip_id
      and seat_id = any(v_seat_ids)
    order by seat_id
    for update;

  -- Every requested seat must actually belong to this trip.
  select count(*) into v_valid_seats
    from public.trip_seats
   where trip_id = p_trip_id and seat_id = any(v_seat_ids);

  if v_valid_seats <> v_seat_count then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Reclaim holds that have already lapsed, so a stale hold does not make a
  -- seat look taken when the sweep simply has not run yet.
  update public.trip_seats
     set status = 'AVAILABLE', booking_id = null, held_by = null, held_until = null
   where trip_id = p_trip_id
     and seat_id = any(v_seat_ids)
     and status = 'HELD'
     and held_until < now();

  select count(*) into v_available
    from public.trip_seats
   where trip_id = p_trip_id
     and seat_id = any(v_seat_ids)
     and status = 'AVAILABLE';

  if v_available <> v_seat_count then
    raise exception 'SEAT_UNAVAILABLE';
  end if;

  -- -------------------------------------------------------------------------
  -- Price is computed here from the trip's own fare. Nothing about the amount
  -- comes from the caller.
  -- -------------------------------------------------------------------------
  v_subtotal   := v_trip.fare * v_seat_count;
  v_expires_at := now() + interval '10 minutes';
  v_reference  := public.next_booking_reference();

  -- The discount is derived from an APPROVED eligibility row, which the
  -- client has no write path to. A passenger who types SENIOR without
  -- verified proof pays the ordinary fare — that is the requirement, and it
  -- is why this does not read the claimed type on its own.
  v_kind := public.active_discount_kind(v_user_id);

  if v_kind is not null then
    -- One seat: the eligibility belongs to the account holder, and they
    -- occupy one. Matched against the claimed type so the money lands on the
    -- line the passenger actually marked, and `order by ord` makes the choice
    -- deterministic when several lines claim it.
    select (p ->> 'seatId')::uuid
      into v_discounted
      from jsonb_array_elements(p_passengers) with ordinality as t(p, ord)
     where coalesce(nullif(p ->> 'type', ''), 'ADULT') = v_kind::text
     order by t.ord
     limit 1;

    if v_discounted is not null then
      v_discount := round(v_trip.fare * public.discount_rate_bps() / 10000.0);
    end if;
  end if;

  insert into public.bookings (
    user_id, trip_id, booking_reference, status,
    subtotal, discount, loyalty_discount, total_amount, expires_at
  )
  values (
    v_user_id, p_trip_id, v_reference, 'PAYMENT_PENDING',
    v_subtotal, v_discount, 0, v_subtotal - v_discount, v_expires_at
  )
  returning id into v_booking_id;

  insert into public.booking_passengers (
    booking_id, user_id, seat_id, passenger_name, phone, email, passenger_type,
    discount_amount, discount_kind
  )
  select
    v_booking_id,
    v_user_id,
    (p ->> 'seatId')::uuid,
    trim(p ->> 'name'),
    nullif(trim(coalesce(p ->> 'phone', '')), ''),
    nullif(trim(coalesce(p ->> 'email', '')), ''),
    coalesce(nullif(p ->> 'type', ''), 'ADULT')::public.passenger_type,
    case when (p ->> 'seatId')::uuid = v_discounted then v_discount else 0 end,
    case when (p ->> 'seatId')::uuid = v_discounted then v_kind else null end
  from jsonb_array_elements(p_passengers) as p;

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
    'totalAmount', v_subtotal - v_discount,
    'currency', 'PHP',
    'seatCount', v_seat_count,
    'expiresAt', v_expires_at
  );
end;
$$;
