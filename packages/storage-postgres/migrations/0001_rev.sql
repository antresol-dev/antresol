INSERT INTO "gm_meta" ("key", "value") VALUES ('rev', gen_random_uuid()::text) ON CONFLICT ("key") DO NOTHING;
