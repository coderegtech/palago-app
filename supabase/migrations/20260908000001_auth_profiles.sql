-- Phase 2: identity.
--
-- Authentication needs somewhere to put a person, so this migration lands ahead
-- of the main Phase 3 schema. It creates only what auth itself requires: the
-- role enum, the profiles table, its RLS policies, and the trigger that mirrors
-- auth.users into profiles.
--
-- The role enum here must stay identical to `UserRole` in src/constants/enums.ts.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

create type public.user_role as enum (
  'USER',
  'OPERATOR',
  'DRIVER',
  'ASSISTANT',
  'ADMIN'
);

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  phone text,
  avatar_url text,
  role public.user_role not null default 'USER',
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Public profile for each auth.users row. Created automatically on sign-up.';
comment on column public.profiles.role is
  'Authorisation role. Never writable by the account holder - see the column grants below.';

create index profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profile creation on sign-up
--
-- The profile is created by the database, not by the client, so a half-finished
-- registration cannot leave an auth user with no profile.
--
-- `role` is hard-coded to 'USER' and deliberately NOT read from user metadata:
-- raw_user_meta_data is attacker-controlled at sign-up, so trusting a `role`
-- key there would let anyone register themselves as ADMIN. Elevating a role is
-- an administrative action, done with the service role.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), ''),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    'USER'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Role lookup
--
-- SECURITY DEFINER so it bypasses RLS. Reading profiles.role from inside a
-- profiles policy would otherwise recurse infinitely.
-- ---------------------------------------------------------------------------

create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'ADMIN'
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy "Users read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id or public.is_admin());

create policy "Users update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Admins update any profile"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No INSERT or DELETE policy for clients: profiles are created by the sign-up
-- trigger and removed by the cascade from auth.users.

-- ---------------------------------------------------------------------------
-- Column privileges
--
-- RLS decides which ROWS an account may touch; it cannot stop someone updating
-- their own `role` to 'ADMIN' on a row they legitimately own. Column-level
-- grants close that hole in Postgres itself, so it holds regardless of what any
-- future policy says.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.profiles from anon, authenticated;

grant update (
  full_name,
  phone,
  avatar_url,
  emergency_contact_name,
  emergency_contact_phone
) on public.profiles to authenticated;
