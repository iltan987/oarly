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