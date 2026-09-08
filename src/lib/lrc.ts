export type LyricWord = { s: number; e: number; t: string };

export type LyricLine = {
  time: number;
  text: string;
  translation?: string;
  /** 真实唱完的时刻：句尾换气/间奏里高亮冻结在这里，不再匀速爬向下一句 */
  sungEnd?: number;
  /** 词级时间戳（本地后端强制对齐产出）。t 拼起来严格等于 text，渲染端零重组 */
  words?: LyricWord[];
};

/** 词级时间轴的持久化/传输格式（v:1）。LRC 只存句级时间戳，词级数据走这份独立 JSON */
export type TimedWord = [number, number, string];

export type TimedLine = {
  i: number;              // 构建时行号
  s: number;              // 构建时该行 start：校验歌词有没有被换掉/平移过
  se: number | null;      // sungEnd
  t: string;              // 该行原文
  w: TimedWord[];
};

export type Timings = {
  v: number;
  model: string;
  lang: string;
  langs?: string[];
  lineLangs?: (string | null)[];
  matchRatio: number;     // 对齐上的歌词词占比
  textSim: number;        // ASR 转写 vs 官方歌词的实词重合度 → 一致性告警依据
  offset?: number;
  lines: TimedLine[];
};

export type ParsedLRC = {
  lines: LyricLine[];
  offsetMs: number;
  meta: Record<string, string>;
  warnings: string[];
};

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:,](\d{1,3}))?\]/g;
const META_TAG = /^\[([a-zA-Z#]+):([^\]]*)\]$/;

function fracToSeconds(raw: string | undefined): number {
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  if (raw.length === 1) return n / 10;
  if (raw.length === 2) return n / 100;
  return n / 1000;
}

/** 健壮 LRC 解析：offset / 一行多时间戳 / 逗号毫秒 / 自动排序 / 双语合并 */
export function parseLRC(src: string): ParsedLRC {
  const meta: Record<string, string> = {};
  const warnings: string[] = [];
  let offsetMs = 0;
  const raw: { time: number; text: string; sungEnd?: number }[] = [];
  let plainTextLines = 0;

  for (const line of src.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const metaMatch = trimmed.match(META_TAG);
    if (metaMatch) {
      const [, key, value] = metaMatch;
      if (key.toLowerCase() === "offset") {
        const v = parseFloat(value);
        if (!Number.isNaN(v)) offsetMs = v;
      } else {
        meta[key.toLowerCase()] = value.trim();
      }
      continue;
    }

    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    TIME_TAG.lastIndex = 0;
    while ((m = TIME_TAG.exec(trimmed)) !== null) {
      stamps.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + fracToSeconds(m[3]));
    }

    const text = trimmed.replace(TIME_TAG, "").trim();
    if (stamps.length === 0) {
      if (text) plainTextLines++;
      continue;
    }
    if (!text) continue;
    if (stamps.length >= 2) {
      /* 卡拉OK双时间戳 [开始][唱完]歌词：第二枚作 sungEnd，
         间奏/句尾换气里高亮冻结在唱完时刻，不匀速爬向下一句 */
      raw.push({ time: stamps[0] + offsetMs / 1000, text, sungEnd: stamps[1] + offsetMs / 1000 });
    } else {
      for (const t of stamps) raw.push({ time: t + offsetMs / 1000, text });
    }
  }

  if (plainTextLines > 0) {
    warnings.push(`${plainTextLines} 行纯文本歌词没有时间戳，已跳过`);
  }

  raw.sort((a, b) => a.time - b.time);

  const lines: LyricLine[] = [];
  for (const item of raw) {
    const prev = lines[lines.length - 1];
    if (prev && Math.abs(prev.time - item.time) < 0.08) {
      if (!prev.translation) prev.translation = item.text;
      continue;
    }
    lines.push({
      time: item.time,
      text: item.text,
      ...(item.sungEnd != null ? { sungEnd: item.sungEnd } : {}),
    });
  }

  return { lines, offsetMs, meta, warnings };
}

/** 纯文本歌词 → 逐句切分（识别服务常返回无时间戳的纯文本） */
export function splitPlainLyrics(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split(/\r?\n/)) {
    const t = line.replace(/^\[[^\]]*\]/g, "").trim();
    if (!t) continue;
    if (t.length <= 60) {
      out.push(t);
    } else {
      // 超长句按标点拆
      const parts = t.split(/(?<=[.!?。！？；;])\s+/).map((p) => p.trim()).filter(Boolean);
      out.push(...(parts.length > 0 ? parts : [t]));
    }
  }
  return out;
}

/** 二分查找当前句（-1 = 还没开始） */
export function findIndex(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function formatTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60);
  const d = Math.floor((t % 1) * 10);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${d}`;
}

export function formatStamp(t: number): string {
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60);
  const cs = Math.round((t % 1) * 100);
  return `[${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
}

export function serializeLRC(meta: Record<string, string>, lines: LyricLine[]): string {
  const head = Object.entries(meta).map(([k, v]) => `[${k}:${v}]`).join("\n");
  const body = lines
    .map((l) => `${formatStamp(l.time)}${l.text}${l.translation ? `\n${formatStamp(l.time)}「${l.translation}」` : ""}`)
    .join("\n");
  return `${head}\n${body}\n`;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** LyricLine[] → 可持久化的词级时间轴行 */
export function toTimedLines(lines: LyricLine[]): TimedLine[] {
  return lines.map((l, i) => ({
    i,
    s: round3(l.time),
    se: l.sungEnd != null ? round3(l.sungEnd) : null,
    t: l.text,
    w: (l.words ?? []).map((w) => [round3(w.s), round3(w.e), w.t] as TimedWord),
  }));
}

/** 沿用旧结果的元数据、换上新行数据（手动校准平移后重新落盘用）。
    传进来的 lines 已经在音频域（applyTimings 平移过，LRC 也照它们重新导出），
    offset 必须归零，否则下次 apply 会在平移过的时间上再加一遍 */
export function retiming(old: Timings, lines: LyricLine[]): Timings {
  return { ...old, offset: 0, lines: toTimedLines(lines) };
}

export function parseTimings(json?: string | null): Timings | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as Timings;
    if (!d || d.v !== 1 || !Array.isArray(d.lines)) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * 把后端产出的词级时间轴套到当前歌词行上。
 * 逐行校验（行号、原文、句时间漂移、词切片拼接）：对不上就丢掉那一行的词级数据，
 * 绝不猜——错位的逐词高亮比没有词级高亮更让人难受。一行都对不上则整体返回 null。
 *
 * 返回的行时间已经平移到**音频域**：词时间是这份录音真实的唱腔时刻，而 LRC 的句时间戳
 * 来自 lrclib（往往是另一个版本，整份差几秒很常见），两者靠 timings.offset 换算。
 * 渲染必须统一到音频域，否则「显示到这句」和「实际在唱这句」恒定差一个 offset。
 */
export function applyTimings(lines: LyricLine[], timings: Timings | null): LyricLine[] | null {
  if (!timings || timings.v !== 1 || !Array.isArray(timings.lines)) return null;
  if (timings.lines.length !== lines.length) return null;   // 换了歌词版本：整体作废
  const byIdx = new Map<number, TimedLine>();
  for (const tl of timings.lines) byIdx.set(tl.i, tl);

  const off = Number.isFinite(timings.offset) ? Math.max(-60, Math.min(60, timings.offset as number)) : 0;
  const at = lines.map((l) => Math.max(0, round3(l.time + off)));
  /* 平移把开头几句压到 0 以下时会并列成 0，findIndex 会一次跳到并列的最后一句，
     前面那几句永远不显示 —— 补个极小步进保住严格递增 */
  for (let i = 1; i < at.length; i++) if (at[i] <= at[i - 1]) at[i] = round3(at[i - 1] + 0.02);

  let applied = 0;
  const out = lines.map((l, i) => {
    const time = at[i];
    const base: LyricLine = { ...l, time };
    const tl = byIdx.get(i);
    /* 漂移校验拿原始句时间比 tl.s：两者同在 lrclib 域，平移后的时间不能用来校验 */
    if (!tl || tl.t !== l.text || Math.abs(l.time - tl.s) > 0.5) return base;
    const words: LyricWord[] = [];
    for (const w of tl.w ?? []) {
      if (!Array.isArray(w) || w.length !== 3) return base;
      const [s, e, t] = w;
      if (!Number.isFinite(s) || !Number.isFinite(e) || typeof t !== "string") return base;
      words.push({ s, e: Math.max(e, s), t });
    }
    if (words.length === 0 || words.map((w) => w.t).join("") !== l.text) return base;
    /* 词还得落在这一句自己的显示窗口里。整句被排到窗口外的话，渲染出来就是
       这句一进来全亮、或者永远不亮 —— 不如退回句级擦除 */
    const nextStart = i + 1 < at.length ? at[i + 1] : Infinity;
    if (words[0].s >= nextStart || words[words.length - 1].e <= time) return base;
    applied++;
    return {
      ...base,
      words,
      sungEnd: typeof tl.se === "number" && Number.isFinite(tl.se) ? Math.max(tl.se, time) : undefined,
    };
  });
  return applied > 0 ? out : null;
}

/** 整体平移（手动校准）：句时间连同词级时间轴一起 rebase，否则校验会因漂移整份作废 */
export function nudgeLines(lines: LyricLine[], delta: number): LyricLine[] {
  return lines.map((l) => ({
    ...l,
    time: Math.max(0, round3(l.time + delta)),
    sungEnd: l.sungEnd != null ? Math.max(0, round3(l.sungEnd + delta)) : undefined,
    words: l.words?.map((w) => ({
      s: Math.max(0, round3(w.s + delta)),
      e: Math.max(0, round3(w.e + delta)),
      t: w.t,
    })),
  }));
}

export type Tap = { idx: number; t: number };

/** 锚点分段线性重映射（拍拍校准用） */
export function remapWithTaps(lines: LyricLine[], taps: Tap[]): { lines: LyricLine[]; avgDelta: number } {
  const anchors = [...taps].sort((a, b) => a.idx - b.idx);
  if (anchors.length === 0) return { lines, avgDelta: 0 };
  const map = (i: number): number => {
    const oldT = lines[i].time;
    if (i <= anchors[0].idx) return oldT + (anchors[0].t - lines[anchors[0].idx].time);
    const last = anchors[anchors.length - 1];
    if (i >= last.idx) return oldT + (last.t - lines[last.idx].time);
    for (let k = 0; k < anchors.length - 1; k++) {
      const a = anchors[k];
      const b = anchors[k + 1];
      if (i >= a.idx && i <= b.idx) {
        if (b.idx === a.idx) return a.t;
        return a.t + ((i - a.idx) / (b.idx - a.idx)) * (b.t - a.t);
      }
    }
    return oldT;
  };
  let deltaSum = 0;
  for (const a of anchors) deltaSum += a.t - lines[a.idx].time;
  const remapped = lines.map((l, i) => ({ ...l, time: Math.max(0, map(i)) }));
  for (let i = 1; i < remapped.length; i++) {
    if (remapped[i].time < remapped[i - 1].time + 0.05) remapped[i].time = remapped[i - 1].time + 0.05;
  }
  return { lines: remapped, avgDelta: deltaSum / anchors.length };
}
