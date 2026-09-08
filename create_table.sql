-- SongLearn 共享曲库表（在 Supabase SQL Editor 里执行一次即可）
-- 说明：npoint 已不再向新用户开放 API key，云端存储改用你的 Supabase 项目。
-- 歌曲索引存此表；歌词(.lrc)与音频文件存 songs 存储桶（公开）。

create table if not exists public.songlearn_shared (
  bin_id      text not null default 'main',
  id          text not null,
  title       text not null,
  artist      text not null default '',
  album       text,
  lang        text,
  duration    numeric default 0,
  lines       integer default 0,
  lrc_url     text,
  audio_url   text,
  audio_mime  text default 'audio/mpeg',
  audio_size  bigint default 0,
  plays       integer default 0,
  by          text default '听友',
  added_at    bigint default 0,
  primary key (bin_id, id)
);

-- 公开读写策略（publishable key 可读写，无需登录）
alter table public.songlearn_shared enable row level security;

drop policy if exists "songlearn_shared 公开读" on public.songlearn_shared;
create policy "songlearn_shared 公开读"
  on public.songlearn_shared for select using (true);

drop policy if exists "songlearn_shared 公开写" on public.songlearn_shared;
create policy "songlearn_shared 公开写"
  on public.songlearn_shared for insert with check (true);

drop policy if exists "songlearn_shared 公开改" on public.songlearn_shared;
create policy "songlearn_shared 公开改"
  on public.songlearn_shared for update using (true) with check (true);

drop policy if exists "songlearn_shared 公开删" on public.songlearn_shared;
create policy "songlearn_shared 公开删"
  on public.songlearn_shared for delete using (true);

-- 确认 songs 存储桶公开可读（若桶不存在则创建）
insert into storage.buckets (id, name, public)
values ('songs', 'songs', true)
on conflict (id) do update set public = true;

drop policy if exists "songs 公开读" on storage.objects;
create policy "songs 公开读"
  on storage.objects for select using (bucket_id = 'songs');

drop policy if exists "songs 公开写" on storage.objects;
create policy "songs 公开写"
  on storage.objects for insert with check (bucket_id = 'songs');

drop policy if exists "songs 公开改" on storage.objects;
create policy "songs 公开改"
  on storage.objects for update using (bucket_id = 'songs') with check (bucket_id = 'songs');
