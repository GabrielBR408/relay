-- Relay: walkie-talkie + transcription group messaging
-- Core schema, RLS, storage bucket, realtime publication

-- ============ TABLES ============

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'User',
  created_at timestamptz not null default now()
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles(id),
  invite_code text not null unique default substr(md5(gen_random_uuid()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null default 'audio' check (mode in ('audio', 'text')),
  tts_enabled boolean not null default false,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  type text not null check (type in ('audio', 'text')),
  text_content text,
  audio_path text,
  duration_ms integer,
  transcript text,
  transcript_status text not null default 'none'
    check (transcript_status in ('none', 'pending', 'done', 'failed')),
  created_at timestamptz not null default now()
);
create index messages_channel_created_idx on public.messages (channel_id, created_at desc);

create table public.read_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- ============ PROFILE AUTO-CREATE ============

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ MEMBERSHIP HELPER (avoids recursive RLS) ============

create or replace function public.is_member(cid uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = cid and user_id = auth.uid()
  );
$$;

-- ============ JOIN BY INVITE CODE ============

create or replace function public.join_channel(code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  cid uuid;
begin
  select id into cid from public.channels where invite_code = lower(code);
  if cid is null then
    raise exception 'Invalid invite code';
  end if;
  insert into public.channel_members (channel_id, user_id)
  values (cid, auth.uid())
  on conflict do nothing;
  return cid;
end;
$$;

-- ============ RLS ============

alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;
alter table public.read_receipts enable row level security;

create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);
create policy "update own profile"
  on public.profiles for update to authenticated using (id = auth.uid());

create policy "members read channels"
  on public.channels for select to authenticated using (public.is_member(id));
create policy "authenticated create channels"
  on public.channels for insert to authenticated with check (created_by = auth.uid());

create policy "members read memberships"
  on public.channel_members for select to authenticated using (public.is_member(channel_id));
create policy "insert own membership when creator"
  on public.channel_members for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own membership"
  on public.channel_members for update to authenticated using (user_id = auth.uid());
create policy "delete own membership"
  on public.channel_members for delete to authenticated using (user_id = auth.uid());

create policy "members read messages"
  on public.messages for select to authenticated using (public.is_member(channel_id));
create policy "members send messages"
  on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(channel_id));
create policy "sender updates own message"
  on public.messages for update to authenticated using (sender_id = auth.uid());

create policy "members read receipts"
  on public.read_receipts for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.channel_id)));
create policy "insert own receipts"
  on public.read_receipts for insert to authenticated with check (user_id = auth.uid());

-- ============ REALTIME ============

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.channel_members;
alter publication supabase_realtime add table public.read_receipts;

-- ============ STORAGE: public clips bucket ============

insert into storage.buckets (id, name, public)
values ('clips', 'clips', true);

create policy "authenticated upload clips"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'clips');

create policy "public read clips"
  on storage.objects for select
  using (bucket_id = 'clips');
