-- Выполните целиком в Supabase → SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Игрок',
  total_value bigint not null default 0 check (total_value >= 0),
  battles_won integer not null default 0 check (battles_won >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.drops (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  player_name text not null,
  item_name text not null,
  item_file text not null,
  rarity text not null,
  mutation text not null default 'none',
  value bigint not null check (value >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.battle_rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  host_name text not null,
  guest_id uuid references auth.users(id) on delete set null,
  guest_name text,
  case_id text not null,
  case_name text not null,
  rounds integer not null default 1 check (rounds between 1 and 3),
  entry_price integer not null check (entry_price >= 0),
  status text not null default 'waiting' check (status in ('waiting','finished','cancelled')),
  host_score integer,
  guest_score integer,
  winner_id uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.drops enable row level security;
alter table public.battle_rooms enable row level security;

create policy "profiles public read" on public.profiles for select using (true);
create policy "profiles own insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles own update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "drops public read" on public.drops for select using (true);
create policy "drops own insert" on public.drops for insert with check (auth.uid() = user_id);
create policy "rooms public read" on public.battle_rooms for select using (true);
create policy "rooms own create" on public.battle_rooms for insert with check (auth.uid() = host_id);
create policy "rooms participant cancel" on public.battle_rooms for update using (auth.uid() in (host_id, guest_id));

create or replace function public.join_battle(room_uuid uuid, joining_name text)
returns public.battle_rooms
language plpgsql security definer set search_path = public
as $$
declare r public.battle_rooms; h integer; g integer; w uuid;
begin
  select * into r from public.battle_rooms where id=room_uuid for update;
  if r.id is null or r.status <> 'waiting' then raise exception 'Комната уже недоступна'; end if;
  if r.host_id = auth.uid() then raise exception 'Нельзя играть против себя'; end if;
  h := 0; g := 0;
  for i in 1..r.rounds loop
    h := h + floor((0.30 + random()*1.55) * greatest(r.entry_price,100) / r.rounds)::int;
    g := g + floor((0.30 + random()*1.55) * greatest(r.entry_price,100) / r.rounds)::int;
  end loop;
  if h = g then g := g + 1; end if;
  w := case when h > g then r.host_id else auth.uid() end;
  update public.battle_rooms set guest_id=auth.uid(), guest_name=left(coalesce(nullif(joining_name,''),'Игрок'),24), status='finished', host_score=h, guest_score=g, winner_id=w, finished_at=now() where id=room_uuid returning * into r;
  if w = auth.uid() then
    insert into public.profiles(id,display_name,total_value,battles_won) values(auth.uid(),left(joining_name,24),0,1)
    on conflict(id) do update set battles_won=public.profiles.battles_won+1,updated_at=now();
  else
    update public.profiles set battles_won=battles_won+1,updated_at=now() where id=w;
  end if;
  return r;
end $$;

grant execute on function public.join_battle(uuid,text) to authenticated;

create index if not exists drops_created_idx on public.drops(created_at desc);
create index if not exists profiles_value_idx on public.profiles(total_value desc);
create index if not exists rooms_waiting_idx on public.battle_rooms(status,created_at desc);

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='drops') then
    alter publication supabase_realtime add table public.drops;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='battle_rooms') then
    alter publication supabase_realtime add table public.battle_rooms;
  end if;
end $$;
