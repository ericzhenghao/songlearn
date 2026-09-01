export type LyricLine = {
  time: number;
  text: string;
  translation?: string;
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
  const raw: { time: number; text: string }[] = [];
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
    for (const t of stamps) raw.push({ time: t + offsetMs / 1000, text });
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
    lines.push({ time: item.time, text: item.text });
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
