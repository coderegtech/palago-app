-- Phase 5d: storing the provider's payment URL.
--
-- Clients hold no write privilege on `payments` — that is what stops anyone
-- marking their own payment PAID — so the Edge Function, which acts as the
-- signed-in user, cannot write the column either. It needs a privileged setter
-- with its own ownership check.
--
-- Why not compose the URL inside `create_test_payment` instead? Because the URL
-- belongs to the payment *provider*. The mock provider points at PalaGo's own
-- test page, but a real one would return its hosted checkout address, and that
-- knowledge belongs in the provider implementation rather than in SQL.

create or replace function public.set_payment_url(p_payment_id uuid, p_payment_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_owner uuid;
  v_status public.payment_status;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select b.user_id, p.status
    into v_owner, v_status
    from public.payments p
    join public.bookings b on b.id = p.booking_id
   where p.id = p_payment_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_owner <> v_user_id and not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  -- Only while the payment is still open. Rewriting the URL of a paid payment
  -- would let someone point a settled receipt at somewhere else.
  if v_status <> 'PENDING' then
    raise exception 'VALIDATION_ERROR';
  end if;

  update public.payments set payment_url = p_payment_url where id = p_payment_id;
end;
$$;

revoke all on function public.set_payment_url(uuid, text) from public, anon;
grant execute on function public.set_payment_url(uuid, text) to authenticated;
