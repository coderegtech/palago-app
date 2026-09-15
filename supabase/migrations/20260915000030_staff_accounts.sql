-- Admin → Operator → Driver/Crew: account provisioning, and two statuses that
-- mean different things.
--
-- Until now the only way into PalaGo was the public sign-up form, which the
-- `handle_new_user` trigger hard-codes to role USER. Everything above that —
-- an operator's login, a driver's login — was set by hand in SQL. The admin
-- screen says so on screen: "Creating the company does not create a staff login
-- for it." This migration is the server half of removing that sentence.
--
-- Two separate states, deliberately not one column:
--
--   account_status       ACTIVE / INACTIVE      — may this person sign in at all
--   availability_status  AVAILABLE / UNAVAILABLE — may they be given a new trip
--
-- A driver on a rest day is ACTIVE + UNAVAILABLE: they open the app, see their
-- history and their notifications, and are simply not offered for assignment.
-- A dismissed driver is INACTIVE: the door closes, and every record of what
-- they drove stays exactly where it is. Collapsing those into one field is what
-- `drivers.status` used to do, and it could not express the first case at all —
-- so that column is retired here rather than left alongside its replacements.

-- ---------------------------------------------------------------------------
-- The two enums. Mirrored in src/constants/enums.ts; change both together.
-- ---------------------------------------------------------------------------

create type public.account_status as enum ('ACTIVE', 'INACTIVE');
create type public.availability_status as enum ('AVAILABLE', 'UNAVAILABLE');

-- ---------------------------------------------------------------------------
-- profiles: the one login gate
--
-- On `profiles` rather than on `drivers`/`assistants` because it is a property
-- of the account, not of the job: an operator's login is deactivated the same
-- way a driver's is, and there is exactly one place to look to know whether
-- somebody can get in.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column account_status public.account_status not null default 'ACTIVE',
  -- Set when an account is provisioned with a temporary password. The app
  -- refuses to go anywhere else until it is cleared.
  add column must_change_password boolean not null default false,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references auth.users (id) on delete set null;

comment on column public.profiles.account_status is
  'Whether this account may sign in. Not the same thing as a driver''s availability for work.';

create index profiles_account_status_idx on public.profiles (account_status)
  where account_status = 'INACTIVE';

-- The column grants from Phase 2 already exclude everything added here, so a
-- client cannot reactivate itself or clear its own password flag. Both move
-- only through the SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------------
-- Crew: availability, and the licence detail the scheduler needs
-- ---------------------------------------------------------------------------

alter table public.drivers
  add column availability_status public.availability_status not null default 'AVAILABLE',
  add column unavailable_reason text,
  add column license_expiration_date date;

alter table public.assistants
  add column availability_status public.availability_status not null default 'AVAILABLE',
  add column unavailable_reason text;

comment on column public.drivers.availability_status is
  'Whether this driver may be given a NEW trip. Unrelated to whether they can sign in.';
comment on column public.drivers.license_expiration_date is
  'Null for records created before licences were tracked; assignment refuses only a licence known to have expired.';

-- Carry the old single status across before dropping it. ACTIVE meant "on the
-- books and drivable"; INACTIVE and SUSPENDED both meant "do not assign", and
-- SUSPENDED additionally meant "and do not let them in", so it maps to both.
-- The cast is not optional: a CASE yields text, and assigning text to an enum
-- column fails outright. (Same trap as `review_discount_eligibility`.)
update public.drivers set availability_status =
  (case when status = 'ACTIVE' then 'AVAILABLE' else 'UNAVAILABLE' end)::public.availability_status;
-- The cast is not optional: a CASE yields text, and assigning text to an enum
-- column fails outright. (Same trap as `review_discount_eligibility`.)
update public.assistants set availability_status =
  (case when status = 'ACTIVE' then 'AVAILABLE' else 'UNAVAILABLE' end)::public.availability_status;

update public.profiles p set account_status = 'INACTIVE'
 where exists (select 1 from public.drivers d where d.user_id = p.id and d.status = 'SUSPENDED')
    or exists (select 1 from public.assistants a where a.user_id = p.id and a.status = 'SUSPENDED');

alter table public.drivers drop column status;
alter table public.assistants drop column status;
drop type public.staff_status;

-- ---------------------------------------------------------------------------
-- The gate reaches RLS
--
-- Deactivating an account in the UI is worth nothing if the row-level policies
-- still answer yes. These five helpers are what every policy in PalaGo resolves
-- through, so gating them here is what actually makes a deactivated account
-- inert — including for a session issued before the deactivation that has not
-- expired yet.
--
-- `profiles`' own SELECT policy is deliberately NOT gated: a deactivated person
-- must still be able to load their profile, or the app cannot tell them why it
-- stopped working.
-- ---------------------------------------------------------------------------

create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles
   where id = (select auth.uid()) and account_status = 'ACTIVE';
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'ADMIN'
      and account_status = 'ACTIVE'
  );
$$;

create or replace function public.current_operator_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select operator_id from public.profiles
   where id = (select auth.uid()) and account_status = 'ACTIVE';
$$;

create or replace function public.current_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
    from public.drivers d
    join public.profiles p on p.id = d.user_id
   where d.user_id = (select auth.uid())
     and p.account_status = 'ACTIVE';
$$;

create or replace function public.current_assistant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
    from public.assistants a
    join public.profiles p on p.id = a.user_id
   where a.user_id = (select auth.uid())
     and p.account_status = 'ACTIVE';
$$;

-- `auth.uid()` for an account that may sign in, NULL for one that may not.
-- The policies at the foot of this migration are rewritten onto it; anything
-- new that asks "is this row mine?" should use it rather than `auth.uid()`.
create or replace function public.active_uid()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.profiles
   where id = (select auth.uid()) and account_status = 'ACTIVE';
$$;

comment on function public.active_uid is
  'auth.uid() for an account that may sign in; NULL for a deactivated one. Use in any policy that tests row ownership.';

revoke all on function public.active_uid() from public, anon;
grant execute on function public.active_uid() to authenticated;


-- ---------------------------------------------------------------------------
-- operator_crew
--
-- The one place the consoles read crew from. It joins `profiles`, which an
-- operator cannot read directly — the profiles SELECT policy is "your own row,
-- or you are an admin" — so this is an owner-rights view with the scope written
-- into it, exactly like `operator_fleet`. Reading `drivers` straight would show
-- availability but never account status.
-- ---------------------------------------------------------------------------

create view public.operator_crew as
select
  d.id,
  'DRIVER'::text                as crew_kind,
  d.operator_id,
  d.user_id,
  d.name,
  d.phone,
  d.license_number,
  d.license_expiration_date,
  d.availability_status,
  d.unavailable_reason,
  (d.user_id is not null)       as has_account,
  p.email                       as account_email,
  p.account_status,
  p.must_change_password,
  d.created_at,
  d.updated_at
from public.drivers d
left join public.profiles p on p.id = d.user_id
where d.operator_id = public.current_operator_id()
   or d.user_id = public.active_uid()
   or public.is_admin()

union all

select
  a.id,
  'ASSISTANT'::text,
  a.operator_id,
  a.user_id,
  a.name,
  a.phone,
  null::text,
  null::date,
  a.availability_status,
  a.unavailable_reason,
  (a.user_id is not null),
  p.email,
  p.account_status,
  p.must_change_password,
  a.created_at,
  a.updated_at
from public.assistants a
left join public.profiles p on p.id = a.user_id
where a.operator_id = public.current_operator_id()
   or a.user_id = public.active_uid()
   or public.is_admin();

comment on view public.operator_crew is
  'Drivers and assistants with both statuses. Owner-rights: the operator filter is inside the view.';

revoke all on public.operator_crew from anon;
grant select on public.operator_crew to authenticated;

-- ---------------------------------------------------------------------------
-- Writes move to functions
--
-- `drivers` and `assistants` were writable directly under the Phase 3 policies.
-- They are not any more: creating a driver now has a second half (an auth
-- account), availability carries a reason, and every change belongs in the
-- audit trail. A direct INSERT would skip all three.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.drivers from anon, authenticated;
revoke insert, update, delete on public.assistants from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may provision whom
--
-- Asked BEFORE the Edge Function creates anything in auth.users, so a refused
-- request never leaves an orphaned account behind. Asked again inside
-- `provision_staff_account`, because a function that trusts its caller to have
-- asked first is not an authorisation check.
--
--   ADMIN     may create OPERATOR, DRIVER and ASSISTANT accounts, anywhere.
--   OPERATOR  may create DRIVER and ASSISTANT accounts, for their OWN operator.
--   anyone else — including a driver, who carries an operator id and would pass
--   a naive "is this my operator?" test — may create nothing.
--
-- Nobody creates an ADMIN, and nobody creates a USER: passengers sign
-- themselves up, and an administrator is provisioned with the service role.
-- ---------------------------------------------------------------------------

create or replace function public.authorize_staff_provision(
  p_role public.user_role,
  p_operator_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_role not in ('OPERATOR', 'DRIVER', 'ASSISTANT') then
    raise exception 'FORBIDDEN';
  end if;

  if p_operator_id is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not exists (select 1 from public.operators where id = p_operator_id) then
    raise exception 'NOT_FOUND';
  end if;

  if p_role = 'OPERATOR' then
    -- An operator creating another operator is exactly what the brief forbids.
    if not public.is_admin() then
      raise exception 'FORBIDDEN';
    end if;
  elsif not (public.is_admin() or public.can_manage_operator(p_operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object('allowed', true, 'role', p_role, 'operatorId', p_operator_id);
end;
$$;

revoke all on function public.authorize_staff_provision(public.user_role, uuid) from public, anon;
grant execute on function public.authorize_staff_provision(public.user_role, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- provision_staff_account
--
-- Turns a freshly created auth user into a staff account, and creates or links
-- the crew record, in one transaction. Called by the `manage-staff` Edge
-- Function immediately after `auth.admin.createUser`.
--
-- It refuses any profile that is not a brand-new passenger with no operator.
-- That is not pedantry: promoting a real passenger account to DRIVER would
-- leave their wallet, loyalty balance and booking history attached to a crew
-- login, and `award_loyalty_for_booking` would keep paying points to a driver.
-- ---------------------------------------------------------------------------

create or replace function public.provision_staff_account(
  p_user_id uuid,
  p_role public.user_role,
  p_operator_id uuid,
  p_full_name text,
  p_phone text default null,
  p_license_number text default null,
  p_license_expiration_date date default null,
  -- Link to a crew record that already exists (somebody recorded on paper
  -- before they had a login) instead of inserting a new one.
  p_crew_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_crew_id uuid;
begin
  perform public.authorize_staff_provision(p_role, p_operator_id);

  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_profile.role <> 'USER' or v_profile.operator_id is not null then
    raise exception 'VALIDATION_ERROR';
  end if;

  update public.profiles
     set role = p_role,
         operator_id = p_operator_id,
         full_name = trim(p_full_name),
         phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
         account_status = 'ACTIVE',
         must_change_password = true,
         deactivated_at = null,
         deactivated_by = null
   where id = p_user_id;

  if p_role = 'DRIVER' then
    if coalesce(trim(coalesce(p_license_number, '')), '') = '' then
      raise exception 'VALIDATION_ERROR';
    end if;

    if p_crew_id is not null then
      update public.drivers
         set user_id = p_user_id,
             name = trim(p_full_name),
             phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
             license_number = trim(p_license_number),
             license_expiration_date =
               coalesce(p_license_expiration_date, license_expiration_date)
       where id = p_crew_id and operator_id = p_operator_id and user_id is null
      returning id into v_crew_id;

      if v_crew_id is null then
        raise exception 'NOT_FOUND';
      end if;
    else
      insert into public.drivers (
        operator_id, user_id, license_number, name, phone, license_expiration_date
      )
      values (
        p_operator_id, p_user_id, trim(p_license_number), trim(p_full_name),
        nullif(trim(coalesce(p_phone, '')), ''), p_license_expiration_date
      )
      returning id into v_crew_id;
    end if;

  elsif p_role = 'ASSISTANT' then
    if p_crew_id is not null then
      update public.assistants
         set user_id = p_user_id,
             name = trim(p_full_name),
             phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone)
       where id = p_crew_id and operator_id = p_operator_id and user_id is null
      returning id into v_crew_id;

      if v_crew_id is null then
        raise exception 'NOT_FOUND';
      end if;
    else
      insert into public.assistants (operator_id, user_id, name, phone)
      values (
        p_operator_id, p_user_id, trim(p_full_name),
        nullif(trim(coalesce(p_phone, '')), '')
      )
      returning id into v_crew_id;
    end if;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'STAFF_ACCOUNT_PROVISIONED', 'profile', p_user_id,
    jsonb_build_object(
      'role', p_role,
      'operatorId', p_operator_id,
      'crewId', v_crew_id,
      'linkedExistingRecord', p_crew_id is not null
    )
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'role', p_role,
    'operatorId', p_operator_id,
    'crewId', v_crew_id
  );
end;
$$;

revoke all on function public.provision_staff_account(
  uuid, public.user_role, uuid, text, text, text, date, uuid
) from public, anon;
grant execute on function public.provision_staff_account(
  uuid, public.user_role, uuid, text, text, text, date, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- create_crew_member
--
-- A crew record with no login — somebody on the roster who does not use the
-- app. This is what `operatorService.addDriver` used to do with a direct
-- INSERT; it keeps working, it is now audited, and an account can be attached
-- later through `provision_staff_account`'s `p_crew_id`.
-- ---------------------------------------------------------------------------

create or replace function public.create_crew_member(
  p_kind text,
  p_name text,
  p_phone text default null,
  p_license_number text default null,
  p_license_expiration_date date default null,
  -- Admins act on any operator; an operator always acts on their own.
  p_operator_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_operator_id uuid := coalesce(p_operator_id, public.current_operator_id());
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_kind not in ('DRIVER', 'ASSISTANT') or coalesce(trim(p_name), '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  if v_operator_id is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if p_kind = 'DRIVER' then
    if coalesce(trim(coalesce(p_license_number, '')), '') = '' then
      raise exception 'VALIDATION_ERROR';
    end if;

    insert into public.drivers (operator_id, name, phone, license_number, license_expiration_date)
    values (
      v_operator_id, trim(p_name), nullif(trim(coalesce(p_phone, '')), ''),
      trim(p_license_number), p_license_expiration_date
    )
    returning id into v_id;
  else
    insert into public.assistants (operator_id, name, phone)
    values (v_operator_id, trim(p_name), nullif(trim(coalesce(p_phone, '')), ''))
    returning id into v_id;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'CREW_CREATED', lower(p_kind), v_id,
    jsonb_build_object('operatorId', v_operator_id, 'name', trim(p_name), 'hasAccount', false)
  );

  return jsonb_build_object('id', v_id, 'kind', p_kind, 'operatorId', v_operator_id);
end;
$$;

revoke all on function public.create_crew_member(text, text, text, text, date, uuid)
  from public, anon;
grant execute on function public.create_crew_member(text, text, text, text, date, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_crew_member
-- ---------------------------------------------------------------------------

create or replace function public.update_crew_member(
  p_kind text,
  p_crew_id uuid,
  p_name text,
  p_phone text default null,
  p_license_number text default null,
  p_license_expiration_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_operator_id uuid;
  v_user_id uuid;
  v_before jsonb;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_kind not in ('DRIVER', 'ASSISTANT') or coalesce(trim(p_name), '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  if p_kind = 'DRIVER' then
    select operator_id, user_id,
           jsonb_build_object(
             'name', name, 'phone', phone,
             'licenseNumber', license_number,
             'licenseExpirationDate', license_expiration_date
           )
      into v_operator_id, v_user_id, v_before
      from public.drivers where id = p_crew_id for update;
  else
    select operator_id, user_id, jsonb_build_object('name', name, 'phone', phone)
      into v_operator_id, v_user_id, v_before
      from public.assistants where id = p_crew_id for update;
  end if;

  if v_operator_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if p_kind = 'DRIVER' then
    if coalesce(trim(coalesce(p_license_number, '')), '') = '' then
      raise exception 'VALIDATION_ERROR';
    end if;

    update public.drivers
       set name = trim(p_name),
           phone = nullif(trim(coalesce(p_phone, '')), ''),
           license_number = trim(p_license_number),
           license_expiration_date = p_license_expiration_date
     where id = p_crew_id;
  else
    update public.assistants
       set name = trim(p_name),
           phone = nullif(trim(coalesce(p_phone, '')), '')
     where id = p_crew_id;
  end if;

  -- The person's own profile name follows the crew record, so the manifest and
  -- the app do not disagree about who is driving.
  if v_user_id is not null then
    update public.profiles set full_name = trim(p_name) where id = v_user_id;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'CREW_UPDATED', lower(p_kind), p_crew_id,
    jsonb_build_object('before', v_before, 'after', jsonb_build_object(
      'name', trim(p_name),
      'phone', nullif(trim(coalesce(p_phone, '')), ''),
      'licenseNumber', nullif(trim(coalesce(p_license_number, '')), ''),
      'licenseExpirationDate', p_license_expiration_date
    ))
  );

  return jsonb_build_object('id', p_crew_id, 'kind', p_kind);
end;
$$;

revoke all on function public.update_crew_member(text, uuid, text, text, text, date)
  from public, anon;
grant execute on function public.update_crew_member(text, uuid, text, text, text, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- set_crew_availability
--
-- The rest-day switch. It touches nothing about signing in, and nothing about
-- the trips this person already has — an assignment made yesterday stands;
-- what changes is eligibility for the next one.
-- ---------------------------------------------------------------------------

create or replace function public.set_crew_availability(
  p_kind text,
  p_crew_id uuid,
  p_status public.availability_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_operator_id uuid;
  v_before public.availability_status;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_kind not in ('DRIVER', 'ASSISTANT') then
    raise exception 'VALIDATION_ERROR';
  end if;

  if p_kind = 'DRIVER' then
    select operator_id, availability_status into v_operator_id, v_before
      from public.drivers where id = p_crew_id for update;
  else
    select operator_id, availability_status into v_operator_id, v_before
      from public.assistants where id = p_crew_id for update;
  end if;

  if v_operator_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if v_before = p_status then
    return jsonb_build_object('id', p_crew_id, 'availabilityStatus', p_status, 'changed', false);
  end if;

  if p_kind = 'DRIVER' then
    update public.drivers
       set availability_status = p_status,
           unavailable_reason =
             case when p_status = 'UNAVAILABLE'
               then nullif(trim(coalesce(p_reason, '')), '') else null end
     where id = p_crew_id;
  else
    update public.assistants
       set availability_status = p_status,
           unavailable_reason =
             case when p_status = 'UNAVAILABLE'
               then nullif(trim(coalesce(p_reason, '')), '') else null end
     where id = p_crew_id;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'CREW_AVAILABILITY_CHANGED', lower(p_kind), p_crew_id,
    jsonb_build_object('before', v_before, 'after', p_status, 'reason', p_reason)
  );

  return jsonb_build_object('id', p_crew_id, 'availabilityStatus', p_status, 'changed', true);
end;
$$;

revoke all on function public.set_crew_availability(
  text, uuid, public.availability_status, text
) from public, anon;
grant execute on function public.set_crew_availability(
  text, uuid, public.availability_status, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- set_account_status
--
-- The door. Deactivating deletes nothing — trips driven, tickets scanned and
-- assignments held all stay exactly where they are, which is the point of doing
-- it this way rather than removing the account.
--
-- Two guards worth naming:
--   * nobody may deactivate their own account. An admin who did would lock the
--     platform's only way back in.
--   * only an admin may touch an ADMIN, OPERATOR or passenger account. An
--     operator's reach stops at their own drivers and assistants.
--
-- The Edge Function pairs this with an auth ban so a session that is already
-- open dies now rather than at its next refresh. This function is still the
-- authority: the ban is belt and braces, and RLS answers "no" either way.
-- ---------------------------------------------------------------------------

create or replace function public.set_account_status(
  p_user_id uuid,
  p_status public.account_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_target public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_user_id = v_actor then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_target.role in ('ADMIN', 'OPERATOR', 'USER') then
    if not public.is_admin() then
      raise exception 'FORBIDDEN';
    end if;
  elsif not (public.is_admin() or public.can_manage_operator(v_target.operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if v_target.account_status = p_status then
    return jsonb_build_object('userId', p_user_id, 'accountStatus', p_status, 'changed', false);
  end if;

  update public.profiles
     set account_status = p_status,
         deactivated_at = case when p_status = 'INACTIVE' then now() else null end,
         deactivated_by = case when p_status = 'INACTIVE' then v_actor else null end
   where id = p_user_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    case when p_status = 'INACTIVE' then 'ACCOUNT_DEACTIVATED' else 'ACCOUNT_ACTIVATED' end,
    'profile', p_user_id,
    jsonb_build_object('role', v_target.role, 'operatorId', v_target.operator_id, 'reason', p_reason)
  );

  return jsonb_build_object('userId', p_user_id, 'accountStatus', p_status, 'changed', true);
end;
$$;

revoke all on function public.set_account_status(uuid, public.account_status, text)
  from public, anon;
grant execute on function public.set_account_status(uuid, public.account_status, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- mark_password_changed
--
-- Called by the account holder after they have actually set a new password
-- through supabase.auth.updateUser. It clears only their own flag — there is no
-- p_user_id argument on purpose, so it cannot be aimed at anyone else.
-- ---------------------------------------------------------------------------

create or replace function public.mark_password_changed()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  update public.profiles set must_change_password = false where id = v_user_id;

  return jsonb_build_object('mustChangePassword', false);
end;
$$;

revoke all on function public.mark_password_changed() from public, anon;
grant execute on function public.mark_password_changed() to authenticated;

-- ---------------------------------------------------------------------------
-- staff_activity
--
-- "View operator activity" from the brief, without opening `audit_logs` to
-- anyone but an admin — the table records everyone's actions, and a policy that
-- let an operator read the rows "about" them would still disclose who acted on
-- them and when. Bounded slice, admin only.
-- ---------------------------------------------------------------------------

create or replace function public.staff_activity(p_user_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select al.id, al.action, al.entity_type, al.entity_id, al.metadata, al.created_at
        from public.audit_logs al
       where al.actor_user_id = p_user_id
          or (al.entity_type = 'profile' and al.entity_id = p_user_id)
       order by al.created_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x;

  return v_rows;
end;
$$;

revoke all on function public.staff_activity(uuid, integer) from public, anon;
grant execute on function public.staff_activity(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- operator_dashboard, patched
--
-- The crew tiles counted `status = 'ACTIVE'`, a column that no longer exists.
-- They now count availability, and the keys are renamed to say so: "active"
-- would be ambiguous between the two statuses this migration just separated.
--
-- Extracted from the live definition and patched at two anchors rather than
-- retyped, so the day's totals, the on-time percentage and the average delay
-- come through exactly as they were. The bus count on the line above uses the
-- same `status = 'ACTIVE'` literal and is deliberately untouched — `buses`
-- still has that column.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.operator_dashboard(p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_operator uuid := public.current_operator_id();
  v_is_admin boolean := public.is_admin();
  v_role public.user_role := public.current_profile_role();
  -- A bus is "on time" if it left within this many minutes of schedule.
  -- Mirrored by ON_TIME_GRACE_MINUTES in src/constants/config.ts.
  v_grace constant int := 15;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_operator is null then
    if v_is_admin then
      return jsonb_build_object('scope', 'NO_OPERATOR', 'date', p_date);
    end if;
    raise exception 'FORBIDDEN';
  end if;

  if v_role not in ('OPERATOR', 'DRIVER', 'ASSISTANT', 'ADMIN') then
    raise exception 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'scope', 'OPERATOR',
    'date', p_date,
    'operatorId', v_operator,
    'today', jsonb_build_object(
      'trips', count(*),
      'passengers', coalesce(sum(o.passenger_count), 0),
      'boarded', coalesce(sum(o.boarded_count), 0),
      'seatsBooked', coalesce(sum(o.seats_booked), 0),
      'capacity', coalesce(sum(o.capacity), 0),
      'revenue', coalesce(sum(o.revenue), 0),
      'scheduled', count(*) filter (where o.status = 'SCHEDULED'),
      'boarding', count(*) filter (where o.status = 'BOARDING'),
      'inTransit', count(*) filter (where o.status in ('DEPARTED', 'ON_TRIP')),
      'completed', count(*) filter (where o.status in ('ARRIVED', 'COMPLETED')),
      'cancelled', count(*) filter (where o.status = 'CANCELLED'),
      'unassigned', count(*) filter (where o.driver_id is null),
      -- Real figures now, from two recorded timestamps.
      'departed', count(*) filter (where o.actual_departure_at is not null),
      'onTimeGraceMinutes', v_grace,
      'onTime', case
        when count(*) filter (where o.actual_departure_at is not null) = 0 then null
        else round(
          100.0
            * count(*) filter (where o.departure_delay_minutes <= v_grace)
            / count(*) filter (where o.actual_departure_at is not null)
        )
      end,
      'avgDelayMinutes', (
        select round(avg(o2.departure_delay_minutes))
        from public.operator_trip_overview o2
        where o2.departure_date = p_date and o2.actual_departure_at is not null
      )
    )
  )
  into v_result
  from public.operator_trip_overview o
  where o.departure_date = p_date;

  v_result := v_result || jsonb_build_object(
    'fleet', jsonb_build_object(
      'buses', (select count(*) from public.buses where operator_id = v_operator),
      'activeBuses', (select count(*) from public.buses
                       where operator_id = v_operator and status = 'ACTIVE')
    ),
    'crew', jsonb_build_object(
      'drivers', (select count(*) from public.drivers where operator_id = v_operator),
      'availableDrivers', (select count(*) from public.drivers
                            where operator_id = v_operator
                              and availability_status = 'AVAILABLE'),
      'assistants', (select count(*) from public.assistants where operator_id = v_operator),
      'availableAssistants', (select count(*) from public.assistants
                               where operator_id = v_operator
                                 and availability_status = 'AVAILABLE')
    )
  );

  return v_result;
end;
$function$;

revoke all on function public.operator_dashboard(date) from public, anon;
grant execute on function public.operator_dashboard(date) to authenticated;

-- ---------------------------------------------------------------------------
-- authorize_staff_manage / flag_password_reset
--
-- Resetting somebody's password is the same reach as deactivating them, so it
-- asks the same question. It is a separate function rather than a no-op call to
-- `set_account_status` because that one would *reactivate* a deactivated
-- account as a side effect of being asked, and refuses to act on the caller's
-- own row — neither of which is what a password reset means.
--
-- Nobody may reset their own password this way: that is `updateUser` in the
-- app, which requires knowing the current session, not an administrative act.
-- ---------------------------------------------------------------------------

create or replace function public.authorize_staff_manage(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_target public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_user_id = v_actor then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_target.role in ('ADMIN', 'OPERATOR', 'USER') then
    if not public.is_admin() then
      raise exception 'FORBIDDEN';
    end if;
  elsif not (public.is_admin() or public.can_manage_operator(v_target.operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'userId', p_user_id,
    'role', v_target.role,
    'operatorId', v_target.operator_id,
    'accountStatus', v_target.account_status
  );
end;
$$;

revoke all on function public.authorize_staff_manage(uuid) from public, anon;
grant execute on function public.authorize_staff_manage(uuid) to authenticated;

create or replace function public.flag_password_reset(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  perform public.authorize_staff_manage(p_user_id);

  update public.profiles set must_change_password = true where id = p_user_id;

  -- The password itself is never recorded, here or anywhere. What is recorded
  -- is that somebody reset it, and who.
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'STAFF_PASSWORD_RESET', 'profile', p_user_id, '{}'::jsonb);

  return jsonb_build_object('userId', p_user_id, 'mustChangePassword', true);
end;
$$;

revoke all on function public.flag_password_reset(uuid) from public, anon;
grant execute on function public.flag_password_reset(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A deactivated account stops being anybody
--
-- The helpers above cover every policy that resolves through
-- `current_operator_id()`, `current_driver_id()` or `is_admin()`. They do not
-- cover the ones that ask "is this row mine?" by testing `auth.uid()` directly
-- — and a token issued a minute before the deactivation is still
-- syntactically valid for up to an hour, so those policies kept answering.
-- A deactivated driver could still read their own crew record.
--
-- `active_uid()` is `auth.uid()` for an account that may sign in, and NULL for
-- one that may not. Every such policy is rewritten to use it, generated from
-- the live catalogue rather than retyped: there are nineteen of them across
-- eleven migrations, and retyping is how a policy quietly loses a clause.
--
-- The one exception is reading your own profile. That stays open on purpose,
-- so the app can load the account and say why it has stopped working instead
-- of showing an empty screen.
-- ---------------------------------------------------------------------------

drop policy "Operators read their own assistants" on public.assistants;
create policy "Operators read their own assistants"
  on public.assistants for select
  to authenticated
  using (((operator_id = current_operator_id()) OR (user_id = public.active_uid()) OR is_admin()));

drop policy "Users read their own booking passengers" on public.booking_passengers;
create policy "Users read their own booking passengers"
  on public.booking_passengers for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_passengers.booking_id) AND ((b.user_id = public.active_uid()) OR is_admin() OR (EXISTS ( SELECT 1
           FROM trips t
          WHERE ((t.id = b.trip_id) AND (t.operator_id = current_operator_id())))))))));

drop policy "Users read their own bookings" on public.bookings;
create policy "Users read their own bookings"
  on public.bookings for select
  to authenticated
  using (((user_id = public.active_uid()) OR is_admin() OR (EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = bookings.trip_id) AND (t.operator_id = current_operator_id()))))));

drop policy "Passengers read their own eligibility submissions" on public.discount_eligibilities;
create policy "Passengers read their own eligibility submissions"
  on public.discount_eligibilities for select
  to authenticated
  using (((user_id = public.active_uid()) OR (current_profile_role() = ANY (ARRAY['OPERATOR'::user_role, 'ADMIN'::user_role]))));

drop policy "Operators read their own drivers" on public.drivers;
create policy "Operators read their own drivers"
  on public.drivers for select
  to authenticated
  using (((operator_id = current_operator_id()) OR (user_id = public.active_uid()) OR is_admin()));

drop policy "Users read their own points" on public.loyalty_accounts;
create policy "Users read their own points"
  on public.loyalty_accounts for select
  to authenticated
  using (((user_id = public.active_uid()) OR is_admin()));

drop policy "Users read their own points ledger" on public.loyalty_transactions;
create policy "Users read their own points ledger"
  on public.loyalty_transactions for select
  to authenticated
  using (((user_id = public.active_uid()) OR is_admin()));

drop policy "Users mark their own notifications read" on public.notifications;
create policy "Users mark their own notifications read"
  on public.notifications for update
  to authenticated
  using ((user_id = public.active_uid()))
  with check ((user_id = public.active_uid()));

drop policy "Users read their own notifications" on public.notifications;
create policy "Users read their own notifications"
  on public.notifications for select
  to authenticated
  using (((user_id = public.active_uid()) OR is_admin()));

drop policy "Users read transactions for their own payments" on public.payment_transactions;
create policy "Users read transactions for their own payments"
  on public.payment_transactions for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM (payments p
     JOIN bookings b ON ((b.id = p.booking_id)))
  WHERE ((p.id = payment_transactions.payment_id) AND ((b.user_id = public.active_uid()) OR is_admin())))));

drop policy "Users read payments for their own bookings" on public.payments;
create policy "Users read payments for their own bookings"
  on public.payments for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = payments.booking_id) AND ((b.user_id = public.active_uid()) OR is_admin() OR (EXISTS ( SELECT 1
           FROM trips t
          WHERE ((t.id = b.trip_id) AND (t.operator_id = current_operator_id())))))))));

drop policy "Users update their own profile" on public.profiles;
create policy "Users update their own profile"
  on public.profiles for update
  to authenticated
  using ((public.active_uid() = id))
  with check ((public.active_uid() = id));

drop policy "Users read their own devices" on public.push_tokens;
create policy "Users read their own devices"
  on public.push_tokens for select
  to authenticated
  using ((user_id = public.active_uid()));

drop policy "Operators read scans for their own trips" on public.qr_scans;
create policy "Operators read scans for their own trips"
  on public.qr_scans for select
  to authenticated
  using ((is_admin() OR (operator_user_id = public.active_uid()) OR (EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = qr_scans.trip_id) AND (t.operator_id = current_operator_id()))))));

drop policy "Users read receipts for their own bookings" on public.receipts;
create policy "Users read receipts for their own bookings"
  on public.receipts for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = receipts.booking_id) AND ((b.user_id = public.active_uid()) OR is_admin() OR (EXISTS ( SELECT 1
           FROM trips t
          WHERE ((t.id = b.trip_id) AND (t.operator_id = current_operator_id())))))))));

drop policy "Users read their own redemptions" on public.reward_redemptions;
create policy "Users read their own redemptions"
  on public.reward_redemptions for select
  to authenticated
  using (((user_id = public.active_uid()) OR is_admin()));

drop policy "Passengers and responders read relevant SOS incidents" on public.sos_incidents;
create policy "Passengers and responders read relevant SOS incidents"
  on public.sos_incidents for select
  to authenticated
  using (((user_id = public.active_uid()) OR can_manage_sos(trip_id)));

drop policy "Users read their own wallet ledger" on public.wallet_transactions;
create policy "Users read their own wallet ledger"
  on public.wallet_transactions for select
  to authenticated
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM wallets w
  WHERE ((w.id = wallet_transactions.wallet_id) AND (w.user_id = public.active_uid()))))));

drop policy "Users read their own wallet" on public.wallets;
create policy "Users read their own wallet"
  on public.wallets for select
  to authenticated
  using (((user_id = public.active_uid()) OR is_admin()));
