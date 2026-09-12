-- Staff write scope: drivers and assistants are not operator managers.
--
-- Every write policy on an operator's own data used to ask one question —
-- "does this row belong to the caller's operator?" — through
-- `current_operator_id()`. But drivers and assistants carry an operator id too
-- (it is how crew are scoped to a company), so the answer was yes for them as
-- well. Checked on the local stack, signed in as driver@palago.test:
--
--   * `update trips set fare = 1`            — accepted. A ₱700 fare became ₱0.01.
--   * `update trips set status = 'COMPLETED'` — accepted, skipping end_trip, so
--                                               bookings were never completed and
--                                               no loyalty points were awarded.
--   * `update trip_assignments set status = 'CANCELLED'` — accepted.
--
-- The last one matters beyond itself: `can_manage_trip_status`,
-- `can_publish_location`, `can_manage_sos` and (from the next migration)
-- `can_scan_trip` all trust assignments. A driver who can write assignments can
-- make every one of those checks say yes.
--
-- The fix is one question, asked everywhere: is the caller an OPERATOR-role
-- account of this operator? Reading is untouched — crew still need to see their
-- trips, buses and colleagues.
--
-- And separately, trip status and the actual departure/arrival times become
-- unwritable from any client, admin included. AGENTS.md already said trip
-- status goes through set_trip_boarding / start_trip / end_trip; the table
-- privileges never enforced it.

create or replace function public.can_manage_operator(p_operator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce, because a NULL here inside an `if not …` never raises (see
  -- AGENTS.md on nullable comparisons in authorisation checks).
  select coalesce(
    p_operator_id is not null
      and public.current_profile_role() = 'OPERATOR'
      and p_operator_id = public.current_operator_id(),
    false
  );
$$;

revoke all on function public.can_manage_operator(uuid) from public, anon;
grant execute on function public.can_manage_operator(uuid) to authenticated;

comment on function public.can_manage_operator(uuid) is
  'True for an OPERATOR-role account of this operator. Drivers and assistants carry an operator id but are not managers.';

-- ---------------------------------------------------------------------------
-- The eight policies. Same shape as before; only the ownership test changes.
-- ---------------------------------------------------------------------------

drop policy "Operators write their own trips" on public.trips;
create policy "Operators write their own trips"
  on public.trips for all to authenticated
  using (public.can_manage_operator(operator_id) or public.is_admin())
  with check (public.can_manage_operator(operator_id) or public.is_admin());

drop policy "Operators write their own buses" on public.buses;
create policy "Operators write their own buses"
  on public.buses for all to authenticated
  using (public.can_manage_operator(operator_id) or public.is_admin())
  with check (public.can_manage_operator(operator_id) or public.is_admin());

drop policy "Operators write their own seat layouts" on public.bus_seats;
create policy "Operators write their own seat layouts"
  on public.bus_seats for all to authenticated
  using (
    exists (
      select 1 from public.buses b
      where b.id = bus_id and (public.can_manage_operator(b.operator_id) or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.buses b
      where b.id = bus_id and (public.can_manage_operator(b.operator_id) or public.is_admin())
    )
  );

drop policy "Operators write their own routes" on public.routes;
create policy "Operators write their own routes"
  on public.routes for all to authenticated
  using (public.can_manage_operator(operator_id) or public.is_admin())
  with check (public.can_manage_operator(operator_id) or public.is_admin());

drop policy "Operators write their own drivers" on public.drivers;
create policy "Operators write their own drivers"
  on public.drivers for all to authenticated
  using (public.can_manage_operator(operator_id) or public.is_admin())
  with check (public.can_manage_operator(operator_id) or public.is_admin());

drop policy "Operators write their own assistants" on public.assistants;
create policy "Operators write their own assistants"
  on public.assistants for all to authenticated
  using (public.can_manage_operator(operator_id) or public.is_admin())
  with check (public.can_manage_operator(operator_id) or public.is_admin());

drop policy "Operators write their own assignments" on public.trip_assignments;
create policy "Operators write their own assignments"
  on public.trip_assignments for all to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and public.can_manage_operator(t.operator_id)
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and public.can_manage_operator(t.operator_id)
    )
  );

drop policy "Operators update their own record" on public.operators;
create policy "Operators update their own record"
  on public.operators for update to authenticated
  using (public.can_manage_operator(id))
  with check (public.can_manage_operator(id));

-- ---------------------------------------------------------------------------
-- Trip status is the functions' to decide
--
-- Column privileges rather than a trigger: a revoked column fails before the
-- row is touched, for every role, with nothing to forget to call. The
-- SECURITY DEFINER trip functions run as the table owner and are unaffected.
-- ---------------------------------------------------------------------------

revoke insert, update on public.trips from anon, authenticated;

grant insert (
  id, operator_id, route_id, bus_id, trip_number,
  departure_date, departure_time, arrival_time, fare
) on public.trips to authenticated;

-- Not operator_id (moving a trip to another company), not status, not the
-- actual times, which are recorded by start_trip / end_trip.
grant update (
  route_id, bus_id, trip_number, departure_date, departure_time, arrival_time, fare
) on public.trips to authenticated;
