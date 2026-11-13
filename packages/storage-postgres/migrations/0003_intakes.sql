CREATE TABLE "intakes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inventory_id" uuid NOT NULL,
	"status" text NOT NULL,
	"shop" text,
	"order_number" text,
	"purchased_on" text NOT NULL,
	"note" text,
	"draft" jsonb,
	"lines" jsonb,
	"draft_rev" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "intakes_status_check" CHECK ("intakes"."status" in ('draft', 'committed'))
);
--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN "intake_id" uuid;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_inventory_id_inventories_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intakes_inventory_id_idx" ON "intakes" USING btree ("inventory_id");--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movements_intake_id_idx" ON "movements" USING btree ("intake_id");--> statement-breakpoint
-- The revision of the intakes (spec 2026-11-13 intakes §4): every write of an intake gives it a new opaque value, and
-- only those writes do. Drafts are saved without changing `rev`, so other devices do not reload the inventory for them.
INSERT INTO "antresol_meta" ("key", "value") VALUES ('intakes_rev', gen_random_uuid()::text) ON CONFLICT ("key") DO NOTHING;
