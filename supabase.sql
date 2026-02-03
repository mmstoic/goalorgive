-- GoalOrGive schema + RLS policies
-- Run in Supabase SQL editor.

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  fund_points integer not null default 0,
  created_at timestamptz default now()
);

create table if not exists group_members (
  user_id uuid references profiles (id) on delete cascade,
  group_id uuid references groups (id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, group_id)
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete cascade,
  group_id uuid references groups (id) on delete cascade,
  title text not null,
  frequency text not null check (frequency in ('daily', 'weekly')),
  due_date date not null,
  completed boolean not null default false,
  penalized boolean not null default false,
  penalty_points integer not null default 1,
  created_at timestamptz default now()
);

-- Enable RLS
alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table goals enable row level security;

-- Profiles: user can manage their own profile row
create policy "Profiles are viewable by owner" on profiles
  for select using (id = auth.uid());

create policy "Profiles insert for self" on profiles
  for insert with check (id = auth.uid());

create policy "Profiles update for self" on profiles
  for update using (id = auth.uid());

-- Groups: members can view/update their group
create policy "Groups viewable by members" on groups
  for select using (
    exists (
      select 1 from group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
    )
  );

create policy "Groups insert for authenticated" on groups
  for insert to authenticated with check (true);

create policy "Groups update for members" on groups
  for update using (
    exists (
      select 1 from group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
    )
  );

-- Group members: users can see/insert their own membership
create policy "Group members viewable by owner" on group_members
  for select using (user_id = auth.uid());

create policy "Group members insert for self" on group_members
  for insert with check (user_id = auth.uid());

create policy "Group members delete for self" on group_members
  for delete using (user_id = auth.uid());

-- Goals: users can manage their own goals (and only for groups they belong to)
create policy "Goals viewable by owner" on goals
  for select using (user_id = auth.uid());

create policy "Goals insert for owner" on goals
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from group_members gm
      where gm.group_id = goals.group_id
        and gm.user_id = auth.uid()
    )
  );

create policy "Goals update for owner" on goals
  for update using (user_id = auth.uid());

create policy "Goals delete for owner" on goals
  for delete using (user_id = auth.uid());

-- Atomic penalty application
-- This function is called from the client; it verifies ownership + membership
-- and updates the goal + group fund in one transaction.
create or replace function apply_goal_penalty(p_goal_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_penalty integer;
begin
  update goals
     set penalized = true
   where id = p_goal_id
     and user_id = auth.uid()
     and completed = false
     and penalized = false
     and due_date < now()::date
     and exists (
       select 1 from group_members gm
       where gm.group_id = goals.group_id
         and gm.user_id = auth.uid()
     )
  returning group_id, penalty_points
    into v_group_id, v_penalty;

  if v_group_id is null then
    return false;
  end if;

  update groups
     set fund_points = fund_points + v_penalty
   where id = v_group_id
     and exists (
       select 1 from group_members gm
       where gm.group_id = v_group_id
         and gm.user_id = auth.uid()
     );

  return true;
end;
$$;

grant execute on function apply_goal_penalty(uuid) to authenticated;

-- Optional: auto-create profile rows when a new auth user signs up.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', 'new-user'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
