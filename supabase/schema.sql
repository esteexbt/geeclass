-- GeeClass storage schema (only needed if you host on a serverless platform such as Vercel).
-- Run this in the Supabase SQL editor, then set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

create table if not exists battles (
  code text primary key,
  doc jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists players (
  battle_code text not null references battles(code) on delete cascade,
  wallet text not null,
  name text not null,
  token text not null,
  joined_at bigint not null,
  join_tx text,
  primary key (battle_code, wallet)
);

create table if not exists answers (
  battle_code text not null references battles(code) on delete cascade,
  wallet text not null,
  qi int not null,
  choice int not null,
  ms int not null,
  correct boolean not null,
  points int not null,
  primary key (battle_code, wallet, qi)
);

-- The app talks to these tables only from the server with the service role key.
alter table battles enable row level security;
alter table players enable row level security;
alter table answers enable row level security;
