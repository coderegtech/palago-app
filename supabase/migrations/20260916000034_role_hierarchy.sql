-- ---------------------------------------------------------------------------
-- The role hierarchy, named for what each role actually does.
--
--   ADMIN     -> SUPER_ADMIN     runs the platform and owns the operators
--   OPERATOR  -> OPERATOR_ADMIN  runs one bus company's day-to-day operations
--   ASSISTANT -> CREW            rides the bus alongside the driver
--   DRIVER, USER                 unchanged
--
-- `alter type ... rename value` keeps each label's identity, so every existing
-- profile, booking and audit row keeps the role it had. Nothing is migrated and
-- nothing can be lost — which is the point, because this database holds real
-- bookings and the rename is cosmetic to Postgres and load-bearing to people.
--
-- What a rename does NOT do is touch function bodies. A literal like
-- `'ADMIN'::user_role` inside plpgsql is resolved when the function runs, so
-- after the rename every one of them would raise "invalid input value for enum"
-- at the worst possible moment. The twelve functions below are therefore
-- reinstated here, extracted verbatim from the live database and patched, not
-- rewritten from memory — the technique this repo settled on after `reserve_seats`
-- was rewritten by hand and quietly lost its deadlock guard.
--
-- Two kinds of literal look identical and are not:
--
--   * A ROLE. `p_role`, `current_profile_role()`, `profiles.role`. Renamed.
--   * A CREW KIND. `p_kind in ('DRIVER', 'ASSISTANT')` selects which table a
--     crew member lives in. The `assistants` table keeps its name — renaming a
--     table that eight verify suites and a dozen policies join against buys
--     nothing — but these functions now accept 'CREW' as well and normalise it,
--     so the client can speak one vocabulary end to end.
--
-- And one that is neither: `operator_dashboard` returns `'scope', 'OPERATOR'`,
-- a tag saying "these figures are for one operator" as opposed to
-- 'NO_OPERATOR'. `operator-service.ts` types it and `verify-operator` asserts
-- it. Left exactly as it was, deliberately.
-- ---------------------------------------------------------------------------

alter type public.user_role rename value 'ADMIN' to 'SUPER_ADMIN';
alter type public.user_role rename value 'OPERATOR' to 'OPERATOR_ADMIN';
alter type public.user_role rename value 'ASSISTANT' to 'CREW';

-- ---------------------------------------------------------------------------
-- Functions whose bodies name a role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.authorize_staff_manage(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v_target.role in ('SUPER_ADMIN', 'OPERATOR_ADMIN', 'USER') then
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
$function$;

CREATE OR REPLACE FUNCTION public.authorize_staff_provision(p_role user_role, p_operator_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_role not in ('OPERATOR_ADMIN', 'DRIVER', 'CREW') then
    raise exception 'FORBIDDEN';
  end if;

  if p_operator_id is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not exists (select 1 from public.operators where id = p_operator_id) then
    raise exception 'NOT_FOUND';
  end if;

  if p_role = 'OPERATOR_ADMIN' then
    -- An operator creating another operator is exactly what the brief forbids.
    if not public.is_admin() then
      raise exception 'FORBIDDEN';
    end if;
  elsif not (public.is_admin() or public.can_manage_operator(p_operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object('allowed', true, 'role', p_role, 'operatorId', p_operator_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_operator(p_operator_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- coalesce, because a NULL here inside an `if not …` never raises (see
  -- AGENTS.md on nullable comparisons in authorisation checks).
  select coalesce(
    p_operator_id is not null
      and public.current_profile_role() = 'OPERATOR_ADMIN'
      and p_operator_id = public.current_operator_id(),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_trip_status(p_trip_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    public.is_admin()
    or exists (
      select 1 from public.trips t
      where t.id = p_trip_id
        and t.operator_id = public.current_operator_id()
        and public.current_profile_role() = 'OPERATOR_ADMIN'
    )
    or exists (
      select 1 from public.trip_assignments ta
      where ta.trip_id = p_trip_id
        and ta.driver_id = public.current_driver_id()
        and ta.status <> 'CANCELLED'
    );
$function$;

CREATE OR REPLACE FUNCTION public.create_crew_member(p_kind text, p_name text, p_phone text DEFAULT NULL::text, p_license_number text DEFAULT NULL::text, p_license_expiration_date date DEFAULT NULL::date, p_operator_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_operator_id uuid := coalesce(p_operator_id, public.current_operator_id());
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_kind = 'CREW' then p_kind := 'ASSISTANT'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'SUPER_ADMIN'
      and account_status = 'ACTIVE'
  );
$function$;

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

  if v_role not in ('OPERATOR_ADMIN', 'DRIVER', 'CREW', 'SUPER_ADMIN') then
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

CREATE OR REPLACE FUNCTION public.provision_staff_account(p_user_id uuid, p_role user_role, p_operator_id uuid, p_full_name text, p_phone text DEFAULT NULL::text, p_license_number text DEFAULT NULL::text, p_license_expiration_date date DEFAULT NULL::date, p_crew_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  elsif p_role = 'CREW' then
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
$function$;

CREATE OR REPLACE FUNCTION public.review_discount_eligibility(p_id uuid, p_approve boolean, p_note text DEFAULT NULL::text, p_expires_at date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_row public.discount_eligibilities%rowtype;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if public.current_profile_role() not in ('OPERATOR_ADMIN', 'SUPER_ADMIN') then
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
$function$;

CREATE OR REPLACE FUNCTION public.set_account_status(p_user_id uuid, p_status account_status, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v_target.role in ('SUPER_ADMIN', 'OPERATOR_ADMIN', 'USER') then
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
$function$;

CREATE OR REPLACE FUNCTION public.set_crew_availability(p_kind text, p_crew_id uuid, p_status availability_status, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_operator_id uuid;
  v_before public.availability_status;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_kind = 'CREW' then p_kind := 'ASSISTANT'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.update_crew_member(p_kind text, p_crew_id uuid, p_name text, p_phone text DEFAULT NULL::text, p_license_number text DEFAULT NULL::text, p_license_expiration_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_operator_id uuid;
  v_user_id uuid;
  v_before jsonb;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_kind = 'CREW' then p_kind := 'ASSISTANT'; end if;
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
$function$;

-- ---------------------------------------------------------------------------
-- Policies that name a role
--
-- Both ask the same question — "is this person staff?" — and both were written
-- before `active_uid()` existed, so they are reinstated with the renamed labels
-- and nothing else changed.
-- ---------------------------------------------------------------------------

drop policy if exists "Passengers read their own eligibility submissions" on public.discount_eligibilities;
create policy "Passengers read their own eligibility submissions"
  on public.discount_eligibilities for select to authenticated
  using (
    user_id = public.active_uid()
    or public.current_profile_role() = any (array['OPERATOR_ADMIN'::public.user_role, 'SUPER_ADMIN'::public.user_role])
  );

-- The proof bucket holds photographs of government IDs. Same rule, same shape.
drop policy if exists "Owners and reviewers read proofs" on storage.objects;
create policy "Owners and reviewers read proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'discount-proofs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.current_profile_role() = any (array['OPERATOR_ADMIN'::public.user_role, 'SUPER_ADMIN'::public.user_role])
    )
  );

-- ---------------------------------------------------------------------------
-- operator_crew now speaks the new vocabulary
--
-- `crew_kind` is what the console filters on. It emitted 'ASSISTANT'; it emits
-- 'CREW'. One script filtered on the old value and is updated with it.
-- The view keeps owner rights and keeps its WHERE clause — that clause is the
-- entire operator boundary, and Phase 13 tests it directly.
-- ---------------------------------------------------------------------------

create or replace view public.operator_crew as
SELECT d.id,
    'DRIVER'::text AS crew_kind,
    d.operator_id,
    d.user_id,
    d.name,
    d.phone,
    d.license_number,
    d.license_expiration_date,
    d.availability_status,
    d.unavailable_reason,
    d.user_id IS NOT NULL AS has_account,
    p.email AS account_email,
    p.account_status,
    p.must_change_password,
    d.created_at,
    d.updated_at
   FROM drivers d
     LEFT JOIN profiles p ON p.id = d.user_id
  WHERE d.operator_id = current_operator_id() OR d.user_id = active_uid() OR is_admin()
UNION ALL
 SELECT a.id,
    'CREW'::text AS crew_kind,
    a.operator_id,
    a.user_id,
    a.name,
    a.phone,
    NULL::text AS license_number,
    NULL::date AS license_expiration_date,
    a.availability_status,
    a.unavailable_reason,
    a.user_id IS NOT NULL AS has_account,
    p.email AS account_email,
    p.account_status,
    p.must_change_password,
    a.created_at,
    a.updated_at
   FROM assistants a
     LEFT JOIN profiles p ON p.id = a.user_id
  WHERE a.operator_id = current_operator_id() OR a.user_id = active_uid() OR is_admin();
