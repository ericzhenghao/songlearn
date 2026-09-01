/**
 * 联网找歌词（lrclib.net 免费歌词库，免密钥、支持浏览器直连）。
 * 多通道 + 分层匹配，防止「同名歌串词」和「认出歌却拿不到词」。
 */

export type Candidate = {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number;
  hasSynced: boolean;
  instrumental: boolean;
  synced: string | null;
  plain: string | null;
};

const API = "https://lrclib.net/api";

async function getJSON(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function searchLrclib(q: string, artist?: string): Promise<Candidate[]> {
  const params = new URLSearchParams({ q });
  if (artist) params.set("artist_name", artist);
  const data = (await getJSON(`${API}/search?${params}`)) as Partial<Candidate>[];
  if (!Array.isArray(data)) return [];
  return data.map((d) => ({
    id: d.id ?? 0,
    trackName: d.trackName ?? "",
    artistName: d.artistName || "未知艺人",
    albumName: d.albumName ?? undefined,
    duration: d.duration || 0,
    hasSynced: !!d.synced,
    instrumental: !!d.instrumental,
    synced: d.synced || null,
    plain: d.plain || null,
  }));
}

export async function fetchById(id: number): Promise<{ synced: string | null; plain: string | null }> {
  const d = (await getJSON(`${API}/get/${id}`)) as { syncedLyrics?: string; plainLyrics?: string };
  return { synced: d.syncedLyrics || null, plain: d.plainLyrics || null };
}

/** 备源：lyrics.ovh（纯文本） */
export async function fetchPlain(artist: string, title: string): Promise<string | null> {
  try {
    const d = (await getJSON(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
    )) as { lyrics?: string };
    return d.lyrics || null;
  } catch {
    return null;
  }
}

/* 归一化：去重音 / 小写 / 去标点，用于防串歌比对 */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

export function matchesSong(c: Candidate, title: string, artist: string): boolean {
  return norm(c.trackName) === norm(title) && (!artist || norm(c.artistName) === norm(artist));
}

export type FoundLyrics = {
  text: string;
  synced: boolean;
  via: string;
  trackName: string;
  artistName: string;
};

/**
 * 认出歌名+歌手后取歌词。通道：
 *  ① lrclib 精确接口（直接返回完整记录）
 *  ② 模糊搜索 + 分层匹配（歌名+歌手优先），搜索不带全文时按 id 补全
 *  ③ lyrics.ovh 备源
 */
export async function fetchLyricsForRecognizedSong(
  title: string,
  artist: string,
  _duration: number
): Promise<FoundLyrics | null> {
  /* ① 精确接口 */
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const d = (await getJSON(`${API}/get?${params}`)) as {
      syncedLyrics?: string;
      plainLyrics?: string;
      trackName?: string;
      artistName?: string;
    };
    const text = d.syncedLyrics || d.plainLyrics;
    if (text) {
      return {
        text,
        synced: !!d.syncedLyrics,
        via: "lrclib 精确接口",
        trackName: d.trackName || title,
        artistName: d.artistName || artist,
      };
    }
  } catch {
    /* 继续 */
  }

  /* ② 模糊搜索 */
  const queries: [string, string | undefined][] = [
    [title, artist],
    [`${artist} ${title}`, undefined],
    [title, undefined],
  ];
  for (const [q, ar] of queries) {
    try {
      const cands = await searchLrclib(q, ar);
      const ranked = cands
        .filter((c) => !c.instrumental && (c.synced || c.plain || c.hasSynced))
        .sort((a, b) => Number(b.hasSynced) - Number(a.hasSynced));
      const best =
        ranked.find((c) => matchesSong(c, title, artist)) ||
        ranked.find((c) => norm(c.trackName) === norm(title)) ||
        ranked[0];
      if (!best) continue;
      let text = best.synced || best.plain;
      let synced = !!best.synced;
      if (!text && best.id) {
        const p = await fetchById(best.id);
        text = p.synced || p.plain;
        synced = !!p.synced;
      }
      if (text) {
        return { text, synced, via: "lrclib 搜索", trackName: best.trackName, artistName: best.artistName };
      }
    } catch {
      continue;
    }
  }

  /* ③ 备源 */
  const plain = await fetchPlain(artist, title);
  if (plain) return { text: plain, synced: false, via: "lyrics.ovh", trackName: title, artistName: artist };

  return null;
}

/* ---------------- 歌词语言检测（轻量） ---------------- */

const SPANISH_MARKERS = ["ñ", "¿", "¡", "á", "é", "í", "ó", "ú"];
const SPANISH_WORDS = ["que", "como", "para", "pero", "porque", "esta", "muy", "tambien", "corazon", "contigo"];

export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 2000).toLowerCase();
  if (/[\u4e00-\u9fff]/.test(sample)) return "zh";
  if (/[\u3040-\u30ff]/.test(sample)) return "ja";
  if (/[\uac00-\ud7af]/.test(sample)) return "ko";
  if (/[a-zà-ÿ]/.test(sample)) {
    let esScore = 0;
    for (const m of SPANISH_MARKERS) if (sample.includes(m)) esScore += m === "ñ" || m === "¿" || m === "¡" ? 3 : 1;
    const words = sample.split(/[^a-zà-ÿ']+/).filter(Boolean);
    const uniq = new Set(words);
    for (const w of SPANISH_WORDS) if (uniq.has(w) || uniq.has(w.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) esScore += 2;
    if (esScore >= 4) return "es";
    return "en";
  }
  return null;
}
