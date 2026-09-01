import { remapWithTaps, type LyricLine } from "./lrc";

export type OnsetInfo = {
  times: number[];
  strength: number[];
  /** 人声段起止（300–3400Hz 人声频带能量包络估计；前奏鼓/贝斯不在此频带） */
  vocalStart: number | null;
  vocalEnd: number | null;
};

const TARGET_SR = 22050;
const FFT_SIZE = 1024;

/* 简易 FFT（迭代 Cooley–Tukey，仅用于频谱能量） */
function fftMag(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function downmix(buffer: AudioBuffer): Float32Array {
  const len = Math.floor((buffer.length * TARGET_SR) / buffer.sampleRate);
  const out = new Float32Array(len);
  const ch = buffer.getChannelData(0);
  const ratio = buffer.sampleRate / TARGET_SR;
  for (let i = 0; i < len; i++) {
    out[i] = ch[Math.min(ch.length - 1, Math.floor(i * ratio))];
  }
  return out;
}

/** 检测乐句起点 + 人声段。供对齐引擎使用。 */
export async function detectOnsetsBuffer(buffer: AudioBuffer): Promise<OnsetInfo> {
  const sig = downmix(buffer);
  const hop = FFT_SIZE / 2;
  const frames = Math.max(0, Math.floor((sig.length - FFT_SIZE) / hop));
  const binHz = TARGET_SR / FFT_SIZE;
  const loBin = Math.max(1, Math.floor(300 / binHz));
  const hiBin = Math.min(FFT_SIZE / 2 - 1, Math.ceil(3400 / binHz));

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const flux: number[] = [];
  const vocal: number[] = [];
  let prev: Float32Array | null = null;

  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < FFT_SIZE; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
      re[i] = sig[off + i] * w;
      im[i] = 0;
    }
    fftMag(re, im);
    const mag = new Float32Array(FFT_SIZE / 2);
    let vocalE = 0;
    for (let b = 0; b < FFT_SIZE / 2; b++) {
      mag[b] = Math.hypot(re[b], im[b]);
      if (b >= loBin && b <= hiBin) vocalE += mag[b];
    }
    vocal.push(vocalE);
    let fl = 0;
    if (prev) {
      for (let b = 0; b < FFT_SIZE / 2; b++) {
        const d = mag[b] - prev[b];
        if (d > 0) fl += d;
      }
    }
    flux.push(fl);
    prev = mag;
  }

  const secPerFrame = hop / TARGET_SR;

  /* 人声段：能量持续升高的起点 / 最后一个强点 */
  let vocalStart: number | null = null;
  let vocalEnd: number | null = null;
  if (vocal.length > 0) {
    const sorted = [...vocal].sort((a, b) => b - a);
    const thr = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.25))];
    let run = 0;
    for (let i = 0; i < vocal.length; i++) {
      if (vocal[i] > thr) {
        run++;
        if (run >= 8 && vocalStart === null) vocalStart = Math.max(0, (i - run + 1) * secPerFrame);
      } else {
        run = 0;
      }
      if (vocal[i] > thr) vocalEnd = i * secPerFrame;
    }
  }

  /* 乐句起点：频谱通量峰值，最小间隔 0.55s */
  const picked: { f: number; v: number }[] = [];
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  const minGap = Math.max(1, Math.round(0.55 / secPerFrame));
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > mean * 1.3) {
      const lastP = picked[picked.length - 1];
      if (!lastP || i - lastP.f >= minGap) picked.push({ f: i, v: flux[i] });
      else if (flux[i] > lastP.v) picked[picked.length - 1] = { f: i, v: flux[i] };
    }
  }

  return {
    times: picked.map((p) => p.f * secPerFrame),
    strength: picked.map((p) => p.v),
    vocalStart,
    vocalEnd,
  };
}

export type AlignResult = {
  lines: LyricLine[];
  aligned: boolean;
  mode: "anchor" | "segment" | "none";
  anchors: { idx: number; t: number }[];
  confidence: number;
  avgDelta: number;
  notes: string[];
};

/** 自动对齐：有时间戳走锚点重映射；纯文本走人声段比例排布+软吸附 */
export function autoAlign(lines: LyricLine[], onsets: OnsetInfo, duration = 0): AlignResult {
  const notes: string[] = [];
  if (lines.length === 0) {
    return { lines, aligned: false, mode: "none", anchors: [], confidence: 0, avgDelta: 0, notes: ["歌词为空"] };
  }

  const hasTime = lines.some((l) => l.time > 0.01);

  if (hasTime) {
    /* 锚点模式：把歌词时间轴吸附到最近的乐句点 */
    const anchors: { idx: number; t: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].time;
      let best: number | null = null;
      let bestD = 0.9;
      for (const o of onsets.times) {
        const d = Math.abs(o - t);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best !== null) anchors.push({ idx: i, t: best });
    }
    if (anchors.length >= 1) {
      const { lines: remapped, avgDelta } = remapWithTaps(lines, anchors);
      notes.push(`自动对齐：锁定 ${anchors.length}/${lines.length} 个句点`);
      return {
        lines: remapped,
        aligned: true,
        mode: "anchor",
        anchors,
        confidence: anchors.length / lines.length,
        avgDelta,
        notes,
      };
    }
    notes.push("乐句点不足，沿用歌词自带时间轴");
    return { lines, aligned: false, mode: "none", anchors: [], confidence: 0, avgDelta: 0, notes };
  }

  /* 分段模式：纯文本歌词，按人声段比例排布 + 软吸附 */
  const start = onsets.vocalStart ?? (duration ? duration * 0.06 : 5);
  const end = onsets.vocalEnd ?? (duration ? duration * 0.97 : start + lines.length * 4);
  const span = Math.max(1, end - start);
  const weights = lines.map((l) => Math.max(1, l.text.length));
  const total = weights.reduce((a, b) => a + b, 0);

  let acc = start;
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    starts.push(acc);
    acc += (weights[i] / total) * span;
  }
  /* 软吸附到最近乐句点（±0.7s） */
  let snapped = 0;
  for (let i = 0; i < starts.length; i++) {
    let best = starts[i];
    let bestD = 0.7;
    for (const o of onsets.times) {
      const d = Math.abs(o - starts[i]);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best !== starts[i]) snapped++;
    starts[i] = best;
  }
  /* 单调递增 + 最小句距 */
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] < starts[i - 1] + 0.55) starts[i] = starts[i - 1] + 0.55;
  }

  notes.push(
    `纯文本歌词：按人声段 ${start.toFixed(1)}s → ${end.toFixed(1)}s 依句长比例排好 ${lines.length} 句`,
    snapped >= 3 ? `其中 ${snapped} 句起点吸附到了检测到的乐句点` : "（乐句点较少，主要按句长比例排布）"
  );

  return {
    lines: lines.map((l, i) => ({ ...l, time: starts[i] })),
    aligned: true,
    mode: "segment",
    anchors: [],
    confidence: 0.6,
    avgDelta: 0,
    notes,
  };
}
