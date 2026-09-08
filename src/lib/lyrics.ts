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

/* lrclib /api/search 原始字段名是 syncedLyrics / plainLyrics（注意：不是 synced/plain）。
   早期版本映射错了字段，导致搜索回来的候选"歌词全为空"，语言检测和同步时间戳加成全部失效。 */
type LrclibRaw = {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
};

export async function searchLrclib(q: string, artist?: string): Promise<Candidate[]> {
  const params = new URLSearchParams({ q });
  if (artist) params.set("artist_name", artist);
  const data = (await getJSON(`${API}/search?${params}`)) as LrclibRaw[];
  if (!Array.isArray(data)) return [];
  return data.map((d) => ({
    id: d.id ?? 0,
    trackName: d.trackName ?? "",
    artistName: d.artistName || "未知艺人",
    albumName: d.albumName ?? undefined,
    duration: d.duration || 0,
    hasSynced: !!d.syncedLyrics,
    instrumental: !!d.instrumental,
    synced: d.syncedLyrics || null,
    plain: d.plainLyrics || null,
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

/** 同一首歌的其他语言版本（供学唱页一键切换，无需重新识别） */
export type LyricAlternative = {
  lang: string;
  text: string;
  synced: boolean;
  trackName: string;
  artistName: string;
};

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
  /** 这首歌在歌词库里存在的其他语言版本 */
  alternatives: LyricAlternative[];
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

/** 大范围收集候选（多种写法都搜），去重后供「按语言筛选」挑选。
 * 关键：所有查询都要跑完——同一首歌的外语版（如 Waka Waka 西语版 "Esto es África"）
 * 只在"歌手+基础歌名"这类模糊查询里出现，提前截断候选池会把外语版丢掉。 */
async function gatherPool(title: string, artist: string): Promise<Candidate[]> {
  const bt = baseTitle(title);
  const queries: [string, string | undefined][] = [
    [title, artist],
    [bt, artist],
    [title, undefined],
    [bt, undefined],
    [artist ? `${artist} ${bt}` : bt, undefined],
  ];
  const pool = new Map<number, Candidate>();
  for (const [q, ar] of queries) {
    if (!q || !q.trim()) continue;
    try {
      const cands = await searchLrclib(q, ar);
      for (const c of cands) if (!pool.has(c.id)) pool.set(c.id, c);
    } catch {
      /* 该写法失败，试下一种 */
    }
  }
  return [...pool.values()].filter((c) => !c.instrumental);
}

/** 候选的贴合度打分：歌手一致性 > 歌名写法 > 时间戳/时长。
 * 教训：同名歌很多（reggaeton 也有一首叫 Waka Waka 的），歌名完全匹配但歌手不符时必须压分，
 * 否则会把"另一首同名歌"的歌词当成目标歌。 */
function score(c: Candidate, title: string, artist: string, duration = 0): number {
  const bt = baseTitle(title);
  const nt = norm(c.trackName);
  const nT = norm(title);
  const nb = norm(bt);
  let s = 0;
  if (matchesSong(c, title, artist)) s += 4;
  else if (nt === nT) s += 2.5;
  else if (nb && nt === nb) s += 1.5;
  else if (nb && (nt.includes(nb) || nb.includes(nt))) s += 0.5;
  /* 歌手一致性：强权重。feat/合作歌手写法（"Shakira feat. Freshlyground"）算模糊一致 */
  if (artist) {
    const na = norm(c.artistName);
    const nA = norm(artist);
    if (na === nA) s += 2;
    else if (na && nA && (na.includes(nA) || nA.includes(na))) s += 1;
    else s -= 2; /* 歌手明确不符：同名串歌，压到同语言正确歌手版本之下 */
  }
  if (c.synced) s += 1.5;
  /* 时长贴近度：同一首歌的不同语言版本时长几乎一致，翻唱/混音/现场差很多。
     用户上传的是短片段（<30s）时不参与打分。 */
  if (duration > 30 && c.duration) {
    const dd = Math.abs(c.duration - duration);
    if (dd < 5) s += 1.2;
    else if (dd < 15) s += 0.6;
    else if (dd > 40) s -= 1.5;
  }
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
 * 上传页声明的演唱语言，即"内容"）为第一权威；rememberedLang 是上次学这首歌时
 * 用户手动切换过的版本（自动模式下也沿用）。大范围搜候选后按实际语言筛选，
 * 歌名只当辅助线索。找不到对应语言版本时返回最佳歌名匹配但置 langMismatch=true。
 * 返回值带 alternatives（其他语言版本），学唱页可一键切换、无需重新识别。
 */
export async function fetchLyricsForRecognizedSong(
  title: string,
  artist: string,
  duration: number,
  preferredLang: string | null = null,
  rememberedLang: string | null = null
): Promise<FoundLyrics | null> {
  const pool = await gatherPool(title, artist);

  type Eval = { c: Candidate; text: string | null; synced: boolean; lang: string | null; s: number };
  const evaled: Eval[] = [];
  for (const c of pool) {
    // 搜索接口已内联歌词（syncedLyrics/plainLyrics）；极少数没有的再按 id 补取
    let text = c.synced || c.plain || null;
    if (!text) text = await ensureText(c);
    evaled.push({
      c,
      text,
      synced: !!c.synced,
      lang: text ? detectLanguage(text) : null,
      s: score(c, title, artist, duration),
    });
  }
  const withText = evaled.filter((e) => e.text);
  const pickBest = (list: Eval[]) => [...list].sort((a, b) => b.s - a.s)[0] ?? null;

  const buildResult = (e: Eval, via: string, mismatch: boolean): FoundLyrics => {
    /* 备选版本：每种其他语言取分最高的一条（用户可在学唱页一键切换） */
    const alts: LyricAlternative[] = [];
    const seenLang = new Set<string>([e.lang ?? ""]);
    for (const x of [...withText].sort((a, b) => b.s - a.s)) {
      if (!x.lang || seenLang.has(x.lang)) continue;
      if (x.s < 2) continue;
      seenLang.add(x.lang);
      alts.push({
        lang: x.lang,
        text: x.text!,
        synced: x.synced,
        trackName: x.c.trackName,
        artistName: x.c.artistName,
      });
      if (alts.length >= 3) break;
    }
    return {
      text: e.text!,
      synced: e.synced,
      via,
      trackName: e.c.trackName,
      artistName: e.c.artistName,
      matchedLang: e.lang ?? detectLanguage(e.text!),
      langMismatch: mismatch,
      alternatives: alts,
    };
  };

  /* 1) 用户明确声明的演唱语言：全候选池按检测语言筛选（字段修复后池内候选都带歌词文本） */
  if (preferredLang) {
    const langMatch = withText.filter((e) => e.lang === preferredLang);
    if (langMatch.length > 0) {
      return buildResult(pickBest(langMatch)!, "lrclib · 按演唱语言匹配", false);
    }
    /* 库里没有该语言版本：返回歌名最像的，但明确标记"语言对不上" */
    const best = pickBest(withText);
    if (best) return buildResult(best, "lrclib · 未找到该语言版本", true);
  }

  /* 2) 自动模式 + 上次学过这首歌切过语言：沿用用户上次的选择 */
  if (rememberedLang && rememberedLang !== preferredLang) {
    const remembered = withText.filter((e) => e.lang === rememberedLang);
    if (remembered.length > 0) {
      return buildResult(pickBest(remembered)!, "lrclib · 按你上次选择匹配", false);
    }
  }

  /* 3) 全自动：歌名/歌手/时长综合最贴合的，返回其实际语言供界面展示 */
  const best = pickBest(withText);
  if (best) return buildResult(best, "lrclib 搜索", false);

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
      alternatives: [],
    };
  }
  return null;
}

/* ---------------- 歌词语言检测（轻量，多语言） ---------------- */

/** 去掉 LRC 时间戳/元标签，只留歌词正文（避免 [ti:...] 英文歌名干扰检测） */
function stripLrcTags(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\[[^\]]*\]/g, " "))
    .join(" ");
}

/** 词归一：去重音 → 小写 → 只留字母（qué→que, aquí→aqui, coração→coracao） */
const normWord = (w: string): string =>
  w
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

/* 各语言高频虚词/歌词常用词（去重音形式）。共享词（que/para/la…）同时计入相邻语言，
   靠专属词总量拉开差距；词表均为"在另一种语言歌词里几乎不作为整词出现"的形式。 */
const STOPWORDS: Record<string, string[]> = {
  es: [
    "el", "la", "los", "las", "del", "hay", "muy", "pero", "tambien", "esto", "esta", "este", "eres",
    "soy", "somos", "vamos", "dale", "quiero", "siempre", "nunca", "puedo", "corazon", "contigo",
    "muralla", "batalla", "momento", "miedo", "siente", "vuelve", "espera", "gente", "tierra",
    "fuego", "noche", "amor", "cuando", "donde", "aqui", "alla", "como", "porque", "contra",
    "entre", "desde", "hasta", "sobre", "todo", "toda", "una", "llega", "comienza", "golpe",
  ],
  en: [
    "the", "you", "your", "yours", "for", "and", "with", "but", "because", "this", "that", "are",
    "was", "were", "have", "has", "dont", "cant", "every", "all", "not", "its", "im", "ive",
    "gonna", "wanna", "love", "heart", "night", "always", "never", "life", "come", "back",
    "waiting", "feel", "pressure", "people", "time", "fear", "battle", "soldier", "choose",
    "watching", "closer", "over", "under", "again", "then", "when", "where", "here", "there",
    "their", "they", "them", "from", "into", "off", "out", "yourself", "frontline",
  ],
  fr: [
    "le", "les", "des", "une", "dans", "pour", "avec", "mais", "nous", "vous", "je", "tu",
    "il", "elle", "cest", "ne", "pas", "sur", "tout", "tous", "mon", "ma", "mes", "ton",
    "coeur", "amour", "toujours", "quand", "comment", "tres", "bien", "soir", "nuit", "vie",
    "reviens", "attends", "lumiere", "peur", "bataille", "gens", "terre", "feu", "jamais",
    "veux", "fais", "fait", "etre", "avoir", "leur", "eux", "sans", "sous", "chez", "moi", "toi",
  ],
  de: [
    "ich", "du", "wir", "ihr", "ist", "sind", "ein", "eine", "und", "aber", "nicht", "mit",
    "auf", "das", "die", "der", "den", "dem", "auch", "noch", "nur", "wenn", "weil", "immer",
    "nie", "herz", "liebe", "nacht", "leben", "zeit", "komm", "geh", "wieder", "warte",
    "feuer", "erde", "menschen", "angst", "schlacht", "moment", "fuhlen", "zuruck", "uber",
    "unter", "vor", "nach", "aus", "bei", "vom", "zum", "kein", "mein", "dein", "sein",
  ],
  pt: [
    "nao", "voce", "muito", "muita", "mas", "tudo", "todas", "linda", "falar", "olha", "deixa",
    "samba", "coracao", "noite", "sempre", "nunca", "vida", "volta", "espera", "fogo", "terra",
    "gente", "medo", "momento", "sentir", "pressao", "batalha", "muralha", "chegou", "comecar",
    "existe", "frente", "linha", "onde", "quando", "aqui", "ali", "como", "porque", "seu",
    "sua", "teu", "minha", "meu", "tudo", "hoje", "amanha", "faz", "fica", "vem", "vai",
  ],
  it: [
    "che", "non", "sono", "sei", "siamo", "per", "perche", "come", "dove", "quando", "qui",
    "tutto", "tutti", "molto", "bene", "amore", "cuore", "notte", "sempre", "mai", "vita",
    "torna", "aspetta", "fuoco", "terra", "gente", "paura", "momento", "sentire", "pressione",
    "battaglia", "muro", "arriva", "inizia", "esiste", "fronte", "riga", "qua", "mio", "mia",
    "tuo", "sua", "nostro", "vostro", "degli", "nello", "sullo", "fai", "fare", "vai", "vieni",
  ],
};

/* 某语言专属字符（别的拉丁语言几乎不用），命中给强分 */
const SPECIAL_CHARS: { lang: string; re: RegExp; w: number }[] = [
  { lang: "es", re: /[ñ¿¡]/g, w: 6 },
  { lang: "pt", re: /[ãõ]/g, w: 6 },
  { lang: "de", re: /[ßäöü]/g, w: 4 },
  { lang: "fr", re: /[œâêîôûëïç]/g, w: 2 },
];

export function detectLanguage(text: string): string | null {
  const sample = stripLrcTags(text).slice(0, 3000);
  const lower = sample.toLowerCase();
  if (/[\u4e00-\u9fff]/.test(lower)) return "zh";
  if (/[\u3040-\u30ff]/.test(lower)) return "ja";
  if (/[\uac00-\ud7af]/.test(lower)) return "ko";
  if (!/[a-zà-ÿ]/i.test(lower)) return null;

  const words = lower
    .split(/[^a-zà-ÿ']+/g)
    .filter(Boolean)
    .map(normWord)
    .filter(Boolean);
  if (words.length < 3) return null;
  const uniq = new Set(words);

  const scores: Record<string, number> = {};
  for (const [lang, sw] of Object.entries(STOPWORDS)) {
    let s = 0;
    for (const w of sw) if (uniq.has(w)) s += 2;
    scores[lang] = s;
  }
  for (const sp of SPECIAL_CHARS) {
    const n = (lower.match(sp.re) || []).length;
    if (n) scores[sp.lang] = (scores[sp.lang] || 0) + Math.min(n, 6) * sp.w;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestLang, bestScore] = ranked[0];
  if (bestScore >= 4) return bestLang;
  return "en"; // 拉丁字母但特征不足：流行歌词默认英语
}
