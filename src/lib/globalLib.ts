/**
 * 全局曲库 —— 曲库是项目资产，不属于某个浏览器：
 *
 * 元数据（歌名/歌手/对齐好的歌词/热度）存在 Supabase 表 songlearn_shared，
 * 按 bin_id 分库（每个「共享曲库」一个 bin，分享链接 ?lib=bin 指向同一个库）；
 * 歌词与音频文件匿名上传 Supabase Storage（public bucket "songs"）拿永久直链，
 * 别人打开你的歌可以直接唱。直链失败时歌词+时间轴照样共享——那才是曲库真正的资产。
 *
 * 「曲库链接」= 你的部署地址 + ?lib=库ID。发朋友圈就是发这条链接，
 * 任何人点开都进入同一个曲库；他上传的歌也会自动进这个库。
 */

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
  /** 词级对齐结果（Timings JSON）的永久直链。LRC 正文格式不可变，词级数据只能另存一份 */
  timingsUrl?: string | null;
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

/* ---------------- Supabase 配置 ---------------- */

const SB_URL = "https://bgdhsntgvsbgedxaebdg.supabase.co";
const SB_KEY = "sb_publishable_bJ8XjE80w4yn0LRLePWXeg_V2DSGz6N";
const SB_TABLE = "songlearn_shared";
/** 公共存储桶：音频与 .lrc 歌词直链都放这里 */
const SB_BUCKET = "songs";

const SB_HDR: Record<string, string> = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
};

/** 行 → 前端模型 */
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
  audio_size: number | null;
  plays: number;
  by: string;
  added_at: number;
};

const rowToGlobal = (r: Row): GlobalSong => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  album: r.album ?? undefined,
  lang: r.lang,
  duration: r.duration,
  lines: r.lines,
  lrcUrl: r.lrc_url,
  timingsUrl: null,
  audioUrl: r.audio_url,
  audioMime: r.audio_mime,
  audioSize: r.audio_size ?? undefined,
  plays: r.plays,
  by: r.by,
  addedAt: r.added_at,
});

const globalToRow = (bin: string, s: GlobalSong): Row => ({
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
  audio_size: s.audioSize ?? null,
  plays: s.plays,
  by: s.by,
  added_at: s.addedAt,
});

const LIB_KEY = "sl-global-lib";
const NICK_KEY = "sl-nick";

/** 部署者可预置库 ID（写进代码，所有部署默认进同一个库）；留空则由首位访问者一键创建 */
export const DEFAULT_BIN = "main";

/* ---------------- 安全存储：localStorage 被禁用时页面照样能开 ---------------- */
/*
 * 预览 iframe / 第三方上下文 / 隐私模式下，localStorage 可能同步抛 SecurityError。
 * 一旦在首帧渲染里抛错，整个 React 树挂载失败 → 白屏（"预览打不开"）。
 * 这里统一包一层：抛错就落到内存 Map，功能降级但页面必开。
 */
const mem = new Map<string, string>();

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return mem.get(key) ?? null;
  }
}

export function lsSet(key: string, value: string): void {
  mem.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 内存兜底 */
  }
}

export function lsRemove(key: string): void {
  mem.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 库的连接（安全存储 + URL ?lib= 参数） ---------------- */

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
    lsSet(LIB_KEY, fromUrl);
    return fromUrl;
  }
  return lsGet(LIB_KEY) || DEFAULT_BIN || null;
}

export function saveLib(bin: string | null): void {
  if (bin) lsSet(LIB_KEY, bin);
  else lsRemove(LIB_KEY);
}

/** 生成可分享的曲库链接 */
export function libLink(bin: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?lib=${bin}`;
}

/* ---------------- 昵称（上传者署名） ---------------- */

export function loadNick(): string {
  let n = lsGet(NICK_KEY);
  if (!n) {
    n = `听友-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    lsSet(NICK_KEY, n);
  }
  return n;
}

export function saveNick(n: string): void {
  lsSet(NICK_KEY, n.trim() || loadNick());
}

/* ---------------- Supabase 读写 ---------------- */

const timeoutSignal = (ms: number) => {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

const api = (path: string) => `${SB_URL}/rest/v1/${SB_TABLE}${path}`;
const q = (v: string) => encodeURIComponent(v);

/** 一键创建新的共享曲库，返回库 ID（表已存在且 key 可写 = 创建成功） */
export async function createLib(): Promise<string> {
  const bin = `sl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const res = await fetch(api(`?select=bin_id&limit=1&bin_id=eq.${q(bin)}`), {
    headers: SB_HDR,
    signal: timeoutSignal(9000),
  });
  if (!res.ok) throw new Error(`创建失败（HTTP ${res.status}）`);
  return bin;
}

export async function readLib(bin: string): Promise<GlobalSong[]> {
  const res = await fetch(
    api(`?select=*&bin_id=eq.${q(bin)}&order=added_at.desc`),
    { headers: SB_HDR, signal: timeoutSignal(9000) }
  );
  if (!res.ok) throw new Error(`读取失败（HTTP ${res.status}），检查库 ID 是否正确`);
  const rows = (await res.json()) as Row[];
  return rows.map(rowToGlobal);
}

/** 全量替换一个库（写整库；小规模共享足够，冲突时随机退避重试一次） */
async function writeLib(bin: string, songs: GlobalSong[]): Promise<void> {
  const rows = songs.map((s) => globalToRow(bin, s));
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      /* 先删该库旧行，再批量插入 = 整文档覆盖语义 */
      await fetch(api(`?bin_id=eq.${q(bin)}`), {
        method: "DELETE",
        headers: SB_HDR,
        signal: timeoutSignal(9000),
      });
      if (rows.length === 0) return;
      const res = await fetch(api(``), {
        method: "POST",
        headers: { ...SB_HDR, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
        signal: timeoutSignal(12000),
      });
      if (res.ok || res.status === 201) return;
      lastStatus = res.status;
    } catch {
      lastStatus = 0;
    }
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
  }
  if (lastStatus >= 400 && lastStatus < 500) {
    throw new Error(`写入共享库失败（HTTP ${lastStatus}），可能是表权限或容量限制`);
  }
  throw new Error("写入共享库失败（网络波动），稍后会自动重试");
}

/* ---------------- 曲库条目操作 ---------------- */

const sameKey = (t: string, a: string) => `${t.trim().toLowerCase()}|${a.trim().toLowerCase()}`;

/** 新歌入库：同名歌已存在则更新并置顶，否则追加；返回最新列表 */
export async function pushGlobal(bin: string, song: GlobalSong): Promise<GlobalSong[]> {
  const key = sameKey(song.title, song.artist);
  /* 查同名行（该 bin 内） */
  const exist = await fetch(
    api(`?select=*&bin_id=eq.${q(bin)}&limit=20`),
    { headers: SB_HDR, signal: timeoutSignal(9000) }
  ).then((r) => (r.ok ? (r.json() as Promise<Row[]>) : []));
  const old = exist.find((x) => sameKey(x.title, x.artist) === key);

  if (old) {
    const merged = globalToRow(bin, {
      ...song,
      plays: old.plays,
      lrcUrl: song.lrcUrl ?? old.lrc_url,
      timingsUrl: null,
      audioUrl: song.audioUrl ?? old.audio_url,
    });
    /* 更新时间戳 → 按 added_at 排序自然置顶 */
    merged.added_at = Date.now();
    await fetch(api(`?id=eq.${q(old.id)}`), {
      method: "PATCH",
      headers: { ...SB_HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(merged),
      signal: timeoutSignal(9000),
    });
  } else {
    const row = globalToRow(bin, song);
    row.added_at = Date.now();
    await fetch(api(``), {
      method: "POST",
      headers: { ...SB_HDR, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([row]),
      signal: timeoutSignal(9000),
    });
  }
  return readLib(bin);
}

/** 词级对齐结果：表结构暂无 timings 列，保持 no-op 兼容旧调用 */
export async function pushTimings(_bin: string, _id: string, _timingsUrl: string): Promise<void> {
  /* 词级时间轴暂不共享；朋友端句级时间轴 + 本地后端对齐兜底 */
}

/** 学唱人次 +1 */
export async function bumpPlays(bin: string, id: string): Promise<void> {
  try {
    const rows = (await fetch(api(`?select=plays&bin_id=eq.${q(bin)}&id=eq.${q(id)}&limit=1`), {
      headers: SB_HDR,
      signal: timeoutSignal(9000),
    }).then((r) => (r.ok ? r.json() : []))) as { plays: number }[];
    const plays = rows[0]?.plays ?? 0;
    await fetch(api(`?bin_id=eq.${q(bin)}&id=eq.${q(id)}`), {
      method: "PATCH",
      headers: { ...SB_HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ plays: plays + 1 }),
      signal: timeoutSignal(9000),
    });
  } catch {
    /* 热度统计失败不影响学唱 */
  }
}

export async function removeGlobal(bin: string, id: string): Promise<GlobalSong[]> {
  await fetch(api(`?bin_id=eq.${q(bin)}&id=eq.${q(id)}`), {
    method: "DELETE",
    headers: SB_HDR,
    signal: timeoutSignal(9000),
  });
  return readLib(bin);
}

/* ---------------- 内容托管（Supabase Storage 永久直链） ---------------- */

/** 单文件上限 150MB（常见 MP3 3–9MB，1080P MV 通常 60–150MB） */
export const MAX_AUDIO = 150 * 1024 * 1024;

/** 索引容量：表按行存储不设硬上限，保留常量防单库无限膨胀 */
export const LIB_SONG_CAP = 400;

const storageUrl = (path: string) => `${SB_URL}/storage/v1/object/${SB_BUCKET}/${path}`;
const storagePublic = (path: string) => `${SB_URL}/storage/v1/object/public/${SB_BUCKET}/${path}`;

/** 上传小文本（.lrc 歌词文件）拿永久直链 */
export async function hostText(text: string, name: string): Promise<string | null> {
  try {
    const safe = name.replace(/[^\w.\-]+/g, "-");
    const path = `lyrics/${Date.now()}-${safe}`;
    const res = await fetch(storageUrl(path), {
      method: "POST",
      headers: { ...SB_HDR, "x-upsert": "true" },
      body: new Blob([text], { type: "text/plain;charset=utf-8" }),
      signal: timeoutSignal(30000),
    });
    return res.ok ? storagePublic(path) : null;
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
  return new Promise((resolve) => {
    const safe = name.replace(/[^\w.\-]+/g, "-");
    const path = `${Date.now()}-${safe}`;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", storageUrl(path));
    xhr.setRequestHeader("apikey", SB_KEY);
    xhr.setRequestHeader("Authorization", `Bearer ${SB_KEY}`);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.timeout = 180000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? storagePublic(path) : null);
    xhr.onerror = () => resolve(null);
    xhr.ontimeout = () => resolve(null);
    xhr.send(blob);
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
