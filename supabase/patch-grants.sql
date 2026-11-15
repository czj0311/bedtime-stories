-- 一次性补丁：修复「录音上传后显示同步失败」
-- 原因：public.stories 的列级 INSERT 授权漏了主键 id，
--       而客户端会显式写入 id，导致整条 INSERT 被 Postgres 以 42501 拒绝。
-- 用法：Supabase Dashboard → SQL Editor → New query → 全选粘贴 → Run。
-- 可重复执行；不会改动任何已有数据。

grant insert (id) on table public.stories to authenticated;
grant update (updated_at) on table public.story_states to authenticated;

-- 下面这段会直接输出验证结果，三项都应为 true：
select
  has_column_privilege('authenticated', 'public.stories', 'id', 'INSERT')             as stories_id_insert_ok,
  has_column_privilege('authenticated', 'public.stories', 'content_cipher', 'INSERT')  as stories_cipher_insert_ok,
  has_column_privilege('authenticated', 'public.story_states', 'updated_at', 'UPDATE') as states_updated_at_ok;