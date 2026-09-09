-- Phase 8 fix: crew authorisation must survive the end of the trip.
--
-- Found by `pnpm db:verify:tracking`, not by reading the code.
--
-- `end_trip` sets the crew assignment to COMPLETED. Both `can_manage_trip_status`
-- and `can_track_trip` only accepted an assignment that was still ASSIGNED or
-- ACTIVE, so the moment a driver ended a trip they stopped being recognised as
-- its crew. Two consequences, both bad:
--
--   1. `end_trip` was no longer idempotent in practice. Its own precondition
--      returns "already ended" on a second call — but the authorisation check
--      in front of it raised FORBIDDEN first. A driver whose response was lost
--      on a patchy road taps "End trip" again and is told they are not allowed,
--      for an operation that already succeeded.
--   2. The driver's own trip screen 404'd the instant they ended the trip,
--      because `trip_live_position` stopped returning the row they were
--      looking at.
--
-- The right question is "were you the crew of this trip", not "are you still on
-- duty". CANCELLED assignments are excluded: that crew member was taken off the
-- trip, which is a different thing from having finished it.
--
-- Note what does NOT change: `can_publish_location` still demands an ACTIVE
-- assignment, so ending a trip still closes the GPS write path. Being able to
-- look at a finished trip is not being able to keep writing to it.

create or replace function public.can_manage_trip_status(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.trips t
      where t.id = p_trip_id
        and t.operator_id = public.current_operator_id()
        and public.current_profile_role() = 'OPERATOR'
    )
    or exists (
      select 1 from public.trip_assignments ta
      where ta.trip_id = p_trip_id
        and ta.driver_id = public.current_driver_id()
        and ta.status <> 'CANCELLED'
    );
$$;

create or replace function public.can_track_trip(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.trips t
      where t.id = p_trip_id and t.operator_id = public.current_operator_id()
    )
    or exists (
      select 1 from public.trip_assignments ta
      where ta.trip_id = p_trip_id
        and ta.status <> 'CANCELLED'
        and (
          ta.driver_id = public.current_driver_id()
          or ta.assistant_id = public.current_assistant_id()
        )
    )
    or exists (
      select 1 from public.bookings b
      where b.trip_id = p_trip_id
        and b.user_id = (select auth.uid())
        and b.status in ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP', 'COMPLETED')
    );
$$;
