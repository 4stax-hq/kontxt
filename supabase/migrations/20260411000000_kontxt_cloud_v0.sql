-- kontxt cloud sync v0: mirror memories to Supabase with RLS (auth.uid() = user_id).
-- Apply in the Supabase SQL editor or via `supabase db push` from your 4StaX base project.

create table if not exists public.kontxt_memories (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project text,
  content text not null,
  summary text not null,
  source text not null,
  type text not null,
  privacy_level text not null default 'private',
  embedding_tier text,
  tags jsonb not null default '[]'::jsonb,
  related_ids jsonb not null default '[]'::jsonb,
  importance_score double precision not null default 0.5,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kontxt_memories_user_id_idx on public.kontxt_memories (user_id);
create index if not exists kontxt_memories_project_idx on public.kontxt_memories (project);
create index if not exists kontxt_memories_privacy_idx on public.kontxt_memories (privacy_level);

alter table public.kontxt_memories enable row level security;

create policy "kontxt_memories_select_own"
  on public.kontxt_memories
  for select
  using (auth.uid() = user_id);

create policy "kontxt_memories_insert_own"
  on public.kontxt_memories
  for insert
  with check (auth.uid() = user_id);

create policy "kontxt_memories_update_own"
  on public.kontxt_memories
  for update
  using (auth.uid() = user_id);

create policy "kontxt_memories_delete_own"
  on public.kontxt_memories
  for delete
  using (auth.uid() = user_id);

comment on table public.kontxt_memories is 'kontxt CLI mirror of local vault rows; push respects privacy_level unless CLI --include-private.';
