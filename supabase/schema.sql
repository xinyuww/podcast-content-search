-- 声签 MVP / Supabase PostgreSQL + pgvector
create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists podcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  publisher text,
  categories text[] not null default '{}',
  language text not null default 'zh-CN',
  artwork_url text,
  rss_url text unique,
  created_at timestamptz not null default now()
);

create table if not exists episodes (
  id uuid primary key default gen_random_uuid(),
  podcast_id uuid not null references podcasts(id) on delete cascade,
  guid text,
  title text not null,
  description text,
  published_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  audio_url text,
  source_url text,
  popularity_score real not null default 0,
  transcript_status text not null default 'pending'
    check (transcript_status in ('pending','processing','ready','failed')),
  created_at timestamptz not null default now(),
  unique (podcast_id, guid)
);

create table if not exists transcript_segments (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  segment_index integer not null,
  start_seconds integer not null check (start_seconds >= 0),
  end_seconds integer not null check (end_seconds > start_seconds),
  speaker text,
  transcript text not null,
  summary text not null,
  topics text[] not null default '{}',
  content_type text,
  editorial_quality real not null default 0.5,
  embedding vector(1536),
  search_document tsvector generated always as (
    to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(transcript, ''))
  ) stored,
  created_at timestamptz not null default now(),
  unique (episode_id, segment_index)
);

create index if not exists episodes_podcast_idx on episodes(podcast_id);
create index if not exists segments_episode_idx on transcript_segments(episode_id);
create index if not exists segments_search_idx on transcript_segments using gin(search_document);
create index if not exists segments_embedding_idx on transcript_segments
  using hnsw (embedding vector_cosine_ops);

create table if not exists playlists (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  title text not null,
  introduction text,
  total_duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists playlist_items (
  playlist_id uuid not null references playlists(id) on delete cascade,
  segment_id uuid not null references transcript_segments(id) on delete cascade,
  position integer not null,
  selection_reason text,
  primary key (playlist_id, position),
  unique (playlist_id, segment_id)
);

-- 生产环境中应只通过服务端执行该查询，且 embedding 参数必须来自可信服务。
create or replace function match_segments(
  query_embedding vector(1536),
  match_count integer default 30
)
returns table (
  id uuid,
  episode_id uuid,
  summary text,
  similarity double precision
)
language sql stable
as $$
  select
    s.id,
    s.episode_id,
    s.summary,
    1 - (s.embedding <=> query_embedding) as similarity
  from transcript_segments s
  where s.embedding is not null
  order by s.embedding <=> query_embedding
  limit greatest(1, least(match_count, 100));
$$;
