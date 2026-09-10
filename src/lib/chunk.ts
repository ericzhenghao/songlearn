/**
 * 长句智能拆分：把长句按词/词组切成 2–3 个可单独精学的小段。
 * - 有词级时间戳（words）：按词边界切，段区间 = [首词.s, 尾词.e]
 * - 无词级时间戳：在句区间 [time, end] 内按字符比例均分，文本按比例切
 */
import type { LyricLine, LyricWord } from "./lrc";

export interface Chunk {
  s: number; // 段起点（秒）
  e: number; // 段终点（秒）
  label: string; // 段文本（渲染用）
}

const PAUSE_CHARS = /[,;:—–-]|\s(?:y|and|but|so|por|que|y|e|o|und|et|mais|e|e)\s/i;

/** 是否值得拆（词数 > 7 或字符数 > 26） */
export function isLongLine(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > 7 || text.length > 26;
}

/** 按词级时间戳拆段：优先在标点/连接词处断 */
function chunkByWords(words: LyricWord[], start: number, end: number): Chunk[] {
  const texts = words.map((w) => w.t);
  /* 找天然断点：标点或连接词之后 */
  const breaks: number[] = [];
  for (let i = 1; i < words.length - 1; i++) {
    const prevEnd = texts[i - 1].trimEnd();
    if (/[,;:—–]$/.test(prevEnd)) breaks.push(i);
    else if (PAUSE_CHARS.test(` ${texts[i].trim()} `) && i - (breaks[breaks.length - 1] ?? 0) >= 2) breaks.push(i);
  }
  const want = Math.min(3, Math.max(2, Math.ceil(words.length / 4)));
  /* 只保留 want-1 个最均匀的断点 */
  while (breaks.length >= want) {
    const target = Math.floor(words.length / want);
    const closest = breaks.reduce((best, b) => (Math.abs(b - target) < Math.abs(best - target) ? b : best), breaks[0]);
    breaks.splice(breaks.indexOf(closest), 1);
  }
  breaks.sort((a, b) => a - b);
  const bounds = [0, ...breaks, words.length];
  const out: Chunk[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const i0 = bounds[k];
    const i1 = bounds[k + 1] - 1;
    const s = k === 0 ? start : words[i0].s;
    const e = k === bounds.length - 2 ? end : words[i1].e;
    const label = words.slice(i0, i1 + 1).map((w) => w.t).join(" ").trim();
    if (label) out.push({ s, e, label });
  }
  return out;
}

/** 无词级数据：按字符比例切文本与区间 */
function chunkByRatio(text: string, start: number, end: number): Chunk[] {
  const n = Math.min(3, Math.max(2, Math.ceil(text.length / 14)));
  const dur = Math.max(0.5, end - start);
  const out: Chunk[] = [];
  const per = Math.ceil(text.length / n);
  for (let k = 0; k < n; k++) {
    const s = start + (dur * k) / n;
    const e = start + (dur * (k + 1)) / n;
    const label = text.slice(k * per, (k + 1) * per).trim();
    if (label) out.push({ s, e, label });
  }
  return out;
}

/** 入口：返回该句的拆分小段；不值得拆返回单段 */
export function splitChunks(line: LyricLine, end: number): Chunk[] {
  if (!isLongLine(line.text)) return [{ s: line.time, e: Math.max(end, line.time + 0.5), label: line.text }];
  const hasWords = line.words && line.words.length > 2;
  if (hasWords) return chunkByWords(line.words!, line.time, end);
  return chunkByRatio(line.text, line.time, Math.max(end, line.time + 1));
}
