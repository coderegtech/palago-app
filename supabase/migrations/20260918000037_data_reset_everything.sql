-- ---------------------------------------------------------------------------
-- The data reset now removes everything except the admin accounts.
--
-- 20260918000036 kept the running service intact — staff accounts, operators,
-- terminals, routes, coaches, schedules, the rewards catalogue and a flagged
-- test account — and cleared only what passengers had done. The decision since
-- is that a reset should leave a genuinely empty platform: the admins who will
-- enter the real operators, terminals and schedules, and nothing else.
--
-- What survives, and why each is not "data":
--
--   * SUPER_ADMIN accounts — the only people left to rebuild from.
--   * app_settings — configuration, not data: the turnaround buffer and the
--     push webhook. Clearing them would break scheduling and notifications for
--     the real data about to be entered.
--   * audit_logs — the record of who did what, including this reset. Wiping it
--     would erase the only evidence the reset happened.
--   * The schema, functions, policies and storage bucket definitions.
--
-- Everything else goes, in foreign-key order, inside one transaction exactly as
-- before: a failure anywhere rolls the whole reset back. The test-account flag
-- no longer protects anyone from a reset; it still drives the TEST ACCOUNT
-- label for an account the team chooses to mark.
-- ---------------------------------------------------------------------------

comment on column public.profiles.is_test_account is
  'Labels the account TEST ACCOUNT in the app. SQL-only. It does NOT protect the account from an admin data reset — only SUPER_ADMIN accounts survive one.';

create or replace function public.data_reset_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'delete', jsonb_build_object(
      'accounts', (select count(*) from auth.users u
                    where not exists (select 1 from public.profiles p
                                       where p.id = u.id and p.role = 'SUPER_ADMIN')),
      'operators', (select count(*) from public.operators),
      'terminals', (select count(*) from public.terminals),
      'routes', (select count(*) from public.routes),
      'buses', (select count(*) from public.buses),
      'trips', (select count(*) from public.trips),
      'crewRecords', (select count(*) from public.drivers) + (select count(*) from public.assistants),
      'rewards', (select count(*) from public.rewards),
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
      'superAdminEmails', coalesce((select jsonb_agg(email order by email)
                                      from public.profiles where role = 'SUPER_ADMIN'), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.data_reset_preview() from public, anon;
grant execute on function public.data_reset_preview() to authenticated;

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
  v_accounts int;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_confirmation is distinct from 'RESET DATABASE' then
    raise exception 'VALIDATION_ERROR'
      using detail = 'Type RESET DATABASE exactly to confirm.';
  end if;

  -- Cannot empty the platform of the person pressing the button, and cannot
  -- leave it with no one able to sign in. `is_admin()` above already means the
  -- caller is an active SUPER_ADMIN, so at least one survives — asserted anyway,
  -- because the alternative is a platform nobody can ever administer again.
  if not exists (select 1 from public.profiles
                  where role = 'SUPER_ADMIN' and account_status = 'ACTIVE') then
    raise exception 'FORBIDDEN'
      using detail = 'No active admin account would survive the reset.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.reset_application_data'));

  v_counts := public.data_reset_preview() -> 'delete';

  select coalesce(array_agg(proof_path) filter (where proof_path is not null), '{}')
    into v_proof_paths
    from public.discount_eligibilities;

  -- `where true` throughout is deliberate: Supabase loads pg_safeupdate for API
  -- requests and it refuses an unqualified DELETE. See 20260918000036.

  -- Order matters, and not only for foreign keys. Rows that POINT AT an account
  -- go first and the accounts go after, because several of those pointers are
  -- ON DELETE SET NULL and a NULL is not always allowed: a CASH payment must
  -- name the clerk who took it (payments_cash_has_a_receiver), so deleting the
  -- clerk first would null `received_by` and fail the whole reset. The seed has
  -- no cash sales, so this passed on its own and failed only after
  -- verify-counter had sold one — which is how it was found.

  -- 1. Everything transactional.
  delete from public.qr_scans where true;
  delete from public.bus_locations where true;
  delete from public.sos_incidents where true;
  delete from public.notifications where true;
  delete from public.reward_redemptions where true;
  delete from public.loyalty_transactions where true;
  delete from public.wallet_transactions where true;
  delete from public.discount_eligibilities where true;
  delete from public.bookings where true;   -- passengers, payments, receipts

  -- 2. The schedule and the crew, which also point at accounts (cancelled_by,
  --    completed_by, user_id). trips cascades trip_assignments and trip_seats.
  delete from public.trips where true;
  delete from public.drivers where true;
  delete from public.assistants where true;

  -- 3. Every account that is not a SUPER_ADMIN — passengers, operator admins,
  --    drivers, crew, the test account, and any auth user with no profile at
  --    all. Nothing left points at them now. Cascades their profiles, wallets,
  --    loyalty accounts and push tokens.
  delete from auth.users u
   where not exists (select 1 from public.profiles p
                      where p.id = u.id and p.role = 'SUPER_ADMIN');
  get diagnostics v_accounts = row_count;

  -- 4. The rest of the service, children before parents. After the accounts,
  --    so no staff profile is left holding an operator_id being deleted.
  delete from public.bus_seats where true;
  delete from public.buses where true;
  delete from public.routes where true;
  delete from public.terminals where true;
  delete from public.operators where true;
  delete from public.rewards where true;

  -- 5. What is left of the admins' own ledgers follows to zero.
  update public.wallets set balance = 0, updated_at = now() where balance <> 0;
  update public.loyalty_accounts
     set points_balance = 0, lifetime_points = 0, updated_at = now()
   where points_balance <> 0 or lifetime_points <> 0;

  -- 6. Numbering starts again. ALTER SEQUENCE, not setval(), so it rolls back.
  execute 'alter sequence public.booking_reference_seq restart with 1';
  execute 'alter sequence public.payment_reference_seq restart with 1';
  execute 'alter sequence public.receipt_number_seq restart with 1';

  -- 7. The record, last, in the same transaction.
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    'DATA_RESET',
    'system',
    null,
    jsonb_build_object(
      'scope', 'EVERYTHING_EXCEPT_SUPER_ADMINS',
      'deleted', v_counts || jsonb_build_object('accountsRemoved', v_accounts),
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
grant execute on function public.reset_application_data(text) to authenticated;

comment on function public.reset_application_data(text) is
  'SUPER_ADMIN only. Deletes every account except SUPER_ADMINs and all application data — operators, terminals, routes, coaches, schedules, crew, rewards and every transaction — in one transaction. Keeps app_settings and audit_logs, restarts reference numbering, and logs DATA_RESET. Requires p_confirmation = ''RESET DATABASE''.';
