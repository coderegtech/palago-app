-- ---------------------------------------------------------------------------
-- A ledger type for points taken back when a paid booking is refunded.
--
-- On its own because Postgres will not let a new enum value be USED in the
-- transaction that adds it ("unsafe use of new value"), and the next migration
-- uses it in a partial unique index and a check constraint.
--
-- Not ADJUSTED: that type already carries a booking id when a cancelled reward
-- redemption gives its points back, so "has this booking been reversed?" could
-- not be answered from it — and that question is what keeps a reversal
-- exactly-once. See 20260919000041.
-- ---------------------------------------------------------------------------

alter type public.loyalty_transaction_type add value if not exists 'REVERSED';
