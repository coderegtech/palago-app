-- ---------------------------------------------------------------------------
-- Retention for bus_locations.
--
-- The table is append-only by design and nothing ever removed a row. At the
-- sizing in docs/production-costs.md §8 that is ~1.3 GB a month at
-- province-wide scale — the Pro plan's 8 GB gone in about six months, on data
-- nobody reads: the only reader is the live trail on the tracking map
-- (`trackingService.getTrail`), and nobody watches a trip that ended a month ago.
--
-- The rule: once a trip has ended (COMPLETED, ARRIVED or CANCELLED) and its
-- departure date is more than `bus_location_retention_days` behind (default
-- 30), its trail is thinned to the single final fix. The last known position
-- survives, so "where did this coach last report from" still has an answer.
-- A trip still running is never touched, however old its date.
--
-- Deleted in batches so a first run over months of backlog does not hold one
-- enormous lock over a table drivers are inserting into.
--
-- `bus_locations` has no client DELETE and keeps none: this function is
-- revoked from every client role and runs from pg_cron as the owner.
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values ('bus_location_retention_days', '30')
on conflict (key) do nothing;

create or replace function public.prune_bus_locations(p_batch_size integer default 20000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_cutoff date;
  v_batch integer;
  v_total integer := 0;
begin
  select greatest(coalesce(nullif(value, '')::integer, 30), 1)
    into v_days
    from public.app_settings where key = 'bus_location_retention_days';
  v_days := coalesce(v_days, 30);

  -- Palawan's calendar, as everywhere a trip date is compared.
  v_cutoff := (now() at time zone 'Asia/Manila')::date - v_days;

  loop
    with ended as (
      select t.id
        from public.trips t
       where t.status in ('COMPLETED', 'ARRIVED', 'CANCELLED')
         and t.departure_date < v_cutoff
    ),
    last_fix as (
      select distinct on (bl.trip_id) bl.trip_id, bl.id
        from public.bus_locations bl
        join ended e on e.id = bl.trip_id
       order by bl.trip_id, bl.recorded_at desc, bl.id desc
    ),
    doomed as (
      select bl.id
        from public.bus_locations bl
        join ended e on e.id = bl.trip_id
       where bl.id not in (select id from last_fix)
       limit p_batch_size
    )
    delete from public.bus_locations bl
     using doomed d
     where bl.id = d.id;

    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch < p_batch_size;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.prune_bus_locations(integer) from public, anon, authenticated;

comment on function public.prune_bus_locations(integer) is
  'Thins the GPS trail of trips that ended more than bus_location_retention_days (app_settings, default 30) ago to their final fix. Runs nightly from pg_cron; no client may call it.';

-- ---------------------------------------------------------------------------
-- Nightly at 03:15 Palawan time (19:15 UTC — pg_cron schedules in UTC), when
-- no coach is running. Scheduling by name is an upsert, so re-applying this
-- migration does not stack a second job.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;

select cron.schedule(
  'prune-bus-locations',
  '15 19 * * *',
  'select public.prune_bus_locations();'
);
