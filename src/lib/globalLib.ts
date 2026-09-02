/**
 * 全局曲库 —— 曲库是项目资产，不属于某个浏览器：
 *
 * 后端 = Supabase（内置项目配置，所有访问者读写同一个共享库）：
 *  - 歌曲索引（歌名/歌手/歌词直链/音频直链/热度/上传者）→ songlearn_shared 表
 *  - 歌词正文（.lrc 文本）与音频文件 → songs 存储桶（公开 URL）
 *
 * 「曲库链接」= 你的部署地址 + ?lib=库ID。发朋友圈就是发这条链接，
 * 任何人点开都进入同一个曲库；他上传的歌也会自动进这个库。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type GlobalSong = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  lang: string | null;
  duration: number;
  /** 歌词行数（列表里显示学习进度用，不用拉全文） */
  lines: number;
  /** 旧版库把歌词内联在索引里；新版走 lrcUrl，读取时两者兼容 */
  lrc?: string;
  /** 对齐好的完整 LRC 的永久直链（.lrc 文本文件，几 KB） */
  lrcUrl?: string | null;
  /** 音频永久直链 —— 朋友点开就能唱；null = 仅共享歌词+时间轴 */
  audioUrl: string | null;
  audioMime: string;
  /** 音频字节数（容量统计用，索引里只多 ~8B） */
  audioSize?: number;
  /** 累计学唱人次（全局热度） */
  plays: number;
  /** 上传者昵称 */
  by: string;
  addedAt: number;
};

type LibDoc = { v: 1; songs: GlobalSong[] };

/* ---------------- Supabase 内置配置（项目资产的一部分） ---------------- */

const SUPABASE_URL = "https://bgdhsntgvsbgedxaebdg.supabase.co";
const SUPABASE_ANON = "sb_publishable_bJ8XjE80w4yn0LRLePWXeg_V2DSGz6N";
const TABLE = "songlearn_shared";
const BUCKET = "songs";

let sb: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (!sb) sb = createClient(SUPABASE_URL, SUPABASE_ANON);
  return sb;
}

const LIB_KEY = "sl-global-lib";
const NICK_KEY = "sl-nick";

/** 默认共享库 ID：开箱即用，所有部署/访问者默认进同一个库 */
export const DEFAULT_BIN = "main";

/* ---------------- 库的连接（localStorage + URL ?lib= 参数） ---------------- */

export function libFromUrl(): string | null {
  try {
    const p = new URLSearchParams(window.location.search).get("lib");
    return p && p.trim() ? p.trim() : null;
  } catch {
    return null;
  }
}

export function loadLib(): string | null {
  const fromUrl = libFromUrl();
  if (fromUrl) {
    localStorage.setItem(LIB_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(LIB_KEY) || DEFAULT_BIN || null;
}

export function saveLib(bin: string | null): void {
  if (bin) localStorage.setItem(LIB_KEY, bin);
  else localStorage.removeItem(LIB_KEY);
}

/** 生成可分享的曲库链接 */
export function libLink(bin: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?lib=${bin}`;
}

/* ---------------- 昵称（上传者署名） ---------------- */

export function loadNick(): string {
  let n = localStorage.getItem(NICK_KEY);
  if (!n) {
    n = `听友-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    localStorage.setItem(NICK_KEY, n);
  }
  return n;
}

export function saveNick(n: string): void {
  localStorage.setItem(NICK_KEY, n.trim() || loadNick());
}

/* ---------------- 行 → GlobalSong 映射 ---------------- */

type Row = {
  bin_id: string;
  id: string;
  title: string;
  artist: string;
  album: string | null;
  lang: string | null;
  duration: number;
  lines: number;
  lrc_url: string | null;
  audio_url: string | null;
  audio_mime: string;
  audio_size: number;
  plays: number;
  by: string;
  added_at: number;
};

function rowToGlobal(r: Row): GlobalSong {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album ?? undefined,
    lang: r.lang,
    duration: Number(r.duration) || 0,
    lines: r.lines,
    lrcUrl: r.lrc_url,
    audioUrl: r.audio_url,
    audioMime: r.audio_mime || "audio/mpeg",
    audioSize: r.audio_size,
    plays: r.plays,
    by: r.by,
    addedAt: r.added_at,
  };
}

/* ---------------- Supabase 读写 ---------------- */

/** 无需真创建：表已内置，返回默认库 ID（幂等） */
export async function createLib(): Promise<string> {
  return DEFAULT_BIN;
}

export async function readLib(bin: string): Promise<GlobalSong[]> {
  const { data, error } = await client()
    .from(TABLE)
    .select("*")
    .eq("bin_id", bin)
    .order("added_at", { ascending: false });
  if (error) throw new Error(`读取共享库失败：${error.message}`);
  return (data as Row[] | null)?.map(rowToGlobal) ?? [];
}

/** 读-改-写整库（Supabase 直接按行 upsert，无整库冲突问题） */
async function writeLib(bin: string, songs: GlobalSong[]): Promise<void> {
  /* 仅当 caller 需要整体覆盖时用（保留给 bumpPlays/removeGlobal 之外不使用） */
  const rows = songs.map((s) => ({
    bin_id: bin,
    id: s.id,
    title: s.title,
    artist: s.artist,
    album: s.album ?? null,
    lang: s.lang,
    duration: s.duration,
    lines: s.lines,
    lrc_url: s.lrcUrl ?? null,
    audio_url: s.audioUrl,
    audio_mime: s.audioMime,
    audio_size: s.audioSize ?? 0,
    plays: s.plays,
    by: s.by,
    added_at: s.addedAt,
  }));
  const { error } = await client().from(TABLE).upsert(rows, {
    onConflict: "bin_id,id",
  });
  if (error) throw new Error(`写入共享库失败：${error.message}`);
}

/* ---------------- 曲库条目操作 ---------------- */

/** 新歌入库：同名歌已存在则更新并置顶，否则追加；返回最新列表 */
export async function pushGlobal(bin: string, song: GlobalSong): Promise<GlobalSong[]> {
  /* 查重（同歌名+歌手） */
  const keyTitle = song.title.trim();
  const keyArtist = song.artist.trim();
  const { data: exist, error: qErr } = await client()
    .from(TABLE)
    .select("id,plays,lrc_url,audio_url")
    .eq("bin_id", bin)
    .eq("title", keyTitle)
    .eq("artist", keyArtist)
    .limit(1)
    .maybeSingle();
  if (qErr) throw new Error(`查询失败：${qErr.message}`);

  const row = {
    bin_id: bin,
    id: song.id,
    title: keyTitle,
    artist: keyArtist,
    album: song.album ?? null,
    lang: song.lang,
    duration: song.duration,
    lines: song.lines,
    lrc_url: song.lrcUrl ?? exist?.lrc_url ?? null,
    audio_url: song.audioUrl ?? exist?.audio_url ?? null,
    audio_mime: song.audioMime,
    audio_size: song.audioSize ?? 0,
    plays: exist?.plays ?? song.plays ?? 0,
    by: song.by,
    added_at: song.addedAt,
  };

  if (exist) {
    const { error } = await client()
      .from(TABLE)
      .update(row)
      .eq("bin_id", bin)
      .eq("id", exist.id);
    if (error) throw new Error(`更新失败：${error.message}`);
  } else {
    const { error } = await client().from(TABLE).insert(row);
    if (error) throw new Error(`入库失败：${error.message}`);
  }
  return readLib(bin);
}

/** 学唱人次 +1 */
export async function bumpPlays(bin: string, id: string): Promise<void> {
  try {
    const { data, error } = await client()
      .from(TABLE)
      .select("plays")
      .eq("bin_id", bin)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return;
    await client()
      .from(TABLE)
      .update({ plays: (data.plays || 0) + 1 })
      .eq("bin_id", bin)
      .eq("id", id);
  } catch {
    /* 热度统计失败不影响学唱 */
  }
}

export async function removeGlobal(bin: string, id: string): Promise<GlobalSong[]> {
  const { error } = await client().from(TABLE).delete().eq("bin_id", bin).eq("id", id);
  if (error) throw new Error(`删除失败：${error.message}`);
  return readLib(bin);
}

/* ---------------- 内容托管（Supabase Storage，公开 URL） ---------------- */

/** 单文件上限（Supabase 免费档单文件约束，常见 MP3 3–9MB 完全够用） */
export const MAX_AUDIO = 50 * 1024 * 1024;

/** 索引容量（Supabase 免费档数据库行数约 5 万行，这里给个保守展示值） */
export const LIB_SONG_CAP = 400;

const timeoutSignal = (ms: number) => {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

/** 上传小文本（.lrc 歌词文件）拿永久直链 */
export async function hostText(text: string, name: string): Promise<string | null> {
  try {
    const safe = name.replace(/[^\w.\-]+/g, "_");
    const path = `lyrics/${Date.now()}-${safe}`;
    const { error } = await client()
      .storage.from(BUCKET)
      .upload(path, new Blob([text], { type: "text/plain" }), {
        contentType: "text/plain",
        upsert: true,
      });
    if (error) return null;
    return client().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

/** 上传音频拿永久直链；带进度回调；超限或失败返回 null（降级为仅共享歌词） */
export function hostAudio(
  blob: Blob,
  name: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<string | null> {
  if (blob.size > MAX_AUDIO) return Promise.resolve(null);
  const safe = name.replace(/[^\w.\-]+/g, "_");
  const path = `${Date.now()}-${safe}`;
  return new Promise((resolve) => {
    client()
      .storage.from(BUCKET)
      .upload(path, blob, {
        contentType: blob.type || "audio/mpeg",
        upsert: true,
        onUploadProgress: (e) => {
          if (e && typeof e.total === "number" && onProgress) onProgress(e.loaded ?? 0, e.total);
        },
      })
      .then(({ error }) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(client().storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
      })
      .catch(() => resolve(null));
  });
}

/** 从直链把音频拉回本地成 File（别人打开你的歌时） */
export async function fetchAudio(url: string): Promise<File> {
  const res = await fetch(url, { signal: timeoutSignal(120000) });
  if (!res.ok) throw new Error(`音频下载失败（HTTP ${res.status}）`);
  const blob = await res.blob();
  const name = decodeURIComponent(url.split("/").pop() || "audio.mp3");
  return new File([blob], name, { type: blob.type || "audio/mpeg" });
}

/** 从直链拉歌词文本（索引里只存链接，正文在这） */
export async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: timeoutSignal(20000) });
    if (!res.ok) return null;
    const t = await res.text();
    return t.trim() ? t : null;
  } catch {
    return null;
  }
}
