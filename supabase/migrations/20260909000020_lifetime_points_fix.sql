-- Phase 10 fix: lifetime points must count earning, not unwinding.
--
-- Found in browser verification, not by reading the code: applying a reward and
-- then removing it took `lifetime_points` from 800 to 1050. The redeem debited
-- 250 (no effect on lifetime, correct) and the release credited 250 back — and
-- `loyalty_post` was adding *any* positive movement to lifetime, so the return
-- of staked points was counted as if it had been earned.
--
-- That is not merely untidy. `lifetime_points` is the figure a tier or a badge
-- would be computed from later, and a passenger who applies and removes the
-- same reward in a loop could inflate it without travelling a metre. Fixing it
-- now is much cheaper than fixing it once something depends on it.
--
-- The rule, stated once: lifetime counts EARNED and BONUS. Nothing else. A
-- REDEEMED debit does not reduce it — having earned a point is a fact that
-- spending the point does not undo — and an ADJUSTED return does not raise it,
-- because those points were already counted when they were earned.

create or replace function public.loyalty_post(
  p_user_id uuid,
  p_type public.loyalty_transaction_type,
  p_points integer,
  p_reference text default null,
  p_description text default null,
  p_booking_id uuid default null
)
returns public.loyalty_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before integer;
  v_after integer;
  v_row public.loyalty_transactions;
begin
  select points_balance into v_before
    from public.loyalty_accounts where user_id = p_user_id;

  if v_before is null then
    raise exception 'NOT_FOUND';
  end if;

  v_after := v_before + p_points;

  if v_after < 0 then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  insert into public.loyalty_transactions (
    user_id, type, points, balance_before, balance_after, reference, description, booking_id
  ) values (
    p_user_id, p_type, p_points, v_before, v_after, p_reference, p_description, p_booking_id
  )
  returning * into v_row;

  update public.loyalty_accounts
     set points_balance = v_after,
         lifetime_points = lifetime_points
           + case
               when p_type in ('EARNED', 'BONUS') then greatest(0, p_points)
               else 0
             end
   where user_id = p_user_id;

  return v_row;
end;
$$;

revoke all on function public.loyalty_post(
  uuid, public.loyalty_transaction_type, integer, text, text, uuid
) from public, anon, authenticated;

-- Repair any account already inflated by the old rule. Lifetime is exactly the
-- sum of a user's EARNED and BONUS credits, so it can be recomputed rather than
-- guessed at.
update public.loyalty_accounts a
   set lifetime_points = coalesce((
     select sum(t.points)
       from public.loyalty_transactions t
      where t.user_id = a.user_id and t.type in ('EARNED', 'BONUS')
   ), 0);
