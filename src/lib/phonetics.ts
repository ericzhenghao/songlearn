/**
 * 音标（IPA）模块 —— 免费、免密钥、带缓存：
 *  - 英文（en*）：dictionaryapi.dev 免费词典接口取标准 IPA
 *  - 西班牙语（es）：发音规则性极强，本地按拼读规则转写 IPA（含重音标记）
 *  - 其他语言：暂无音标源，返回 null（界面隐藏音标，不报错）
 */

const cache = new Map<string, string | null>();

function timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/* ---------------- 英文：内置常用词表 → Free Dictionary API → 有道 三级 ---------------- */

/** 内置英文常用词音标表（173 词，离线可用，覆盖英文歌高频词） */
import enIpaTable from "../data/en-ipa.json";

/** 有道 jsonapi（node 通；浏览器多数环境 CORS 会拦截，作为兜底尝试） */
async function youdaoIpa(word: string): Promise<string | null> {
  const res = await fetch(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`, {
    signal: timeoutSignal(9000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    simple?: { word?: { usphone?: string; ukphone?: string }[] };
  };
  const w = j.simple?.word?.[0];
  const ipa = w?.usphone || w?.ukphone;
  return typeof ipa === "string" && ipa.trim() ? `/${ipa.trim()}/` : null;
}

/** Free Dictionary API（CORS 友好、免 key；国内网络部分环境不可达） */
async function dictApiIpa(word: string): Promise<string | null> {
  const res = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    { signal: timeoutSignal(8000) },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { phonetic?: string; phonetics?: { text?: string }[] }[];
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  let ipa: string | null = null;
  for (const p of first.phonetics ?? []) {
    const t = p.text?.trim();
    if (t && (/[\/\[\]]/.test(t) || /[ˈˌ]/.test(t))) {
      ipa = t;
      break;
    }
  }
  if (!ipa && first.phonetic) ipa = first.phonetic.trim();
  if (!ipa && first.phonetics?.[0]?.text) ipa = first.phonetics[0].text.trim();
  return ipa || null;
}

async function enIpa(word: string): Promise<string | null> {
  // ① 内置常用词表（离线、无网络）
  const local = (enIpaTable as Record<string, string>)[word.toLowerCase()];
  if (local) return `/${local}/`;
  // ② 网络兜底
  for (const fn of [dictApiIpa, youdaoIpa]) {
    try {
      const ipa = await fn(word);
      if (ipa) return ipa;
    } catch {
      /* 换下一个源 */
    }
  }
  return null;
}

/* ---------------- 西班牙语：本地拼读规则转写 ---------------- */

const ES_VOWEL = "aeiouáéíóúü";
const isEsVowel = (c: string) => ES_VOWEL.includes(c);

/** 把西语词切成 token（多字符单位优先） */
function esTokens(word: string): string[] {
  const w = word.toLowerCase().normalize("NFC");
  const out: string[] = [];
  let i = 0;
  while (i < w.length) {
    const three = w.slice(i, i + 3);
    const two = w.slice(i, i + 2);
    const c = w[i];
    if (three === "güe" || three === "güi") {
      out.push(three);
      i += 3;
    } else if (two === "ch" || two === "ll" || two === "rr" || two === "gu" || two === "qu") {
      out.push(two);
      i += 2;
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out;
}

/** 音节切分（用于定重音位置）：基于 token 索引定位元音核，再把辅音串分配到核 */
function esSyllabify(tokens: string[]): string[][] {
  const isV = (t: string) => t.length === 1 && isEsVowel(t);
  const STRONG = "aeo";
  const STRESSED = "áéíóú";
  const isDiph = (a: string, b: string) =>
    !STRESSED.includes(a) && !STRESSED.includes(b) &&
    !(STRONG.includes(a) && STRONG.includes(b)) &&
    (STRONG.includes(a) || STRONG.includes(b) || a !== b);

  // 1) 定位每个元音核的 [start,end] token 索引（相邻元音可合并为双元音）
  const cores: { start: number; end: number }[] = [];
  let curStart = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isV(t)) {
      if (curStart === -1) {
        curStart = i;
      } else {
        // 与当前核最后一个元音（tokens[i-1]，必然相邻）构成双元音则并入
        if (isDiph(tokens[i - 1], t)) continue;
        cores.push({ start: curStart, end: i - 1 });
        curStart = i;
      }
    } else {
      if (curStart !== -1) {
        cores.push({ start: curStart, end: i - 1 });
        curStart = -1;
      }
    }
  }
  if (curStart !== -1) cores.push({ start: curStart, end: tokens.length - 1 });
  if (cores.length === 0) return [];

  const onsetClusters = new Set([
    "pr", "br", "tr", "dr", "cr", "gr", "fr", "fl", "cl", "gl", "pl", "bl",
    "ch", "ll", "rr",
  ]);

  const syllables: string[][] = [];
  const n = cores.length;
  for (let i = 0; i < n; i++) {
    // 本核之前的辅音串：tokens[cores[i-1].end+1 .. cores[i].start-1]（i=0 时从 0 开始）
    const cStart = i === 0 ? 0 : cores[i - 1].end + 1;
    const before = tokens.slice(cStart, cores[i].start);
    let onset: string[];
    let rest: string[] = [];
    if (i === 0) {
      onset = before; // 词首辅音全部作 onset
    } else if (before.length === 0) {
      onset = [];
    } else {
      const last1 = before[before.length - 1];
      const last2 = before.length >= 2 ? before.slice(before.length - 2).join("") : "";
      const take = last2 && onsetClusters.has(last2) ? 2 : 1;
      onset = before.slice(before.length - take);
      rest = before.slice(0, before.length - take);
    }
    syllables.push([...onset, ...tokens.slice(cores[i].start, cores[i].end + 1)]);
    // 未进 onset 的辅音归到前一音节
    if (rest.length && i > 0) syllables[i - 1].push(...rest);
  }
  // 词尾辅音归最后一个音节
  const tail = tokens.slice(cores[n - 1].end + 1);
  if (tail.length) syllables[syllables.length - 1].push(...tail);
  return syllables;
}

/** 重音位置（0-based 在哪个音节上） */
function esStress(syllables: string[][]): number {
  const n = syllables.length;
  if (n === 0) return 0;
  if (n === 1) return 0;
  // 找重音符号
  for (let i = 0; i < n; i++) {
    if (syllables[i].some((t) => "áéíóú".includes(t))) return i;
  }
  // 末字母
  const lastTok = syllables[n - 1][syllables[n - 1].length - 1] ?? "";
  const endsVowelOrNS = /[aeiouáéíóúüns]$/.test(lastTok);
  return endsVowelOrNS ? n - 2 : n - 1;
}

/** 把一个西语词转成 IPA 字符串 */
export function esToIpa(word: string): string | null {
  const w = word.toLowerCase().normalize("NFC");
  if (!/[a-záéíóúüñ]/.test(w)) return null;
  const tokens = esTokens(w);
  const syllables = esSyllabify(tokens);
  const stressIdx = esStress(syllables);

  const mapTok = (t: string, prev: string | null, next: string | null, wordStart: boolean): string => {
    switch (t) {
      case "a": return "a";
      case "e": return "e";
      case "i": return "i";
      case "o": return "o";
      case "u": return "u";
      case "á": return "a";
      case "é": return "e";
      case "í": return "i";
      case "ó": return "o";
      case "ú": return "u";
      case "ü": return "w";
      case "b": case "v":
        return wordStart || (prev && "mn".includes(prev)) ? "b" : "β";
      case "c":
        return next && "ei".includes(next) ? "s" : "k";
      case "ch": return "tʃ";
      case "d":
        return wordStart || (prev && "nl".includes(prev)) ? "d" : "ð";
      case "f": return "f";
      case "g":
        if (next && "ei".includes(next)) return "x";
        if (prev === "u" ) return "g"; // gue/gui 的 u 不发音，g 已映射
        return "g";
      case "gu":
        // gu + e/i → g（u 不发音）；gu + a/o → gw
        return next && "ei".includes(next) ? "g" : "gw";
      case "güe": return "gwe";
      case "güi": return "gwi";
      case "h": return "";
      case "j": return "x";
      case "k": return "k";
      case "l": return "l";
      case "ll": return "ʝ";
      case "m": return "m";
      case "n": return "n";
      case "ñ": return "ɲ";
      case "p": return "p";
      case "qu": return "k";
      case "r":
        return wordStart || (prev === "r") ? "r" : "ɾ";
      case "rr": return "r";
      case "s": return "s";
      case "t": return "t";
      case "w": return "w";
      case "x": return wordStart ? "s" : "ks";
      case "y": return "ʝ";
      case "z": return "s";
      default: return "";
    }
  };

  // 逐音节生成，重音音节前加 ˈ
  let out = "";
  for (let si = 0; si < syllables.length; si++) {
    const syl = syllables[si];
    if (si === stressIdx) out += "ˈ";
    const wordStartOfSyllable = si === 0;
    for (let ti = 0; ti < syl.length; ti++) {
      const t = syl[ti];
      const prevTok = ti > 0 ? syl[ti - 1] : si > 0 ? syllables[si - 1][syllables[si - 1].length - 1] : null;
      const nextTok = ti + 1 < syl.length ? syl[ti + 1] : si + 1 < syllables.length ? syllables[si + 1][0] : null;
      const ws = wordStartOfSyllable && ti === 0;
      // 双元音中的前弱元音 → 半元音（i→j，u/ü→w）
      const isDiphGlide =
        ti + 1 < syl.length &&
        "iuü".includes(t) &&
        syl[ti + 1].length === 1 &&
        isEsVowel(syl[ti + 1]);
      if (isDiphGlide) {
        out += t === "i" ? "j" : "w";
        continue;
      }
      out += mapTok(t, prevTok, nextTok, ws);
    }
  }
  // 清理：去掉连续空白（h 删除可能产生）
  out = out.replace(/\s+/g, "");
  return out ? `/${out}/` : null;
}

/* ---------------- 统一入口 ---------------- */

/** 取单词 IPA；lang 为歌曲语言代码（en/es/fr/...）。未知语言或失败返回 null */
export async function getIpa(word: string, lang: string | null | undefined): Promise<string | null> {
  const key = `${lang ?? ""}|${word.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let ipa: string | null = null;
  const l = (lang || "").toLowerCase();
  if (l.startsWith("en")) {
    ipa = await enIpa(word.toLowerCase());
  } else if (l.startsWith("es")) {
    ipa = esToIpa(word);
  }
  cache.set(key, ipa);
  return ipa;
}

/** 同步获取西语音标（无网络请求，用于批量渲染） */
export function syncIpa(word: string, lang: string | null | undefined): string | null {
  const l = (lang || "").toLowerCase();
  if (l.startsWith("es")) return esToIpa(word);
  return null;
}

/** 语言代码 → speechSynthesis 语音代码（朗读用） */
const VOICE: Record<string, string> = {
  en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE",
  ja: "ja-JP", ko: "ko-KR", zh: "zh-CN", pt: "pt-PT", it: "it-IT",
};
export function voiceLang(lang: string | null | undefined): string | null {
  const l = (lang || "").toLowerCase();
  const base = l.split("-")[0];
  return VOICE[base] ?? null;
}
