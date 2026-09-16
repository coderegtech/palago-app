-- ---------------------------------------------------------------------------
-- Phase 13 — closing three write paths the schedule work left open.
--
-- 20260915000031_schedules.sql introduced create_trip / update_trip /
-- cancel_trip / assign_trip_crew / unassign_trip_crew as the authorised way to
-- touch a schedule, and revoked `insert, update` on public.trips to force
-- callers through them. Two things were missed, and a third predates it. All
-- three were confirmed against the running stack as a signed-in operator, not
-- reasoned about:
--
--   1. DELETE on public.trips was never revoked. The "Operators write their own
--      trips" policy is FOR ALL, and ALL includes DELETE, so an operator could
--      hard-delete their own trip. `bookings.trip_id` is ON DELETE RESTRICT, so
--      a sold trip is safe — but an unsold one went, and took its
--      `trip_assignments`, `trip_seats` and `bus_locations` with it by CASCADE
--      while detaching `qr_scans` and `sos_incidents` by SET NULL. That is the
--      GPS trail, the crew record and the link from an emergency to the trip it
--      happened on. "Reference data has no delete, for anyone" was already the
--      rule; only the grant disagreed.
--
--   2. INSERT / UPDATE / DELETE on public.trip_assignments were never revoked
--      either, and that policy is also FOR ALL. Its USING clause asks only
--      `can_manage_operator(t.operator_id)` — whether the caller manages the
--      *trip's* operator. It says nothing about the driver. So Cherry Bus could
--      insert a row putting a RoRo Bus driver on a Cherry trip, which is
--      exactly what the specification forbids: one operator must never reach
--      another operator's employees. Proven by doing it.
--
--      The same direct insert skips every validation in `assign_trip_crew`:
--      account ACTIVE, availability AVAILABLE, same operator, licence not
--      expired. Only the exclusion constraint survived, because a constraint
--      cannot be bypassed by choosing a different code path — which is the
--      argument for constraints over checks, again.
--
--   3. bus_seats carried FOR ALL writes from Phase 3. `create_bus` builds a
--      coach and its seat layout together, and nothing in `src/` has ever
--      written the table, so the grant bought nothing. A seat already sold is
--      held by a foreign key, but a layout could still be edited out from under
--      a coach that had not sold yet.
--
-- The fix is the same shape in all three cases and the one this codebase
-- already uses elsewhere: withdraw the grant, and drop the FOR ALL policy so
-- that the *policy* states the intent rather than leaving it to an invisible
-- grant. Every RPC above is SECURITY DEFINER and none of these tables is FORCE
-- RLS, so the authorised paths are untouched.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. trips — no client writes at all, delete included
-- ---------------------------------------------------------------------------

revoke delete on public.trips from anon, authenticated;

-- The read half is already covered by "Signed-in users read trips", which trip
-- search needs. This policy's only remaining effect was to permit the delete.
drop policy if exists "Operators write their own trips" on public.trips;

-- ---------------------------------------------------------------------------
-- 2. trip_assignments — assign_trip_crew / unassign_trip_crew are the only path
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.trip_assignments from anon, authenticated;

drop policy if exists "Operators write their own assignments" on public.trip_assignments;

-- "Operators and assigned crew read assignments" stays: the operator console
-- lists a trip's crew, and a driver has to see their own roster.

-- ---------------------------------------------------------------------------
-- 3. bus_seats — the layout arrives with the coach, from create_bus
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.bus_seats from anon, authenticated;

drop policy if exists "Operators write their own seat layouts" on public.bus_seats;

-- "Signed-in users read seat layouts" stays: the seat map is how a passenger
-- picks a seat.

-- ---------------------------------------------------------------------------
-- 4. Two lifecycle RPCs were callable without signing in
--
-- `start_trip` and `set_trip_boarding` both authorise through
-- `can_manage_trip_status`, which answers false for an anonymous caller, so
-- this was not exploitable. It was still an unauthenticated entry point that
-- did not need to exist, and every other privileged function in this schema is
-- revoked from `public, anon` on the way in. Neither is referenced by any
-- policy expression, so withdrawing EXECUTE cannot break an anonymous read.
--
-- The rest of the anon-executable list is deliberate or unavoidable:
-- `get_public_payment` and `confirm_test_payment` are what the logged-out
-- payment page calls, and the role predicates (`is_admin`, `current_*`,
-- `can_*`) are named inside policy expressions, where the *caller* needs
-- EXECUTE — revoking those would turn an anonymous read into an error instead
-- of an empty result.
-- ---------------------------------------------------------------------------

revoke all on function public.start_trip(uuid) from public, anon;
revoke all on function public.set_trip_boarding(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 5. Write grants on views that cannot be written
--
-- Supabase grants the full set on everything in `public` by default, views
-- included. Most of these are UNION or aggregate views and are not auto
-- updatable, so a write raises "cannot insert into view" rather than doing
-- anything — with one exception worth naming: `operator_fleet` *is* auto
-- updatable. It carries `security_invoker=true`, so a write through it is
-- checked against the caller's own grants on `buses`, which migration 32
-- withdrew; an operator trying it gets "permission denied for table buses".
-- That was verified, not assumed.
--
-- They are revoked here anyway. A grant that does nothing is a grant someone
-- has to rule out by hand the next time this schema is audited, and the noise
-- is what made these three real holes take a while to find.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.operator_fleet from anon, authenticated;
revoke insert, update, delete on public.operator_crew from anon, authenticated;
revoke insert, update, delete on public.operator_manifest from anon, authenticated;
revoke insert, update, delete on public.operator_trip_overview from anon, authenticated;
revoke insert, update, delete on public.trip_search from anon, authenticated;
revoke insert, update, delete on public.trip_live_position from anon, authenticated;
revoke insert, update, delete on public.driver_assignments from anon, authenticated;
