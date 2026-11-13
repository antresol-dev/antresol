-- Photo renditions, size and delete handle: nullable, additive; min_app_schema stays 3 (older apps name only their columns).
ALTER TABLE "photos" ADD COLUMN "urls" jsonb;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "delete_handle" text;
