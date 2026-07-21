-- Relay's Supabase schema. Safe to run on a new Supabase project.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 50),
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  bio text not null default '' check (char_length(bio) <= 140),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct')),
  title text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members(user_id, conversation_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('text', 'image', 'audio')),
  body text check (body is null or char_length(body) <= 4000),
  storage_path text,
  object_name text,
  object_type text,
  created_at timestamptz not null default now(),
  check ((kind = 'text' and body is not null) or (kind in ('image', 'audio') and storage_path is not null))
);

create index if not exists messages_conversation_idx
  on public.messages(conversation_id, created_at);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('voice', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended')),
  offer_sdp jsonb,
  answer_sdp jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calls_callee_idx on public.calls(callee_id, status, updated_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  base_handle text;
begin
  base_handle := left(regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9_]', '', 'g'), 17);
  if char_length(base_handle) < 3 then base_handle := 'member'; end if;
  insert into public.profiles (id, display_name, handle)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), base_handle), 50),
    base_handle || '_' || left(replace(new.id::text, '-', ''), 6)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.create_direct_conversation(peer_id uuid)
returns uuid
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  conversation_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if peer_id = current_user_id then raise exception 'Choose another person'; end if;
  if not exists (select 1 from public.profiles where id = peer_id) then raise exception 'User not found'; end if;

  select mine.conversation_id into conversation_id
  from public.conversation_members mine
  join public.conversation_members other on other.conversation_id = mine.conversation_id
  join public.conversations c on c.id = mine.conversation_id and c.kind = 'direct'
  where mine.user_id = current_user_id and other.user_id = peer_id
    and (select count(*) from public.conversation_members all_members where all_members.conversation_id = mine.conversation_id) = 2
  limit 1;

  if conversation_id is not null then return conversation_id; end if;

  insert into public.conversations default values returning id into conversation_id;
  insert into public.conversation_members (conversation_id, user_id)
  values (conversation_id, current_user_id), (conversation_id, peer_id);
  return conversation_id;
end;
$$;

grant execute on function public.create_direct_conversation(uuid) to authenticated;

create or replace function public.is_conversation_member(target_conversation_id uuid)
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = target_conversation_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.calls enable row level security;

create policy "Profiles are visible to members" on public.profiles for select to authenticated using (true);
create policy "Members update their own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "Members read their conversations" on public.conversations for select to authenticated
using (public.is_conversation_member(id));

create policy "Members read conversation membership" on public.conversation_members for select to authenticated
using (public.is_conversation_member(conversation_id));

create policy "Members read messages" on public.messages for select to authenticated
using (public.is_conversation_member(conversation_id));
create policy "Members send messages" on public.messages for insert to authenticated
with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

create policy "Participants read calls" on public.calls for select to authenticated using (caller_id = auth.uid() or callee_id = auth.uid());
create policy "Members start calls" on public.calls for insert to authenticated
with check (caller_id = auth.uid() and public.is_conversation_member(conversation_id));
create policy "Participants update calls" on public.calls for update to authenticated
using (caller_id = auth.uid() or callee_id = auth.uid()) with check (caller_id = auth.uid() or callee_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 12582912, array['image/jpeg','image/png','image/webp','image/gif','audio/webm','audio/mpeg','audio/mp4','audio/ogg','audio/wav'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Members upload their own media" on storage.objects for insert to authenticated
with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Conversation members read media" on storage.objects for select to authenticated
using (bucket_id = 'media' and exists (
  select 1 from public.messages m
  where m.storage_path = name and public.is_conversation_member(m.conversation_id)
));
create policy "Owners delete unclaimed media" on storage.objects for delete to authenticated
using (bucket_id = 'media' and owner_id = auth.uid()::text);

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls') then
    alter publication supabase_realtime add table public.calls;
  end if;
end $$;
