-- Item and folder icons: nullable, additive; min_app_schema stays 3 (older apps name only their columns).
ALTER TABLE "folders" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "icon" text;