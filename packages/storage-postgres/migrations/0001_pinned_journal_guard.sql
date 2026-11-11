ALTER TABLE "attributes" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Journal protection: a movement is never changed. DELETE stays allowed: deleting an item, a variant or an inventory
-- takes its movements by cascade.
-- A later migration that backfills movements must disable this trigger around its UPDATE.
CREATE OR REPLACE FUNCTION "gm_movements_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gm_movements_append_only: a movement is never changed' USING ERRCODE = 'GM002';
END
$$;--> statement-breakpoint
CREATE TRIGGER "movements_append_only" BEFORE UPDATE ON "movements" FOR EACH ROW EXECUTE FUNCTION "gm_movements_append_only"();--> statement-breakpoint
-- Soft migrations: the oldest app schema that may write. Additive migrations leave it; schema 3 apps may write here.
INSERT INTO "gm_meta" ("key", "value") VALUES ('min_app_schema', '3') ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value";
