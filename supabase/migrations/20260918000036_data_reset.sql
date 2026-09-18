-- ---------------------------------------------------------------------------
-- Resetting the application's data, from the admin console.
--
-- For one job: moving a project from demo data to real data. It deletes what
-- people *did* — bookings, payments, receipts, points, wallet movements,
-- notifications, emergencies, boarding scans, GPS trails, ID submissions and
-- the passenger accounts that made them — and keeps what the application *is*:
-- the schema, settings, operators, terminals, routes, coaches, seat layouts,
-- schedules, crew rosters, the rewards catalogue, and every staff account.
--
-- Three things decide the shape of it.
--
--   1. It is one function, so it is one transaction. Every delete below either
--      happens or none of it does; a failure halfway rolls back to exactly the
--      state before the button was pressed. That includes the passenger
--      accounts in `auth.users` — deleting them here rather than through the Auth
--      Admin API is what lets them sit inside the same transaction as
--      everything else, instead of being a compensating write after the fact.
--      The one thing that cannot be transactional is the ID photographs in
--      Storage, which is why they are removed afterwards by the `reset-data`
--      Edge Function, from a list this function returns.
--
--   2. Who survives is decided by role and by a flag, never by an email address.
--      Every SUPER_ADMIN, OPERATOR_ADMIN, DRIVER and CREW account stays — they
--      are the people who run the service, and the operator console is useless
--      without them. Passengers are deleted, except any profile marked
--      `is_test_account`, which is kept (with its history emptied) so the team
--      can go on testing the passenger app after a reset.
--
--   3. The confirmation phrase is checked here, not only in the dialog. The
--      console asks the admin to type RESET DATABASE; the function refuses
--      anything else. A stray API call, a replayed request, or a future screen
--      that forgets the dialog cannot empty the database by accident.
--
-- Deliberately KEPT, with reasons:
--
--   * audit_logs — the record of who did what. A reset is exactly the kind of
--     thing it exists to record, and wiping it would erase the only evidence of
--     the reset itself. Entries about deleted rows remain as history.
--   * trips and trip_assignments — the schedule is configuration, and a trip
--     that already ran is part of the coach's and the crew's history. Their
--     seats are freed, so every departure starts with no one aboard.
--   * BLOCKED seats — "not for sale" is layout, not a sale, and stays.
--   * push_tokens of surviving accounts — a device registration, not a record.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The testing account
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_test_account boolean not null default false;

comment on column public.profiles.is_test_account is
  'Survives a data reset (with its history emptied) so the app can still be tested afterwards. Set by SQL only — no client has a grant on this column.';

-- `profiles` UPDATE is granted to clients column by column, and this column is
-- not in the list, so a passenger cannot mark themselves a test account and
-- outlive a reset. Stated rather than assumed:
revoke update (is_test_account) on public.profiles from anon, authenticated;

-- The seeded passenger is the team's testing account, wherever it exists — the
-- local seed and seed.cloud.sql both create it. Idempotent, and a no-op on a
-- project that never had it.
update public.profiles set is_test_account = true where email = 'passenger@palago.test';

-- ---------------------------------------------------------------------------
-- What a reset would touch — read-only, for the confirmation dialog
-- ---------------------------------------------------------------------------

create or replace function public.data_reset_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- `is_admin()` is gated on account_status and on the SUPER_ADMIN role. A
  -- bare boolean, so the NULL-in-an-IF trap from AGENTS.md does not apply.
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'delete', jsonb_build_object(
      'passengerAccounts', (select count(*) from public.profiles
                             where role = 'USER' and not is_test_account),
      'bookings', (select count(*) from public.bookings),
      'payments', (select count(*) from public.payments),
      'receipts', (select count(*) from public.receipts),
      'walletTransactions', (select count(*) from public.wallet_transactions),
      'loyaltyTransactions', (select count(*) from public.loyalty_transactions),
      'rewardRedemptions', (select count(*) from public.reward_redemptions),
      'notifications', (select count(*) from public.notifications),
      'sosIncidents', (select count(*) from public.sos_incidents),
      'boardingScans', (select count(*) from public.qr_scans),
      'gpsPoints', (select count(*) from public.bus_locations),
      'discountSubmissions', (select count(*) from public.discount_eligibilities)
    ),
    'keep', jsonb_build_object(
      'superAdmins', (select count(*) from public.profiles where role = 'SUPER_ADMIN'),
      'staffAccounts', (select count(*) from public.profiles
                         where role in ('OPERATOR_ADMIN', 'DRIVER', 'CREW')),
      'testAccounts', (select count(*) from public.profiles where is_test_account),
      'testAccountEmails', coalesce((select jsonb_agg(email order by email)
                                       from public.profiles where is_test_account), '[]'::jsonb),
      'operators', (select count(*) from public.operators),
      'terminals', (select count(*) from public.terminals),
      'routes', (select count(*) from public.routes),
      'buses', (select count(*) from public.buses),
      'trips', (select count(*) from public.trips),
      'rewards', (select count(*) from public.rewards)
    )
  );
end;
$$;

revoke all on function public.data_reset_preview() from public, anon;
grant execute on function public.data_reset_preview() to authenticated;

-- ---------------------------------------------------------------------------
-- The reset itself
-- ---------------------------------------------------------------------------

create or replace function public.reset_application_data(p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.active_uid();
  v_counts jsonb;
  v_proof_paths text[];
  v_passengers int;
  v_bookings int;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  -- Exact, case-sensitive, no trimming. Typing it is the point.
  if p_confirmation is distinct from 'RESET DATABASE' then
    raise exception 'VALIDATION_ERROR'
      using detail = 'Type RESET DATABASE exactly to confirm.';
  end if;

  -- Two admins pressing the button together must not interleave two resets.
  -- Transaction-scoped: released at commit or rollback, never left held.
  perform pg_advisory_xact_lock(hashtext('public.reset_application_data'));

  -- Counted before anything moves, so the audit entry and the success message
  -- report what was actually there.
  v_counts := public.data_reset_preview() -> 'delete';

  -- The ID photographs live in Storage, which no transaction can reach. Their
  -- paths are returned so the Edge Function can remove the files once this has
  -- committed — a government ID left behind in a bucket after its record is
  -- gone is exactly the kind of leftover a reset must not produce.
  select coalesce(array_agg(proof_path) filter (where proof_path is not null), '{}')
    into v_proof_paths
    from public.discount_eligibilities;

  -- 1. Passenger accounts. Deleting the auth user cascades their profile,
  --    bookings (and through them passengers, payments, receipts), wallet,
  --    loyalty account, notifications, SOS incidents, ID submissions and push
  --    tokens. Staff references elsewhere are ON DELETE SET NULL, so history
  --    rows lose a name rather than dangling.
  delete from auth.users u
   using public.profiles p
   where p.id = u.id
     and p.role = 'USER'
     and not p.is_test_account;
  get diagnostics v_passengers = row_count;

  -- 2. Everything transactional that belonged to someone who survives — the
  --    test account, the staff, and walk-in counter sales with no account at
  --    all. Children before parents where the cascade does not already cover it.
  --
  --    `where true` is deliberate, not decoration. Supabase loads pg_safeupdate
  --    for every API request, and it refuses a DELETE with no WHERE clause —
  --    exactly the guard that stops a careless one-liner emptying a table. This
  --    function is the one place emptying the table IS the intent, so it says so
  --    explicitly rather than switching the guard off. (Testing it as the
  --    `postgres` superuser skipped the guard and passed; called from the app it
  --    failed and rolled back cleanly, which is how this was found.)
  delete from public.qr_scans where true;
  delete from public.bus_locations where true;
  delete from public.sos_incidents where true;
  delete from public.notifications where true;
  delete from public.reward_redemptions where true;
  delete from public.loyalty_transactions where true;
  delete from public.wallet_transactions where true;
  delete from public.discount_eligibilities where true;
  delete from public.bookings where true;   -- cascades booking_passengers, payments, receipts, payment_transactions
  get diagnostics v_bookings = row_count;

  -- 3. Balances follow their ledgers to zero, so `sum(amount) = balance` — the
  --    wallet invariant — still holds: nothing, and zero.
  update public.wallets set balance = 0, updated_at = now() where balance <> 0;
  update public.loyalty_accounts
     set points_balance = 0, lifetime_points = 0, updated_at = now()
   where points_balance <> 0 or lifetime_points <> 0;

  -- 4. Every seat that was held or sold is free again. BLOCKED seats are layout
  --    ("not for sale"), not a sale, and are left exactly as they were.
  update public.trip_seats
     set status = 'AVAILABLE',
         booking_id = null,
         held_by = null,
         held_until = null,
         confirmed_at = null,
         updated_at = now()
   where status in ('HELD', 'BOOKED');

  -- 5. Reference numbers start again at 000001. ALTER SEQUENCE is
  --    transactional, unlike setval(), so a failure after this line rolls the
  --    numbering back with everything else instead of leaving it restarted over
  --    rows that still exist.
  execute 'alter sequence public.booking_reference_seq restart with 1';
  execute 'alter sequence public.payment_reference_seq restart with 1';
  execute 'alter sequence public.receipt_number_seq restart with 1';

  -- 6. The record of who did it. Written last, inside the same transaction, so
  --    it exists if and only if the reset does.
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    'DATA_RESET',
    'system',
    null,
    jsonb_build_object(
      'deleted', v_counts || jsonb_build_object(
        'passengerAccountsRemoved', v_passengers,
        'bookingsRemoved', v_bookings
      ),
      'proofFiles', coalesce(array_length(v_proof_paths, 1), 0)
    )
  );

  return jsonb_build_object(
    'deleted', v_counts,
    'proofPaths', to_jsonb(v_proof_paths),
    'resetAt', now()
  );
end;
$$;

revoke all on function public.reset_application_data(text) from public, anon;
-- Callable by a signed-in client only so that `is_admin()` evaluates against the
-- caller. The console never calls it directly: it goes through `reset-data`,
-- which also removes the Storage files.
grant execute on function public.reset_application_data(text) to authenticated;

comment on function public.reset_application_data(text) is
  'SUPER_ADMIN only. Deletes all transactional data and passenger accounts (except is_test_account) in one transaction, keeps reference data and staff, restarts reference numbering, and logs DATA_RESET. Requires p_confirmation = ''RESET DATABASE''.';
