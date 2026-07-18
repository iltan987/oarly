DROP INDEX "slots_club_start_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "slots_club_start_uq" ON "slots" USING btree ("club_id","start_at");