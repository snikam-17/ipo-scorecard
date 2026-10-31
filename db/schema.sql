-- IPO Rating database schema.
-- Indexed columns are used for listing/filtering; the full typed record lives in `payload` (see lib/types.ts).

create table if not exists ipos (
  slug         text primary key,
  name         text        not null,
  sector       text,
  segment      text,
  status       text        not null,
  open_date    date,
  close_date   date,
  data_source  text        not null,   -- 'api' | 'manual' | 'demo'
  source_url   text,
  payload      jsonb       not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists ipos_status_idx   on ipos (status);
create index if not exists ipos_open_date_idx on ipos (open_date);

-- Audit trail: every score that was computed, with the scoring-model version.
-- Lets you show "how did this rating change when the RHP was updated?" without guessing.
create table if not exists ipo_score_snapshots (
  id          bigserial primary key,
  slug        text        not null references ipos (slug) on delete cascade,
  model_ver   text        not null,
  score       numeric(3,1),
  confidence  numeric(4,2) not null,
  factors     jsonb       not null,
  scored_at   timestamptz not null default now()
);

create index if not exists ipo_score_snapshots_slug_idx on ipo_score_snapshots (slug, scored_at desc);
