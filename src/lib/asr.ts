/**
 * 浏览器内 Whisper 语音识别（零 API、零 token、模型随站部署，国内网络可用）。
 * 流程：上传 → 解码 → 本模块把音频转成唱词文本 + 时间戳 → 用文本去匹配真实歌词。
 * 模型：Xenova/whisper-tiny（q8 量化，encoder 10MB + decoder 31MB），
 *       加载一次后由浏览器 Cache API 缓存，二次使用秒开。
 */

import { pipeline, env } from "@huggingface/transformers";

let asrPipe: unknown = null;
let asrLoading: Promise<unknown> | null = null;

/** 配置推理环境：模型走本站 /models/（同源，无 CORS），wasm 走本站 /ort/ */
function initASREnv() {
  env.allowLocalModels = true;
  env.localModelPath = "/models/";
  env.allowRemoteModels = false; // 只用随站部署的模型，不请求外网
  env.useBrowserCache = true;
  try {
    (env.backends.onnx as { device?: string }).device = "wasm"; // 强制 WASM 后端（JSEP/WebGPU 体积大且兼容性差）
    (env.backends.onnx as { wasm?: { wasmPaths?: string } }).wasm = {
      wasmPaths: "/ort/",
    };
    (env.backends.onnx as { setLogLevel?: (l: number) => void }).setLogLevel?.(50); // NONE
  } catch {
    /* 环境差异兜底 */
  }
}

export type ASRSegment = { start: number; end: number; text: string };
export type ASRResult = { text: string; segments: ASRSegment[] };

/** 加载 Whisper（幂等，可并发安全） */
export function loadASR(onProgress?: (loaded: number, total: number) => void): Promise<unknown> {
  if (asrPipe) return Promise.resolve(asrPipe);
  if (!asrLoading) {
    initASREnv();
    asrLoading = (async () => {
      const p = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base", {
        dtype: "q8",
        session_options: {
          executionProviders: ["wasm"],
        },
        progress_callback: (pr: { status?: string; loaded?: number; total?: number }) => {
          if (pr.status === "progress" && typeof pr.loaded === "number" && typeof pr.total === "number") {
            onProgress?.(pr.loaded, pr.total);
          }
        },
      } as never);
      asrPipe = p;
      return p;
    })().finally(() => {
      asrLoading = null;
    });
  }
  return asrLoading;
}

/** 多声道混音为单声道 */
function toMono(buffer: AudioBuffer): Float32Array {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const out = new Float32Array(len);
  if (ch === 1) return buffer.getChannelData(0);
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += d[i] / ch;
  }
  return out;
}

/** 线性重采样到 16kHz（whisper 要求），并截取前 maxSeconds（识别歌词足够，省时省内存） */
function to16kMono(buffer: AudioBuffer, maxSeconds: number): Float32Array {
  const sr = buffer.sampleRate;
  const src = toMono(buffer);
  const maxLen = Math.floor(sr * maxSeconds);
  const slice = src.length > maxLen ? src.slice(0, maxLen) : src;
  if (sr === 16000) return slice;
  const ratio = sr / 16000;
  const outLen = Math.max(1, Math.floor(slice.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, slice.length - 1);
    const frac = pos - i0;
    out[i] = slice[i0] * (1 - frac) + slice[i1] * frac;
  }
  return out;
}

/** 识别音频开头（默认前 90 秒，通常已覆盖前奏 + 主歌，足够匹配歌词） */
export async function transcribeAudio(
  buffer: AudioBuffer,
  maxSeconds = 90,
  onProgress?: (msg: string) => void,
  forcedLang?: string | null
): Promise<ASRResult> {
  const pipe = (await loadASR()) as (input: Float32Array, opts: unknown) => Promise<{
    text?: string;
    chunks?: { timestamp?: [number, number] | null; text?: string }[];
  }>;
  onProgress?.("正在识别唱词…");
  const audio = to16kMono(buffer, maxSeconds);
  const baseOpts = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, temperature: 0 };
  /* 用户明确选了歌曲语言（非自动检测）→ 直接强制该语言转录，
     避免 whisper 对带伴奏的西语歌误判成英文（Sofia → "I'm not today…"） */
  let out = forcedLang
    ? await pipe(audio, { ...baseOpts, language: forcedLang })
    : await pipe(audio, baseOpts);
  let text = (out?.text || "").trim();

  /* whisper 对带伴奏的歌声常只输出描述（如 "(singing in Spanish)" / "(Música)"）。
     检测到描述且无实际唱词时，用检测到的语言强制二次转录，才能拿到歌词文本。 */
  const lang = detectSingingLang(text);
  if (lang && isDescriptionOnly(text)) {
    onProgress?.(`检测到语言 ${langLabel(lang)}，正在转录歌词…`);
    out = await pipe(audio, { ...baseOpts, language: lang });
    text = (out?.text || "").trim();
  }

  const chunks = out?.chunks || [];
  const segments: ASRSegment[] = chunks
    .filter((c) => c?.timestamp && Array.isArray(c.timestamp) && c.timestamp[0] != null && c.text?.trim() && !isDescriptionOnly(c.text!))
    .map((c) => ({
      start: Math.max(0, c.timestamp![0] ?? 0),
      end: c.timestamp![1] ?? 0,
      text: c.text!.trim(),
    }));
  return { text, segments };
}

const LANG_HINT: Record<string, string> = {
  english: "en", spanish: "es", french: "fr", german: "de", portuguese: "pt", italian: "it",
  korean: "ko", japanese: "ja", chinese: "zh", mandarin: "zh", cantonese: "yue",
  russian: "ru", arabic: "ar", hindi: "hi", dutch: "nl", polish: "pl", turkish: "tr",
  thai: "th", vietnamese: "vi", indonesian: "id", swedish: "sv", norwegian: "no",
  danish: "da", finnish: "fi", czech: "cs", greek: "el", hebrew: "he", ukrainian: "uk",
  hungarian: "hu", romanian: "ro", malay: "ms", tagalog: "tl",
};

const LANG_LABEL: Record<string, string> = {
  en: "英语", es: "西语", fr: "法语", de: "德语", pt: "葡语", it: "意语",
  ko: "韩语", ja: "日语", zh: "中文", yue: "粤语", ru: "俄语", ar: "阿拉伯语",
  hi: "印地语", nl: "荷兰语", pl: "波兰语", tr: "土耳其语", th: "泰语",
  vi: "越南语", id: "印尼语", sv: "瑞典语", no: "挪威语", da: "丹麦语",
  fi: "芬兰语", cs: "捷克语", el: "希腊语", he: "希伯来语", uk: "乌克兰语",
  hu: "匈牙利语", ro: "罗马尼亚语", ms: "马来语", tl: "他加禄语",
};

function langLabel(lang: string): string {
  return LANG_LABEL[lang] || lang;
}

/** 从 whisper 描述文本（如 "(singing in Spanish)"）提取语言代码 */
function detectSingingLang(text: string): string | null {
  const m = /\(singing in ([a-zA-Z]+)\)/i.exec(text);
  if (m) return LANG_HINT[m[1].toLowerCase()] || null;
  /* whisper 输出各国"音乐"描述词：Música=西/意/葡、Musik=德、musique=法、Music=英 */
  const musicWord: [RegExp, string][] = [
    [/\bmúsica\b|\bmusica\b/i, "es"],
    [/\bmusique\b/i, "fr"],
    [/\bmusik\b/i, "de"],
    [/\bmusic\b/i, "en"],
  ];
  for (const [re, lang] of musicWord) if (re.test(text)) return lang;
  return null;
}

/** 文本是否只有描述标签（[MUSIC] / (upbeat music) / (singing in Spanish)），没有实际唱词 */
function isDescriptionOnly(text: string): boolean {
  const cleaned = text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").trim();
  const words = cleaned.split(/\s+/).filter((w) => /[a-zà-ÿ0-9]/i.test(w));
  return words.length < 2;
}

/* ---------------- ASR 文本 → 歌词匹配 ---------------- */

/** 高频功能词（英/西/法/德/葡/意通用）：对歌名判断没有辨识度，
 *  还会让极短歌词（如 Toca Toca 满篇 "no no no"）被任意英文 ASR 文本误命中。 */
const STOPWORDS = new Set(
  (
    "i you no yes oh the a an and or to of is am are be been me my your we they he she it im dont dont cant wont was were " +
    "with for on at in that this so if but not just like all will would can could do does did have has had get got " +
    "de la el que y no me mi tu los las un una en a por para con es soy eres esta este estoy o pero si te se lo le al del " +
    "das die der den und ich du nicht ein eine ist sind wir ihr sie es aber auch von zu mit auf für über unter als wie"
  ).split(/\s+/)
);

/** 归一化：小写 + 去重音 + 只留字母/数字 + 去掉高频功能词（对西/英/法/德/葡/意通用） */
export function normLyric(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ");
}

/** 整段相似度：候选歌词里有多少词在 ASR 文本中出现（按候选词计） */
export function lyricSimilarity(asrText: string, lyricText: string): number {
  const a = normLyric(asrText);
  const b = normLyric(lyricText);
  const wa = new Set(a.split(" ").filter(Boolean));
  const wb = b.split(" ").filter(Boolean);
  if (!wa.size || !wb.length) return 0;
  let hit = 0;
  for (const w of wb) if (wa.has(w)) hit++;
  return hit / wb.length;
}

/** 滑动窗口最大相似度：ASR 只覆盖歌词一部分（如开口 90 秒）时，
 *  在完整歌词上滑动比较，取最高匹配段，避免长歌词稀释相似度。 */
export function bestLyricSimilarity(asrText: string, lyricText: string): number {
  const a = normLyric(asrText);
  const b = normLyric(lyricText);
  const wa = a.split(" ").filter(Boolean);
  const wb = b.split(" ").filter(Boolean);
  if (!wa.length || !wb.length) return 0;
  if (wb.length <= wa.length * 1.3) return lyricSimilarity(a, b);
  const win = Math.max(12, Math.floor(wa.length * 0.5));
  let best = 0;
  /* 前缀加权：ASR 开头一段 vs 每个窗口开头一段。
     带伴奏歌声的 whisper 听错率高，全曲窗口命中会混入其他歌的通用词（西语歌之间
     常互相撞 0.2），但"歌的开头唱段 vs 歌词开头"区分度明显——Waka 首段
     "momento/caen/murallas" 只与 Waka 首句重合。 */
  const N = Math.min(25, wa.length);
  const aPrefix = wa.slice(0, N).join(" ");
  let prefixBest = 0;
  const step = Math.max(1, Math.floor(win / 4));
  for (let i = 0; i + win <= wb.length; i += step) {
    const w = wb.slice(i, i + win);
    best = Math.max(best, lyricSimilarity(a, w.join(" ")));
    prefixBest = Math.max(prefixBest, lyricSimilarity(aPrefix, w.slice(0, N).join(" ")));
  }
  // 尾部窗口
  if (wb.length > win) {
    const w = wb.slice(wb.length - win);
    best = Math.max(best, lyricSimilarity(a, w.join(" ")));
    prefixBest = Math.max(prefixBest, lyricSimilarity(aPrefix, w.slice(0, N).join(" ")));
  }
  return best * 0.65 + prefixBest * 0.35;
}

/** 从 ASR 文本中提取用于搜索的特征句（第一个 ≥4 词的非空句子） */
export function pickSearchPhrase(asrText: string): string {
  const norm = asrText
    .replace(/\s+/g, " ")
    .trim()
    .split(/[.!?。！？]+/g)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4);
  return norm[0] || asrText.trim().split(/\s+/).slice(0, 8).join(" ");
}

/* 调试钩子：生产页面里 window.__asr.transcribeAudio(...) 直接调用 */
if (typeof window !== "undefined") {
  (window as unknown as { __asr?: { loadASR: typeof loadASR; transcribeAudio: typeof transcribeAudio; bestLyricSimilarity: typeof bestLyricSimilarity; normLyric: typeof normLyric } }).__asr = {
    loadASR,
    transcribeAudio,
    bestLyricSimilarity,
    normLyric,
  };
}
