-- What an intake commit created (folders, attributes, tags, items): nullable jsonb, additive; min_app_schema stays as is.
ALTER TABLE "intakes" ADD COLUMN "created" jsonb;