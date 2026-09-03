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
  /** 取回歌词的实际语言（检测得出） */
  matchedLang: string | null;
  /** 用户声明了演唱语言、但库里没有该语言版本时为 true —— 提醒「词可能跟唱的不一致」 */
  langMismatch: boolean;
};

/** 去掉括号限定词，拿到基础歌名："Waka Waka (This Time for Africa)" → "Waka Waka" */
function baseTitle(t: string): string {
  const b = t
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return b || t;
}

/** 大范围收集候选（多种写法都搜），去重后供「按语言筛选」挑选 */
async function gatherPool(title: string, artist: string): Promise<Candidate[]> {
  const bt = baseTitle(title);
  const queries: [string, string | undefined][] = [
    [title, artist],
    [title, undefined],
    [bt, undefined],
    [`${artist} ${bt}`, undefined],
  ];
  const pool = new Map<number, Candidate>();
  for (const [q, ar] of queries) {
    try {
      const cands = await searchLrclib(q, ar);
      for (const c of cands) if (!pool.has(c.id)) pool.set(c.id, c);
    } catch {
      /* 该写法失败，试下一种 */
    }
    if (pool.size >= 40) break;
  }
  return [...pool.values()].filter((c) => !c.instrumental);
}

/** 候选的贴合度打分：歌名越像、歌手一致、带时间戳，分越高（歌名只是线索之一） */
function score(c: Candidate, title: string, artist: string): number {
  const bt = baseTitle(title);
  let s = 0;
  if (matchesSong(c, title, artist)) s += 4;
  else if (norm(c.trackName) === norm(title)) s += 3;
  else if (norm(c.trackName) === norm(bt)) s += 2;
  else if (norm(bt) && (norm(c.trackName).includes(norm(bt)) || norm(bt).includes(norm(c.trackName)))) s += 1;
  if (artist && norm(c.artistName) === norm(artist)) s += 1;
  if (c.synced) s += 1.5;
  return s;
}

async function ensureText(c: Candidate): Promise<string | null> {
  let t = c.synced || c.plain || null;
  if (!t && c.id) {
    try {
      const p = await fetchById(c.id);
      t = p.synced || p.plain || null;
      if (p.synced) c.synced = p.synced;
    } catch {
      /* 取不到 */
    }
  }
  return t;
}

/**
 * 认出歌名后取歌词 —— 「演唱语言优先」：
 * 歌名可能是英文（Waka Waka），但唱的是西语。歌词语言以 preferredLang（用户在
 * 上传页声明的演唱语言，即"内容"）为第一权威，大范围搜候选后按实际语言筛选，
 * 歌名只当辅助线索。找不到对应语言版本时返回最佳歌名匹配但置 langMismatch=true。
 */
export async function fetchLyricsForRecognizedSong(
  title: string,
  artist: string,
  _duration: number,
  preferredLang: string | null = null
): Promise<FoundLyrics | null> {
  const pool = await gatherPool(title, artist);

  type Eval = { c: Candidate; text: string | null; synced: boolean; lang: string | null; s: number };
  const evaled: Eval[] = pool.map((c) => {
    const text = c.synced || c.plain || null;
    return { c, text, synced: !!c.synced, lang: text ? detectLanguage(text) : null, s: score(c, title, artist) };
  });
  const pickBest = (list: Eval[]) => [...list].sort((a, b) => b.s - a.s)[0] ?? null;

  if (preferredLang) {
    /* 只认"用这种语言唱的"候选 */
    let langMatch = evaled.filter((e) => e.lang === preferredLang && e.text);
    if (langMatch.length === 0) {
      /* 放宽：给高分但没带全文的候选补全歌词，再检测语言 */
      const need = evaled.filter((e) => !e.text).sort((a, b) => b.s - a.s).slice(0, 6);
      for (const e of need) {
        e.text = await ensureText(e.c);
        e.synced = !!e.c.synced;
        e.lang = e.text ? detectLanguage(e.text) : null;
      }
      langMatch = evaled.filter((e) => e.lang === preferredLang && e.text);
    }
    if (langMatch.length > 0) {
      const best = pickBest(langMatch)!;
      return {
        text: best.text!,
        synced: best.synced,
        via: "lrclib · 按演唱语言匹配",
        trackName: best.c.trackName,
        artistName: best.c.artistName,
        matchedLang: preferredLang,
        langMismatch: false,
      };
    }
    /* 库里没有该语言版本：返回歌名最像的，但明确标记"语言对不上" */
    const withText = evaled.filter((e) => e.text);
    const best = pickBest(withText.length ? withText : evaled);
    if (best) {
      if (!best.text) best.text = await ensureText(best.c);
      if (best.text) {
        return {
          text: best.text,
          synced: best.synced,
          via: "lrclib · 未找到该语言版本",
          trackName: best.c.trackName,
          artistName: best.c.artistName,
          matchedLang: best.lang ?? detectLanguage(best.text),
          langMismatch: true,
        };
      }
    }
  } else {
    /* 自动：歌名最贴合的，返回其实际语言供界面展示 */
    const withText = evaled.filter((e) => e.text);
    const best = pickBest(withText.length ? withText : evaled);
    if (best) {
      if (!best.text) best.text = await ensureText(best.c);
      if (best.text) {
        return {
          text: best.text,
          synced: best.synced,
          via: "lrclib 搜索",
          trackName: best.c.trackName,
          artistName: best.c.artistName,
          matchedLang: best.lang ?? detectLanguage(best.text),
          langMismatch: false,
        };
      }
    }
  }

  /* 备源：lyrics.ovh（只能按歌名，无法选语言变体） */
  const plain = await fetchPlain(artist, title);
  if (plain) {
    const lang = detectLanguage(plain);
    return {
      text: plain,
      synced: false,
      via: "lyrics.ovh",
      trackName: title,
      artistName: artist,
      matchedLang: lang,
      langMismatch: preferredLang ? lang !== preferredLang : false,
    };
  }
  return null;
}

/* ---------------- 歌词语言检测（轻量） ---------------- */

const SPANISH_MARKERS = ["ñ", "¿", "¡", "á", "é", "í", "ó", "ú"];
/* 西语高频虚词/歌词词（在英文歌词里几乎不作为独立词出现），命中越多越偏西语 */
const SPANISH_WORDS = [
  "que", "como", "para", "pero", "porque", "esta", "muy", "tambien", "corazon", "contigo",
  "el", "los", "las", "una", "del", "con", "por", "todo", "todos", "hay", "donde", "cuando", "aqui",
];

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
