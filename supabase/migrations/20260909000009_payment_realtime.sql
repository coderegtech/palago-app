-- Phase 5c: Realtime for payment and booking status.
--
-- The confirmation happens on a DIFFERENT DEVICE from the one holding the
-- booking: the passenger scans the QR with a browser, and the app is left
-- waiting. Polling would make the app feel broken, so the app subscribes and
-- the database pushes.
--
-- Realtime respects RLS, so a subscriber receives changes only for rows it may
-- already read — a passenger sees their own payment, and nobody else's.

alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.bookings;

-- Realtime sends only the primary key on UPDATE unless the table replicates
-- full rows. The app needs the new status, so send the whole row.
alter table public.payments replica identity full;
alter table public.bookings replica identity full;
