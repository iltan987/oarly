-- SET LOCAL, and FIRST, for the reason 0009 sets out at length: drizzle runs every
-- pending migration inside ONE transaction, so this bounds lock ACQUISITION for the
-- whole batch and is discarded with the transaction either way.
--
-- The ADD COLUMN below is nullable with no default, so PG11+ writes only a catalog row
-- and never rewrites the heap — the change itself is instant. That is not the hazard.
-- The hazard is that ACCESS EXCLUSIVE still has to be ACQUIRED, and `bookings` is read
-- by every member's bookings page and every owner's roster. An ACCESS EXCLUSIVE request
-- that has to WAIT behind one long-running SELECT also queues every reader arriving
-- after it, so an instant DDL statement can still stall the site for as long as that
-- one reader runs. 5s turns that into a failed deploy the operator retries with nothing
-- applied (one transaction, one rollback), which is strictly the better outcome.
--
-- NOT the `ALTER TYPE ... ADD VALUE` hazard documented in 0009 and in `src/db/schema/
-- clubs.ts`: that restriction is on USING a value added to a PRE-EXISTING type in the
-- same transaction. `booking_cancel_reason` is CREATED here, and Postgres exempts a type
-- created in the current transaction. No workaround is needed and none should be added.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TYPE "public"."booking_cancel_reason" AS ENUM('member', 'owner', 'penalty');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_reason" "booking_cancel_reason";
