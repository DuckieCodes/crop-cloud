-- Crop Cloud database.
-- Supabase dashboard › SQL Editor › New query: paste this file and press Run.
-- It is safe to run again after changes; every statement replaces what it made before.

-- Turns text into a uuid, or null when it isn't one (for storage paths and channel names).
create or replace function public.try_uuid(value text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return value::uuid;
exception when others then
  return null;
end $$;

-- ============================================================
-- Plans and profiles
-- ============================================================

create table if not exists public.plans (
  id text primary key,
  name text not null,
  storage_bytes bigint not null,
  price_cents integer,                  -- per interval; null until a price is set
  currency text not null default 'usd',
  interval text not null default 'month' check (interval in ('month', 'year')),
  stripe_price_id text,                 -- filled in once payments are set up
  sort integer not null default 0,
  active boolean not null default true  -- only active plans are offered
);

-- Everyone starts on Free (10 GB). The bigger tiers stay hidden until you
-- give them a price and set active = true.
insert into public.plans (id, name, storage_bytes, price_cents, sort, active) values
  ('free', 'Free', 10737418240, 0, 0, true),
  ('plus', 'Plus', 107374182400, null, 1, false),
  ('pro', 'Pro', 1099511627776, null, 2, false)
on conflict (id) do nothing;

alter table public.plans enable row level security;
drop policy if exists "Anyone can see plans" on public.plans;
create policy "Anyone can see plans" on public.plans for select using (true);
revoke insert, update, delete on public.plans from anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  plan_id text not null default 'free' references public.plans,
  plan_renews_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
-- People can change their name, never their plan.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'name', ''), 40))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sign-ups are invite-only: only emails on this list can create an account.
-- Add people in Table Editor › allowed_signups, or:
--   insert into public.allowed_signups (email) values ('friend@example.com');
create table if not exists public.allowed_signups (
  email text primary key check (email = lower(email)),
  note text not null default '',
  added_at timestamptz not null default now()
);
alter table public.allowed_signups enable row level security;
revoke all on public.allowed_signups from anon, authenticated;

create or replace function public.check_signup_allowed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.allowed_signups where email = lower(new.email)) then
    raise exception 'Sign-ups are invite-only: % is not on the list.', new.email;
  end if;
  return new;
end $$;

drop trigger if exists before_auth_user_created on auth.users;
create trigger before_auth_user_created before insert on auth.users
  for each row execute function public.check_signup_allowed();

-- ============================================================
-- Shared projects
-- People you invite can watch, view and comment. Only the owner can change
-- the project (and the files are only ever written by the owner's apps).
-- ============================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  app text not null check (app in ('photocrop', 'framecrop')),
  name text not null check (char_length(name) between 1 and 200),
  snapshot_path text,  -- in the "projects" bucket: <owner id>/<project id>/...
  thumb_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user on public.project_members (user_id);

-- Invites wait here until the friend signs in with that email and accepts.
create table if not exists public.project_invites (
  project_id uuid not null references public.projects on delete cascade,
  email text not null check (email = lower(email)),
  invited_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, email)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  author_id uuid not null default auth.uid() references auth.users on delete cascade,
  parent_id uuid references public.comments on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  frame integer,       -- FrameCrop: timeline position, in frames
  x real,              -- PhotoCrop: pin position, in document pixels
  y real,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists comments_project on public.comments (project_id, created_at);

create or replace function public.owns_project(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = pid and owner_id = auth.uid());
$$;

create or replace function public.can_view_project(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = pid and owner_id = auth.uid())
      or exists (select 1 from public.project_members where project_id = pid and user_id = auth.uid());
$$;

-- True when you and uid are both on some project (so you can see each other's names).
create or replace function public.shares_project_with(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with mine as (
    select id from public.projects where owner_id = auth.uid()
    union
    select project_id from public.project_members where user_id = auth.uid()
  )
  select exists (select 1 from public.projects p join mine on mine.id = p.id where p.owner_id = uid)
      or exists (select 1 from public.project_members m join mine on mine.id = m.project_id where m.user_id = uid);
$$;

drop policy if exists "See your profile and your collaborators'" on public.profiles;
create policy "See your profile and your collaborators'" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_project_with(id));
drop policy if exists "Edit your own profile" on public.profiles;
create policy "Edit your own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

alter table public.projects enable row level security;
revoke update on public.projects from anon, authenticated;
grant update (name, snapshot_path, thumb_path, updated_at) on public.projects to authenticated;
drop policy if exists "Owners and members see projects" on public.projects;
-- owner_id is checked on the row itself because a new project isn't visible to
-- can_view_project() yet while the insert hands the row back.
create policy "Owners and members see projects" on public.projects for select to authenticated
  using (owner_id = auth.uid() or public.can_view_project(id));
drop policy if exists "Create your own projects" on public.projects;
create policy "Create your own projects" on public.projects for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists "Owners change projects" on public.projects;
create policy "Owners change projects" on public.projects for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Owners delete projects" on public.projects;
create policy "Owners delete projects" on public.projects for delete to authenticated
  using (owner_id = auth.uid());

alter table public.project_members enable row level security;
revoke insert, update on public.project_members from anon, authenticated;
drop policy if exists "See who's on your projects" on public.project_members;
create policy "See who's on your projects" on public.project_members for select to authenticated
  using (user_id = auth.uid() or public.can_view_project(project_id));
drop policy if exists "Owners remove people, people can leave" on public.project_members;
create policy "Owners remove people, people can leave" on public.project_members for delete to authenticated
  using (user_id = auth.uid() or public.owns_project(project_id));

alter table public.project_invites enable row level security;
revoke insert, update on public.project_invites from anon, authenticated;
drop policy if exists "Owners see their invites" on public.project_invites;
create policy "Owners see their invites" on public.project_invites for select to authenticated
  using (public.owns_project(project_id));
drop policy if exists "Owners cancel invites" on public.project_invites;
create policy "Owners cancel invites" on public.project_invites for delete to authenticated
  using (public.owns_project(project_id));

alter table public.comments enable row level security;
revoke update on public.comments from anon, authenticated;
grant update (body, resolved) on public.comments to authenticated;
drop policy if exists "Everyone on the project sees comments" on public.comments;
create policy "Everyone on the project sees comments" on public.comments for select to authenticated
  using (public.can_view_project(project_id));
drop policy if exists "Everyone on the project can comment" on public.comments;
create policy "Everyone on the project can comment" on public.comments for insert to authenticated
  with check (author_id = auth.uid() and public.can_view_project(project_id));
drop policy if exists "Authors edit, owners resolve" on public.comments;
create policy "Authors edit, owners resolve" on public.comments for update to authenticated
  using (author_id = auth.uid() or public.owns_project(project_id));
drop policy if exists "Authors and owners delete comments" on public.comments;
create policy "Authors and owners delete comments" on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.owns_project(project_id));

-- Owners may resolve anyone's comment but only authors may reword one.
create or replace function public.guard_comment_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.body is distinct from old.body then
    if old.author_id <> auth.uid() then
      raise exception 'Only the author can edit a comment.';
    end if;
    new.edited_at := now();
  end if;
  return new;
end $$;

drop trigger if exists comments_guard on public.comments;
create trigger comments_guard before update on public.comments
  for each row execute function public.guard_comment_update();

-- Invite someone by email. Always answers 'invited', so it can't be used to
-- find out who has an account.
create or replace function public.invite_to_project(pid uuid, invitee_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  address text := lower(trim(invitee_email));
begin
  if not public.owns_project(pid) then
    raise exception 'Only the project owner can invite people.';
  end if;
  if address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That doesn''t look like an email address.';
  end if;
  if address = (select lower(email) from auth.users where id = auth.uid()) then
    raise exception 'That''s your own email.';
  end if;
  insert into public.project_invites (project_id, email) values (pid, address)
  on conflict do nothing;
  return 'invited';
end $$;

-- Invites waiting for the signed-in person.
create or replace function public.my_invites()
returns table (project_id uuid, project_name text, app text, invited_by_name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.project_id, p.name, p.app, coalesce(nullif(pr.display_name, ''), 'Someone'), i.created_at
  from public.project_invites i
  join public.projects p on p.id = i.project_id
  left join public.profiles pr on pr.id = i.invited_by
  join auth.users u on u.id = auth.uid()
  where i.email = lower(u.email) and u.email_confirmed_at is not null
  order by i.created_at desc;
$$;

create or replace function public.respond_to_invite(pid uuid, accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  address text;
begin
  select lower(email) into address from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if address is null or not exists (select 1 from public.project_invites where project_id = pid and email = address) then
    raise exception 'That invite isn''t there any more.';
  end if;
  delete from public.project_invites where project_id = pid and email = address;
  if accept then
    insert into public.project_members (project_id, user_id) values (pid, auth.uid())
    on conflict do nothing;
  end if;
end $$;

-- Functions are callable by everyone unless PUBLIC loses that right.
revoke execute on function public.invite_to_project(uuid, text), public.my_invites(), public.respond_to_invite(uuid, boolean) from public, anon;
grant execute on function public.invite_to_project(uuid, text), public.my_invites(), public.respond_to_invite(uuid, boolean) to authenticated;

-- New comments show up live in the apps.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments') then
    alter publication supabase_realtime add table public.comments;
  end if;
end $$;

-- ============================================================
-- Cloud storage
-- library:  your own files for every app (songs, effects, LUTs, images...)   <your id>/...
-- projects: snapshots of shared projects, readable by everyone on them       <your id>/<project id>/...
-- Both count toward your plan's cap.
-- ============================================================

insert into storage.buckets (id, name, public) values
  ('library', 'library', false),
  ('projects', 'projects', false)
on conflict (id) do nothing;

create or replace function public.storage_used(uid uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects
  where bucket_id in ('library', 'projects') and name like uid::text || '/%';
$$;

create or replace function public.storage_cap(uid uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select pl.storage_bytes from public.profiles p join public.plans pl on pl.id = p.plan_id where p.id = uid),
    (select storage_bytes from public.plans where id = 'free'));
$$;

create or replace function public.storage_status()
returns table (used_bytes bigint, cap_bytes bigint, plan_id text, plan_name text)
language sql stable security definer set search_path = '' as $$
  select public.storage_used(auth.uid()), public.storage_cap(auth.uid()),
         coalesce(p.plan_id, 'free'), coalesce(pl.name, 'Free')
  from (select 1) one
  left join public.profiles p on p.id = auth.uid()
  left join public.plans pl on pl.id = p.plan_id;
$$;

revoke execute on function public.storage_used(uuid), public.storage_cap(uuid) from public, anon, authenticated;
revoke execute on function public.storage_status() from public, anon;
grant execute on function public.storage_status() to authenticated;

-- Uploads are refused once you're at your cap. The apps also check the file's
-- size first, so the cap is only passed by the one upload that reaches it.
create or replace function public.has_storage_room() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.storage_used(auth.uid()) < public.storage_cap(auth.uid());
$$;

drop policy if exists "Library: read your files" on storage.objects;
create policy "Library: read your files" on storage.objects for select to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Library: add files within your cap" on storage.objects;
create policy "Library: add files within your cap" on storage.objects for insert to authenticated
  with check (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text and public.has_storage_room());
drop policy if exists "Library: replace your files" on storage.objects;
create policy "Library: replace your files" on storage.objects for update to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text and public.has_storage_room());
drop policy if exists "Library: delete your files" on storage.objects;
create policy "Library: delete your files" on storage.objects for delete to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Projects: everyone on the project can read" on storage.objects;
create policy "Projects: everyone on the project can read" on storage.objects for select to authenticated
  using (bucket_id = 'projects' and public.can_view_project(public.try_uuid((storage.foldername(name))[2])));
drop policy if exists "Projects: owners upload within their cap" on storage.objects;
create policy "Projects: owners upload within their cap" on storage.objects for insert to authenticated
  with check (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text
              and public.owns_project(public.try_uuid((storage.foldername(name))[2])) and public.has_storage_room());
drop policy if exists "Projects: owners replace files" on storage.objects;
create policy "Projects: owners replace files" on storage.objects for update to authenticated
  using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text
              and public.owns_project(public.try_uuid((storage.foldername(name))[2])) and public.has_storage_room());
drop policy if exists "Projects: owners delete files" on storage.objects;
create policy "Projects: owners delete files" on storage.objects for delete to authenticated
  using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- Watch parties: private Realtime channels named party:<project id>.
-- Everyone on the project can join, see who's there and follow playback.
-- ============================================================

drop policy if exists "Watch party: join" on realtime.messages;
create policy "Watch party: join" on realtime.messages for select to authenticated
  using (realtime.topic() like 'party:%' and public.can_view_project(public.try_uuid(split_part(realtime.topic(), ':', 2))));
drop policy if exists "Watch party: send" on realtime.messages;
create policy "Watch party: send" on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'party:%' and public.can_view_project(public.try_uuid(split_part(realtime.topic(), ':', 2))));
