-- Payment methods, booking sources and ticket types.
--
-- Alone in its own migration because of one Postgres rule: a value added to an
-- existing enum cannot be *used* by DDL in the same transaction. `CASH` is
-- needed by a CHECK constraint in the next migration, so it has to be committed
-- first. The new types below could live anywhere; they are here for company.

-- ---------------------------------------------------------------------------
-- CASH is a provider in the sense that matters: it says who handled the money.
--
-- Nothing processed it — a clerk took notes at a counter. That is a real
-- payment of real money, which is a change of kind for this build: until now
-- `payments_mock_only` guaranteed nothing here could correspond to money
-- moving. It is now "no electronic provider", not "no money". See AGENTS.md.
-- ---------------------------------------------------------------------------

alter type public.payment_provider add value if not exists 'CASH';

-- How the money arrived. TEST_* are simulated exactly as before and move
-- nothing; CASH is the one that corresponds to actual notes changing hands.
create type public.payment_method as enum (
  'CASH',
  'TEST_GCASH',
  'TEST_MAYA',
  'TEST_CARD',
  'TEST_BANK',
  'TEST_WALLET'
);

-- Where the booking was made. A booking belongs to a passenger and a trip, not
-- to a phone, so this records the channel rather than implying ownership.
create type public.booking_source as enum ('MOBILE_APP', 'WEB', 'OPERATOR', 'TERMINAL');

create type public.ticket_type as enum ('DIGITAL', 'PRINTED');
