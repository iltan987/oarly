ALTER TABLE "bookings" ADD COLUMN "booking_date" date;--> statement-breakpoint
-- Backfill from each booking's slot before the NOT NULL and the unique index.
UPDATE "bookings" b
SET "booking_date" = s."date"
FROM "sessions" se, "slots" s
WHERE se."id" = b."session_id" AND s."id" = se."slot_id";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "booking_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "penalties" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "penalties" ADD COLUMN "permanent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Deliberately NO defensive de-dupe here, unlike 0005. De-duping would mean
-- silently cancelling a real member's booking to make the index fit; that is a
-- product decision, not a migration detail. Step 1 of this task verified
-- production is clean instead.
CREATE UNIQUE INDEX "bookings_multisport_day_uq" ON "bookings" USING btree ("user_id","booking_date") WHERE "bookings"."payment_type" = 'multisport' and "bookings"."status" in ('booked', 'waitlisted');--> statement-breakpoint
CREATE UNIQUE INDEX "penalties_booking_uq" ON "penalties" USING btree ("booking_id");