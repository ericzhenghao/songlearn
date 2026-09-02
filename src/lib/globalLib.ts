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
  /** 对齐好的完整 LRC —— 曲库的核心资产 */
  lrc: string;
  /** 累计学唱人次（全局热度） */
  plays: number;
  /** catbox 音频直链；null = 仅共享歌词 */
  audioUrl: string | null;
  audioMime: string;
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
      audioUrl: song.audioUrl ?? old.audioUrl, // 新上传没带上音频就保留旧直链
    };
  } else {
    songs.unshift(song);
  }
  await writeLib(bin, songs.slice(0, 100)); // 免费额度约 100KB，封顶 100 首
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

/* ---------------- 音频托管（catbox.moe 匿名上传，永久直链） ---------------- */

const MAX_AUDIO = 15 * 1024 * 1024; // 猫箱允许 200MB，这里克制一点加快上传

/** 上传音频拿永久直链；任何失败返回 null（歌词照样共享） */
export async function hostAudio(blob: Blob, name: string): Promise<string | null> {
  if (blob.size > MAX_AUDIO) return null;
  try {
    const fd = new FormData();
    fd.append("reqtype", "fileupload");
    fd.append("fileToUpload", blob, name);
    const res = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: fd,
      signal: timeoutSignal(45000),
    });
    const url = (await res.text()).trim();
    return /^https:\/\/files\.catbox\.moe\/\S+$/.test(url) ? url : null;
  } catch {
    return null;
  }
}

/** 从直链把音频拉回本地成 File（别人打开你的歌时） */
export async function fetchAudio(url: string): Promise<File> {
  const res = await fetch(url, { signal: timeoutSignal(60000) });
  if (!res.ok) throw new Error(`音频下载失败（HTTP ${res.status}）`);
  const blob = await res.blob();
  const name = decodeURIComponent(url.split("/").pop() || "audio.mp3");
  return new File([blob], name, { type: blob.type || "audio/mpeg" });
}
