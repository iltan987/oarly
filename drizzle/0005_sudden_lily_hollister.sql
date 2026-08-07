-- Defensive de-dupe before the unique index. `schedule.validate` has always rejected
-- duplicate boat rows on input, so this should delete nothing — but a CREATE UNIQUE
-- INDEX that fails mid-deploy on unexpected data is a much worse outcome than a no-op.
DELETE FROM "window_boats" a
USING "window_boats" b
WHERE a."window_id" = b."window_id"
  AND a."boat_type_id" = b."boat_type_id"
  AND a."id" > b."id";
--> statement-breakpoint
CREATE UNIQUE INDEX "window_boats_window_boat_uq" ON "window_boats" USING btree ("window_id","boat_type_id");
