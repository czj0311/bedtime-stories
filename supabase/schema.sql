-- 双人私密晚安故事：Supabase Auth / Postgres / Realtime / Storage。
-- 由项目所有者在 Supabase SQL Editor 执行；全脚本可重复执行，不含任何真实密钥。

create extension if not exists pgcrypto with schema extensions;

-- 每个 couple 保存一份邀请信息及由客户端管理的密钥包裹元数据。
create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  invite_code text not null unique,
  invite_expires_at timestamptz not null,
  key_salt text,
  wrapped_key text,
  key_iv text,
  kdf_iterations integer check (kdf_iterations is null or kdf_iterations > 0),
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now()
);

-- user_id 的唯一约束与 PK 共同保证：一个用户至多属于一个空间。
create table if not exists public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (couple_id, user_id),
  unique (user_id)
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  content_cipher text not null,
  content_iv text not null,
  audio_path text unique,
  audio_iv text,
  mime text not null default 'audio/mpeg',
  duration integer check (duration is null or duration >= 0),
  byte_size bigint check (byte_size is null or byte_size >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stories_couple_created_idx
  on public.stories (couple_id, created_at desc);

create table if not exists public.story_states (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  favorite boolean not null default false,
  position real not null default 0 check (position >= 0),
  updated_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

-- 仅由触发器调用，统一维护 stories / story_states 的更新时间。
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists stories_set_updated_at on public.stories;
create trigger stories_set_updated_at
before update on public.stories
for each row execute function public.set_updated_at();

drop trigger if exists story_states_set_updated_at on public.story_states;
create trigger story_states_set_updated_at
before update on public.story_states
for each row execute function public.set_updated_at();

-- SECURITY DEFINER 以表所有者身份查询成员关系，避免 couple_members 的 RLS 自引用递归。
-- 固定空 search_path、全限定对象名并关闭行安全；仅项目所有者应拥有此函数。
create or replace function public.is_couple_member(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.couple_members as cm
    where cm.couple_id = p_couple_id
      and cm.user_id = (select auth.uid())
  );
$$;

-- 创建空间时同时加入创建者；邀请码使用 24 个随机字节（192 位熵）的十六进制编码。
create or replace function public.create_couple()
returns table (id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_couple_id uuid;
  v_invite_code text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.couple_members as cm where cm.user_id = v_user_id
  ) then
    raise exception 'User already belongs to a couple';
  end if;

  v_invite_code := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.couples as c (created_by, invite_code, invite_expires_at)
  values (v_user_id, v_invite_code, pg_catalog.now() + interval '7 days')
  returning c.id into v_couple_id;

  insert into public.couple_members (couple_id, user_id)
  values (v_couple_id, v_user_id);

  return query select v_couple_id, v_invite_code;
end;
$$;

-- 锁定邀请对应的 couple 行，串行化加入操作，防止并发加入突破两人上限。
create or replace function public.join_couple(code text)
returns table (couple_id uuid)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_couple_id uuid;
  v_invite_expires_at timestamptz;
  v_member_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.couple_members as cm where cm.user_id = v_user_id
  ) then
    raise exception 'User already belongs to a couple';
  end if;

  select c.id, c.invite_expires_at
  into v_couple_id, v_invite_expires_at
  from public.couples as c
  where c.invite_code = pg_catalog.btrim(code)
  for update;

  if not found then
    raise exception 'Invalid invite code';
  end if;

  if v_invite_expires_at <= pg_catalog.now() then
    raise exception 'Invite code has expired';
  end if;

  select count(*) into v_member_count
  from public.couple_members as cm
  where cm.couple_id = v_couple_id;

  if v_member_count >= 2 then
    raise exception 'Couple is full';
  end if;

  insert into public.couple_members (couple_id, user_id)
  values (v_couple_id, v_user_id);

  return query select v_couple_id;
end;
$$;

-- 明确撤销默认 PUBLIC 执行权；匿名角色不能调用任何业务函数或触发器函数。
revoke all privileges on function public.set_updated_at() from public, anon, authenticated;
revoke all privileges on function public.is_couple_member(uuid) from public, anon, authenticated;
revoke all privileges on function public.create_couple() from public, anon, authenticated;
revoke all privileges on function public.join_couple(text) from public, anon, authenticated;

grant execute on function public.is_couple_member(uuid) to authenticated;
grant execute on function public.create_couple() to authenticated;
grant execute on function public.join_couple(text) to authenticated;

-- 先清除可能存在的旧授权，再授予最小权限；service_role 仍由 Supabase 管理。
revoke all privileges on table public.couples from public, anon, authenticated;
revoke all privileges on table public.couple_members from public, anon, authenticated;
revoke all privileges on table public.stories from public, anon, authenticated;
revoke all privileges on table public.story_states from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on table public.couples to authenticated;
grant update (key_salt, wrapped_key, key_iv, kdf_iterations, key_version)
  on table public.couples to authenticated;
grant select on table public.couple_members to authenticated;

-- 不授予正文列 UPDATE：首版客户端不能编辑 content_cipher / content_iv。
grant select, delete on table public.stories to authenticated;
grant insert (
  couple_id, author_id, content_cipher, content_iv,
  audio_path, audio_iv, mime, duration, byte_size
) on table public.stories to authenticated;
grant update (audio_path, audio_iv, mime, duration, byte_size)
  on table public.stories to authenticated;

grant select on table public.story_states to authenticated;
grant insert (story_id, user_id, favorite, position)
  on table public.story_states to authenticated;
grant update (favorite, position) on table public.story_states to authenticated;

alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.stories enable row level security;
alter table public.story_states enable row level security;

-- couples：所有成员可读，只有创建者可改密钥包裹字段（列权限进一步限制字段范围）。
drop policy if exists couples_select_member on public.couples;
create policy couples_select_member
on public.couples for select to authenticated
using (public.is_couple_member(id));

drop policy if exists couples_update_creator on public.couples;
create policy couples_update_creator
on public.couples for update to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

-- 成员关系只由 create_couple / join_couple 写入，不开放直接 INSERT / UPDATE / DELETE。
drop policy if exists couple_members_select_member on public.couple_members;
create policy couple_members_select_member
on public.couple_members for select to authenticated
using (public.is_couple_member(couple_id));

drop policy if exists stories_select_member on public.stories;
create policy stories_select_member
on public.stories for select to authenticated
using (public.is_couple_member(couple_id));

drop policy if exists stories_insert_member on public.stories;
create policy stories_insert_member
on public.stories for insert to authenticated
with check (
  public.is_couple_member(couple_id)
  and author_id = (select auth.uid())
);

drop policy if exists stories_update_member on public.stories;
create policy stories_update_member
on public.stories for update to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));

drop policy if exists stories_delete_member on public.stories;
create policy stories_delete_member
on public.stories for delete to authenticated
using (public.is_couple_member(couple_id));

-- 状态既必须属于当前用户，也必须对应当前用户所在空间的故事。
drop policy if exists story_states_select_own on public.story_states;
create policy story_states_select_own
on public.story_states for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.stories as s
    where s.id = story_states.story_id
      and public.is_couple_member(s.couple_id)
  )
);

drop policy if exists story_states_insert_own on public.story_states;
create policy story_states_insert_own
on public.story_states for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.stories as s
    where s.id = story_states.story_id
      and public.is_couple_member(s.couple_id)
  )
);

drop policy if exists story_states_update_own on public.story_states;
create policy story_states_update_own
on public.story_states for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.stories as s
    where s.id = story_states.story_id
      and public.is_couple_member(s.couple_id)
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.stories as s
    where s.id = story_states.story_id
      and public.is_couple_member(s.couple_id)
  )
);

-- 私有音频 bucket；重复执行会再次确保 public = false，不覆盖其他 bucket 配置。
insert into storage.buckets (id, name, public)
values ('story-audio', 'story-audio', false)
on conflict (id) do update set public = false;

-- 注意：storage.objects 的 RLS 已由 Supabase 默认开启，且平台自 2025-04 起禁止
-- 对该系统表执行 ALTER TABLE（会报 42501 must be owner of table objects）。
-- 此处只创建策略，不改表本身。

-- 对象路径必须为 <couple UUID>/<filename>；CASE 先验证格式，避免非法 UUID 转换错误。
-- 所有操作均校验当前用户对路径首段空间的成员资格，UPDATE 同时校验新旧路径。
drop policy if exists story_audio_select_member on storage.objects;
create policy story_audio_select_member
on storage.objects for select to authenticated
using (
  bucket_id = 'story-audio'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_couple_member(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists story_audio_insert_member on storage.objects;
create policy story_audio_insert_member
on storage.objects for insert to authenticated
with check (
  bucket_id = 'story-audio'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_couple_member(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists story_audio_update_member on storage.objects;
create policy story_audio_update_member
on storage.objects for update to authenticated
using (
  bucket_id = 'story-audio'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_couple_member(((storage.foldername(name))[1])::uuid)
    else false
  end
)
with check (
  bucket_id = 'story-audio'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_couple_member(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists story_audio_delete_member on storage.objects;
create policy story_audio_delete_member
on storage.objects for delete to authenticated
using (
  bucket_id = 'story-audio'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_couple_member(((storage.foldername(name))[1])::uuid)
    else false
  end
);

-- Supabase 已存在 supabase_realtime publication；仅在未加入时添加，重复执行不报错。
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stories'
  ) then
    alter publication supabase_realtime add table public.stories;
  end if;
end;
$$;
