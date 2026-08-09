-- SET LOCAL, and FIRST: drizzle runs every pending migration inside ONE transaction,
-- so this bounds lock acquisition for the whole batch and is discarded with the
-- transaction either way.
--
-- Why it is here rather than nowhere. The DROP CONSTRAINT below takes ACCESS
-- EXCLUSIVE on `clubs`, and that lock is then HELD for the rest of the batch: 0011's
-- audit_log rewrite and both of its index builds run underneath it (~2 s per million
-- audit rows). `clubs` is the table every request resolves a tenant through, and an
-- ACCESS EXCLUSIVE request that has to WAIT also queues every reader arriving behind
-- it. So one long-running SELECT holding ACCESS SHARE when the deploy starts is enough
-- to stall the whole site for as long as that query runs.
--
-- 5s converts that into a failed deploy the operator retries, which is the strictly
-- better outcome: nothing has been applied (one transaction, one rollback) and the
-- site never stopped serving.
--
-- Deliberately NOT statement_timeout: the risk here is WAITING for a lock, not holding
-- one too long, and a statement_timeout would abort a legitimately slow index build on
-- a large table — turning a slow deploy into a failed one for no safety gain.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TYPE "public"."club_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'admin';--> statement-breakpoint
ALTER TABLE "clubs" DROP CONSTRAINT "clubs_slug_unique";--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The predicate enumerates the SURVIVING statuses instead of `<> 'rejected'` on purpose.
-- `ALTER TYPE ... ADD VALUE` (line 1) and any *use* of that new value cannot share a
-- transaction unless the type was created in it, and drizzle's migrator runs every
-- pending migration inside ONE transaction. So `WHERE "status" <> 'rejected'` commits on
-- a FRESH database (0000 creates club_status in the same transaction) and fails on an
-- ALREADY-MIGRATED one with `unsafe use of new value "rejected" of enum type
-- club_status` -- i.e. it passes all of CI and breaks the production deploy.
-- `"status"::text <> 'rejected'` is rejected outright ("functions in index predicate must
-- be marked IMMUTABLE"). Do not "simplify" this predicate.
CREATE UNIQUE INDEX "clubs_slug_uq" ON "clubs" USING btree ("slug") WHERE "clubs"."status" IN ('pending', 'active', 'suspended');