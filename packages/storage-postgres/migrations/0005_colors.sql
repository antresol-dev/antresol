-- Item and tag colours: nullable #RRGGBB in capitals (checked), additive; min_app_schema stays 3 (older apps name only their columns).
ALTER TABLE "items" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_color_check" CHECK ("items"."color" ~ '^#[0-9A-F]{6}$');--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_color_check" CHECK ("tags"."color" ~ '^#[0-9A-F]{6}$');