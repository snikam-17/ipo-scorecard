-- Neon migration for the /api/cron/sync-ipos pipeline.
-- Run in the Neon SQL Editor. Safe to run more than once.
--
-- Note: if an older table called `ipos` from the first version of this project still exists, drop it first
-- (`drop table if exists ipos;`), because `create table if not exists` would otherwise skip creating the new one.
--
-- Beyond the fields you specified, this adds two columns the pipeline needs:
--   ai_researched_at : when the AI research was last generated, so a 6-hourly sync does not re-run (and re-pay for)
--                      web research on every IPO every time
--   raw_data         : the unmodified record from the IPO API, so field-mapping fixes never need a re-fetch

create table if not exists ipos (
  id                 bigserial primary key,
  symbol             text         not null,
  company_name       text         not null,
  exchange           text,
  category           text         not null check (category in ('MAINBOARD', 'SME')),
  status             text         not null check (status in ('UPCOMING', 'OPEN', 'CLOSED')),
  price_band         text,
  lot_size           integer,
  issue_size_crores  numeric(12,2),
  open_date          date,
  close_date         date,
  allotment_date     date,
  listing_date       date,
  gmp_amount         numeric(10,2),
  subscription_rate  numeric(10,2),
  ai_research        jsonb,
  ai_rating          numeric(3,1) check (ai_rating is null or (ai_rating >= 1 and ai_rating <= 10)),
  ai_verdict         text,
  ai_researched_at   timestamptz,
  raw_data           jsonb,
  created_at         timestamptz  not null default now(),
  updated_at         timestamptz  not null default now()
);

-- Required by: INSERT ... ON CONFLICT (symbol) DO UPDATE
create unique index if not exists ipos_symbol_uidx on ipos (symbol);

create index if not exists ipos_status_idx on ipos (status);
create index if not exists ipos_open_date_idx on ipos (open_date);
