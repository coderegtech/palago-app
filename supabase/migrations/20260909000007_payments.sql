-- Phase 5a: payments, receipts and the audit/notification trail.
--
-- MOCK PAYMENT ONLY. The `payment_provider` enum names Stripe, GCash and Maya
-- so the vocabulary is settled, but nothing in this schema or in any function
-- contacts a real provider, and no code path can move money. See
-- docs/payment-flow.md.

create type public.payment_provider as enum ('MOCK', 'STRIPE', 'GCASH', 'MAYA');

create type public.payment_status as enum (
  'PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'
);

create type public.payment_transaction_type as enum (
  'CREATED', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'
);

create type public.notification_type as enum (
  'BOOKING_CONFIRMED', 'PAYMENT_CONFIRMED', 'TRIP_REMINDER', 'TRIP_DELAY',
  'TRIP_CANCELLED', 'BOARDING', 'SOS', 'REWARD', 'SYSTEM'
);

-- ---------------------------------------------------------------------------
-- References
--
-- Sequences, for the same reason booking references use one: two concurrent
-- callers counting existing rows would compute the same number.
-- ---------------------------------------------------------------------------

create sequence public.payment_reference_seq start 1;
create sequence public.receipt_number_seq start 1;

create or replace function public.next_payment_reference()
returns text language sql volatile set search_path = '' as $$
  select 'PAY-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('public.payment_reference_seq')::text, 6, '0');
$$;

create or replace function public.next_receipt_number()
returns text language sql volatile set search_path = '' as $$
  select 'RCP-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('public.receipt_number_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  reference text not null unique default public.next_payment_reference(),
  -- The bearer secret carried in the payment QR. The payment page is public —
  -- it loads in a browser with no session — so possession of this token, not a
  -- logged-in user, is what authorises reading and confirming this payment.
  -- 32 random bytes: not guessable, and never logged.
  token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  provider public.payment_provider not null default 'MOCK',
  amount integer not null,
  currency text not null default 'PHP',
  status public.payment_status not null default 'PENDING',
  payment_url text,
  receipt_number text,
  expires_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount_positive check (amount > 0),
  -- Only MOCK may exist while this build has no real provider wired. Removing
  -- this constraint should be a deliberate, reviewed act.
  constraint payments_mock_only check (provider = 'MOCK')
);

comment on column public.payments.amount is 'Amount due, in centavos.';
comment on column public.payments.token is
  'Bearer secret in the payment QR. Authorises the public payment page. Never log it.';

create index payments_booking_id_idx on public.payments (booking_id);
create index payments_reference_idx on public.payments (reference);
create index payments_status_idx on public.payments (status);
create index payments_expires_at_idx on public.payments (expires_at)
  where status in ('PENDING', 'PROCESSING');

-- At most one live payment per booking. Without this, retrying "create payment"
-- would leave two PENDING payments for one booking and either could be
-- confirmed, so the booking could be paid twice over.
create unique index payments_one_live_per_booking_idx
  on public.payments (booking_id)
  where status in ('PENDING', 'PROCESSING', 'PAID');

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Payment transactions
--
-- An append-only ledger of what happened to a payment. Never updated.
-- ---------------------------------------------------------------------------

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  type public.payment_transaction_type not null,
  amount integer not null,
  status public.payment_status not null,
  reference text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index payment_transactions_payment_id_idx on public.payment_transactions (payment_id);

-- ---------------------------------------------------------------------------
-- Receipts
--
-- `receipt_number UNIQUE` is what makes receipt generation idempotent: a
-- retried confirmation cannot produce a second receipt for the same payment,
-- and `payment_id UNIQUE` states that rule directly.
-- ---------------------------------------------------------------------------

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  receipt_number text not null unique default public.next_receipt_number(),
  amount integer not null,
  currency text not null default 'PHP',
  payment_method text not null default 'TEST PAYMENT',
  status public.payment_status not null default 'PAID',
  issued_at timestamptz not null default now()
);

create index receipts_booking_id_idx on public.receipts (booking_id);

-- ---------------------------------------------------------------------------
-- Audit log
--
-- Pulled forward from Phase 13: a payment confirmation that leaves no trace is
-- not something to build and fix later.
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications
--
-- Pulled forward from Phase 12. Rows are written now; the feed and push
-- delivery that display them are built there.
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  message text not null,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Everything here is read-only from the client. Payment and booking state
-- changes happen only inside the SECURITY DEFINER functions in the next
-- migration, which is what stops a client marking its own payment PAID.
--
-- Note `payments.token` is readable by the booking's owner. That is fine — it
-- is their own QR secret — but no service or view should ever expose it to
-- anyone else, which is why the public payment page reads through a function
-- that never returns it.
-- ---------------------------------------------------------------------------

alter table public.payments enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.receipts enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

create policy "Users read payments for their own bookings"
  on public.payments for select to authenticated
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

create policy "Users read transactions for their own payments"
  on public.payment_transactions for select to authenticated
  using (
    exists (
      select 1
      from public.payments p
      join public.bookings b on b.id = p.booking_id
      where p.id = payment_id
        and (b.user_id = (select auth.uid()) or public.is_admin())
    )
  );

create policy "Users read receipts for their own bookings"
  on public.receipts for select to authenticated
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

-- Audit logs are for admins. A user reading the audit trail would learn about
-- other people's activity, and a tamperable log is not a log.
create policy "Admins read audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin());

create policy "Users read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Marking a notification read is the one thing a client may write here, and
-- only on its own rows. Column grants below restrict it to `read_at`.
create policy "Users mark their own notifications read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke insert, update, delete on public.payments from anon, authenticated;
revoke insert, update, delete on public.payment_transactions from anon, authenticated;
revoke insert, update, delete on public.receipts from anon, authenticated;
revoke insert, update, delete on public.audit_logs from anon, authenticated;
revoke insert, update, delete on public.notifications from anon, authenticated;

grant update (read_at) on public.notifications to authenticated;
