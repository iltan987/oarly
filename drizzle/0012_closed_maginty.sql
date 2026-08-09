-- SET LOCAL, and FIRST, for the reason 0009 sets out at length: drizzle runs every
-- pending migration inside ONE transaction, so this bounds lock ACQUISITION for the
-- whole batch and is discarded with the transaction either way.
--
-- A plain CREATE INDEX takes SHARE on `penalties`, which blocks writes to it for the
-- duration — and, more to the point, a SHARE request that has to WAIT queues every
-- writer arriving behind it. `penalties` is written on the owner's mark/undo path, so
-- the blast radius is small, but 5s converts a stuck deploy into a failed one the
-- operator retries with nothing applied, which is strictly the better outcome.
--
-- NOT CONCURRENTLY: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block,
-- and this migrator gives it one. The table is small enough today that the plain form
-- is a sub-second operation; if `penalties` ever grows to where that stops being true,
-- this index must be built out of band rather than by relaxing the batch.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "penalties_membership_idx" ON "penalties" USING btree ("membership_id");
