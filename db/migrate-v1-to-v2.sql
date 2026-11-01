-- Only needed if you already ran the FIRST version of db/schema.sql (tables `ipos` and `ipo_score_snapshots` with a foreign key).
-- Those tables held no real data, so it is safe to drop them. Run this FIRST, then run db/schema.sql.
drop table if exists ipo_score_snapshots;
drop table if exists ipos;
