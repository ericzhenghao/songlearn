/**
 * 全局曲库 —— 曲库是项目资产，不属于某个浏览器：
 *
 * 元数据（歌名/歌手/对齐好的歌词/热度）存在 npoint.io 公共 JSON 库（免注册免密钥，
 * 所有访问者读写同一个库）；音频文件匿名上传 catbox.moe 拿永久直链，别人打开
 * 你的歌可以直接唱。猫箱上传失败时歌词+时间轴照样共享——那才是曲库真正的资产。
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
  /** 音频永久直链 —— 朋友点开就能唱；null = 仅共享歌词+时间轴 */
  audioUrl: string | null;
  audioMime: string;
  /** 累计学唱人次（全局热度） */
  plays: number;
  /** 上传者昵称 */
  by: string;
  addedAt: number;
};

type LibDoc = { v: 1; songs: GlobalSong[] };

const NPOINT = "https://api.npoint.io";
const LIB_KEY = "sl-global-lib";
const NICK_KEY = "sl-nick";

/** 部署者可预置库 ID（写进代码，所有部署默认进同一个库）；留空则由首位访问者一键创建 */
export const DEFAULT_BIN = "";

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

/* ---------------- npoint 读写 ---------------- */

const timeoutSignal = (ms: number) => {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

/** 一键创建新的全局曲库，返回库 ID */
export async function createLib(): Promise<string> {
  const res = await fetch(NPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, songs: [] } satisfies LibDoc),
    signal: timeoutSignal(9000),
  });
  if (!res.ok) throw new Error(`创建失败（HTTP ${res.status}）`);
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("创建失败：服务未返回库 ID");
  return data.id;
}

export async function readLib(bin: string): Promise<GlobalSong[]> {
  const res = await fetch(`${NPOINT}/${encodeURIComponent(bin)}`, { signal: timeoutSignal(9000) });
  if (!res.ok) throw new Error(`读取失败（HTTP ${res.status}），检查库 ID 是否正确`);
  const doc = (await res.json()) as Partial<LibDoc>;
  return Array.isArray(doc.songs) ? doc.songs : [];
}

/** 读-改-写整库（小规模共享足够；冲突时随机退避重试一次） */
async function writeLib(bin: string, songs: GlobalSong[]): Promise<void> {
  const body = JSON.stringify({ v: 1, songs } satisfies LibDoc);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${NPOINT}/${encodeURIComponent(bin)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: timeoutSignal(9000),
    });
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
  }
  throw new Error("写入库失败（网络或并发冲突），稍后会自动重试");
}

/* ---------------- 曲库条目操作 ---------------- */

/** 新歌入库：同名歌已存在则更新并置顶，否则追加；返回最新列表 */
export async function pushGlobal(bin: string, song: GlobalSong): Promise<GlobalSong[]> {
  const songs = await readLib(bin);
  const key = `${song.title.trim().toLowerCase()}|${song.artist.trim().toLowerCase()}`;
  const idx = songs.findIndex(
    (s) => `${s.title.trim().toLowerCase()}|${s.artist.trim().toLowerCase()}` === key
  );
  if (idx >= 0) {
    const old = songs[idx];
    songs[idx] = {
      ...song,
      plays: old.plays,
      /* 新上传没带上的部分保留旧直链（歌词/音频各自独立） */
      lrcUrl: song.lrcUrl ?? old.lrcUrl,
      audioUrl: song.audioUrl ?? old.audioUrl,
    };
  } else {
    songs.unshift(song);
  }
  /* 索引只存引用（约 250B/首），免费额度可容纳 ~300 首；正文和音频都在 catbox 永久直链上 */
  await writeLib(bin, songs.slice(0, 300));
  return songs;
}

/** 学唱人次 +1 */
export async function bumpPlays(bin: string, id: string): Promise<void> {
  try {
    const songs = await readLib(bin);
    const s = songs.find((x) => x.id === id);
    if (!s) return;
    s.plays += 1;
    await writeLib(bin, songs);
  } catch {
    /* 热度统计失败不影响学唱 */
  }
}

export async function removeGlobal(bin: string, id: string): Promise<GlobalSong[]> {
  const songs = (await readLib(bin)).filter((s) => s.id !== id);
  await writeLib(bin, songs);
  return songs;
}

/* ---------------- 内容托管（catbox.moe 匿名上传，永久直链） ---------------- */

const CATBOX = "https://catbox.moe/user/api.php";
const CATBOX_RE = /^https:\/\/files\.catbox\.moe\/\S+$/;

/** 音频上限 60MB（猫箱单文件允许 200MB；常见 MP3 3–9MB，MV 视频也基本够） */
export const MAX_AUDIO = 60 * 1024 * 1024;

/** 上传小文本（.lrc 歌词文件）拿永久直链 */
export async function hostText(text: string, name: string): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.append("reqtype", "fileupload");
    fd.append("fileToUpload", new Blob([text], { type: "text/plain" }), name);
    const res = await fetch(CATBOX, { method: "POST", body: fd, signal: timeoutSignal(30000) });
    const url = (await res.text()).trim();
    return CATBOX_RE.test(url) ? url : null;
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
    const fd = new FormData();
    fd.append("reqtype", "fileupload");
    fd.append("fileToUpload", blob, name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", CATBOX);
    xhr.timeout = 180000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      const url = xhr.responseText.trim();
      resolve(xhr.status === 200 && CATBOX_RE.test(url) ? url : null);
    };
    xhr.onerror = () => resolve(null);
    xhr.ontimeout = () => resolve(null);
    xhr.send(fd);
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
