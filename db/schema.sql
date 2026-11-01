-- IPO Rating database schema (v2). Safe to run more than once.
--
-- ipo_listings : live issue data, overwritten by every sync (never edited by hand)
-- ipo_facts    : fundamentals read from the offer document (RHP), loaded from data/facts/*.json
-- ipo_score_snapshots : history of every score, so a rating change can be explained
-- sync_runs    : one row per sync attempt, so the site can show "last updated" and you can spot failures

create table if not exists ipo_listings (
  slug        text primary key,
  name        text        not null,
  segment     text        not null,
  status      text        not null,
  open_date   date,
  close_date  date,
  payload     jsonb       not null,
  synced_at   timestamptz not null default now()
);

create index if not exists ipo_listings_status_idx on ipo_listings (status);
create index if not exists ipo_listings_open_date_idx on ipo_listings (open_date);

create table if not exists ipo_facts (
  slug       text primary key,   -- matches ipo_listings.slug; may be loaded before the listing appears
  payload    jsonb       not null,
  as_of      date        not null,
  loaded_at  timestamptz not null default now()
);

create table if not exists ipo_score_snapshots (
  id          bigserial primary key,
  slug        text        not null,
  model_ver   text        not null,
  score       numeric(3,1),
  confidence  numeric(4,2) not null,
  factors     jsonb       not null,
  scored_at   timestamptz not null default now()
);

create index if not exists ipo_score_snapshots_slug_idx on ipo_score_snapshots (slug, scored_at desc);

create table if not exists sync_runs (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  ok          boolean     not null,
  listings    integer     not null default 0,
  warnings    jsonb       not null default '[]'::jsonb,
  error       text
);

create index if not exists sync_runs_ran_at_idx on sync_runs (ran_at desc);
