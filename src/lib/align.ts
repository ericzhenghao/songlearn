/**
 * 音频分析与歌词对齐：
 * 1. detectOnsetsBuffer —— 乐句点（谱通量峰值）+ 人声活动分段（跳过前奏/间奏/呼喊）
 * 2. autoAlign —— 把歌词时间轴对到「真正唱词」的段上：先试整体平移，结构对不上就按唱段重建
 * 算法参数已在真实音频（Waka Waka MV 版）上验证：13s 前奏 + 开头咆哮/人群齐喊（0.8-4.3s、
 * 12.7-18.2s 两个孤岛段）全部剔除，唱词从 34.1s 主唱段起。
 */
import type { LyricLine } from "./lrc";

export type OnsetInfo = {
  times: number[];
  strength: number[];
  /** 人声段起止（300–3400Hz 人声频带能量包络估计；前奏鼓/贝斯不在此频带） */
  vocalStart: number | null;
  vocalEnd: number | null;
  /** 人声活动分段：对齐只把歌词往「真正唱词」的段里放 */
  segments: { start: number; end: number }[];
};

export type AlignResult = {
  lines: LyricLine[];
  aligned: boolean;
  mode: "anchor" | "segment" | "rebuild" | "none";
  anchors: { idx: number; t: number }[];
  confidence: number;
  avgDelta: number;
  notes: string[];
};

/* ================= FFT：1024 点 radix-2，窗与旋转因子预计算 ================= */
const FFT_N = 1024;
const HOP = 512;
const TARGET_SR = 22050;

const HANN = new Float64Array(FFT_N);
for (let i = 0; i < FFT_N; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1));

const TW_RE = new Float64Array(FFT_N / 2);
const TW_IM = new Float64Array(FFT_N / 2);
for (let k = 0; k < FFT_N / 2; k++) {
  TW_RE[k] = Math.cos((-2 * Math.PI * k) / FFT_N);
  TW_IM[k] = Math.sin((-2 * Math.PI * k) / FFT_N);
}

function fft1024(re: Float64Array, im: Float64Array): void {
  const N = FFT_N;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
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
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const step = N / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < half; k++) {
        const w = k * step;
        const wr = TW_RE[w];
        const wi = TW_IM[w];
        const ur = re[i + k];
        const ui = im[i + k];
        const xr = re[i + k + half];
        const xi = im[i + k + half];
        const vr = xr * wr - xi * wi;
        const vi = xr * wi + xi * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
      }
    }
  }
}

/* ================= 音频特征 ================= */
function toMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const out = new Float32Array(len);
  const n = buffer.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i];
  }
  if (n > 1) for (let i = 0; i < len; i++) out[i] /= n;
  return out;
}

function resampleTo(x: Float32Array, fromSR: number): Float32Array {
  if (Math.abs(fromSR - TARGET_SR) < 1) return x;
  const ratio = fromSR / TARGET_SR;
  const outLen = Math.floor(x.length / ratio);
  const out = new Float32Array(outLen);
  /* 抗混叠抽取：线性插值没有低通，44.1/48kHz 里的鼓镲、咝音、人群噪声会混叠进
     300–3400Hz 人声频带，把能量/平坦度/通量特征全部污染——实测 48kHz 立体声 mp4
     的分段与 22.05kHz 参考完全对不上。先两级盒式平均（≈三角低通，阻带衰减足够
     特征提取用）再抽取，保证任意输入采样率下特征一致。 */
  const W = Math.max(1, Math.round(ratio));
  const tmp = new Float32Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += x[i];
    if (i >= W) acc -= x[i - W];
    tmp[i] = acc / Math.min(i + 1, W);
  }
  for (let i = 0; i < outLen; i++) {
    const c = Math.round(i * ratio);
    const s0 = Math.max(0, c - W);
    const s1 = Math.min(x.length, c + W + 1);
    let a = 0;
    for (let j = s0; j < s1; j++) a += tmp[j];
    out[i] = a / (s1 - s0);
  }
  return out;
}

/** 解码后的 AudioBuffer → 乐句点 + 人声活动分段（同步计算，整曲约 0.5~1s） */
export function detectOnsetsBuffer(buffer: AudioBuffer): OnsetInfo {
  const mono = resampleTo(toMono(buffer), buffer.sampleRate);
  const frames = Math.max(0, Math.floor((mono.length - FFT_N) / HOP));
  const half = FFT_N / 2;
  const binHz = TARGET_SR / FFT_N;
  const lo = Math.ceil(300 / binHz);
  const hi = Math.floor(3400 / binHz);

  const env = new Float64Array(frames); // 人声频带能量
  const flux = new Float64Array(frames); // 谱通量（帧间正增长）
  const flat = new Float64Array(frames); // 谱平坦度：人声谐波→低，呼喊/鼓点宽带噪声→高
  const mag = new Float64Array(half);
  const prevMag = new Float64Array(half);
  const re = new Float64Array(FFT_N);
  const im = new Float64Array(FFT_N);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT_N; i++) {
      re[i] = (mono[off + i] ?? 0) * HANN[i];
      im[i] = 0;
    }
    fft1024(re, im);
    for (let k = 0; k < half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    let e = 0;
    let fl = 0;
    for (let k = lo; k <= hi; k++) e += mag[k];
    for (let k = 0; k < half; k++) {
      const d = mag[k] - prevMag[k];
      if (d > 0) fl += d;
    }
    /* 平坦度 = 几何均值/算术均值（仅人声频带）：谐波结构 → 低；宽带噪声 → 高 */
    let logSum = 0;
    let linSum = 0;
    const K = hi - lo + 1;
    for (let k = lo; k <= hi; k++) {
      const m = Math.max(mag[k], 1e-9);
      logSum += Math.log(m);
      linSum += mag[k];
    }
    env[f] = e;
    flux[f] = fl;
    flat[f] = Math.exp(logSum / K) / Math.max(linSum / K, 1e-9);
    prevMag.set(mag);
  }

  const secPerFrame = HOP / TARGET_SR;

  /* ---------- 人声活动分段（前奏/间奏/尾奏切分） ----------
     三重判据：能量（有人声）× 平坦度（谐波=唱，宽带噪声=喊/鼓，二次方压制）
     × 低通量（持续 vs 瞬态）。按分位阈值切唱段，合并 <2s 间隙、丢 <1.5s 碎片。 */
  const smoothWin = Math.max(3, Math.round(0.3 / secPerFrame));
  const movAvg = (arr: Float64Array): number[] => {
    const out = new Array<number>(arr.length);
    let acc = 0;
    for (let i = 0; i < arr.length; i++) {
      acc += arr[i];
      if (i >= smoothWin) acc -= arr[i - smoothWin];
      out[i] = acc / Math.min(i + 1, smoothWin);
    }
    return out;
  };
  const envSm = movAvg(env);
  const fluxSm = movAvg(flux);
  const flatSm = movAvg(flat);
  let fluxMax = 1e-9;
  for (const f of fluxSm) if (f > fluxMax) fluxMax = f;
  const vScore = envSm.map((e, i) => {
    const tonal = 1 - Math.min(1, flatSm[i]); // 谐波度
    return e * tonal * tonal * (1 - 0.4 * Math.min(1, fluxSm[i] / fluxMax));
  });
  const sortedScore = [...vScore].sort((a, b) => a - b);
  const vThr = sortedScore[Math.min(sortedScore.length - 1, Math.floor(sortedScore.length * 0.55))] ?? 0;
  const active = vScore.map((s) => s > vThr);

  const rawSegs: { start: number; end: number }[] = [];
  for (let i = 0; i < active.length; ) {
    if (active[i]) {
      const s = i;
      while (i < active.length && active[i]) i++;
      rawSegs.push({ start: s * secPerFrame, end: i * secPerFrame });
    } else {
      i++;
    }
  }
  const MERGE_GAP = 2.0;
  const MIN_LEN = 1.5;
  const EDGE = 0.15; // 边界收缩：换气/混响拖尾容易误判成段
  const merged: { start: number; end: number }[] = [];
  for (const seg of rawSegs) {
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end < MERGE_GAP) last.end = seg.end;
    else merged.push({ ...seg });
  }
  /* 孤岛剔除：短（<8s）且与相邻段隔了长间奏（>6s）的段是前奏呼喊/人群齐唱，
     不是有歌词对应的主唱段（Waka Waka MV 开头 0.8-4.3s 咆哮、12.7-18.2s 齐喊均如此，
     这类段谐波度/占空比与真唱无异，只能靠结构孤立性甄别）。循环剔除到不动点。 */
  const ISLAND_LEN = 8;
  const ISLAND_GAP = 6;
  const kept = merged.filter((s) => s.end - s.start >= MIN_LEN);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < kept.length; i++) {
      const seg = kept[i];
      if (seg.end - seg.start >= ISLAND_LEN) continue;
      const prevGap = i > 0 ? seg.start - kept[i - 1].end : Infinity;
      const nextGap = i + 1 < kept.length ? kept[i + 1].start - seg.end : Infinity;
      if (prevGap > ISLAND_GAP && nextGap > ISLAND_GAP) {
        kept.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  const segments = kept.map((s) => ({
    start: Math.max(0, s.start + EDGE),
    end: Math.max(s.start + EDGE + MIN_LEN, s.end - EDGE),
  }));

  let vocalStart: number | null = segments.length > 0 ? segments[0].start : null;
  let vocalEnd: number | null = segments.length > 0 ? segments[segments.length - 1].end : null;
  if (vocalStart === null && frames > 0) {
    const sorted = [...env].sort((a, b) => b - a);
    const thr = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.25))];
    let run = 0;
    for (let i = 0; i < frames; i++) {
      if (env[i] > thr) {
        run++;
        if (run >= 8 && vocalStart === null) vocalStart = Math.max(0, (i - run + 1) * secPerFrame);
      } else {
        run = 0;
      }
      if (env[i] > thr) vocalEnd = i * secPerFrame;
    }
  }

  /* ---------- 乐句点：谱通量峰值（去重间距 0.55s） ---------- */
  let mean = 0;
  for (const f of flux) mean += f;
  mean /= Math.max(1, frames);
  const minGap = Math.round(0.55 / secPerFrame);
  const picked: { f: number; v: number }[] = [];
  for (let i = 1; i < frames - 1; i++) {
    if (flux[i] > flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > mean * 1.3) {
      if (picked.length === 0 || i - picked[picked.length - 1].f >= minGap) picked.push({ f: i, v: flux[i] });
      else if (flux[i] > picked[picked.length - 1].v) picked[picked.length - 1] = { f: i, v: flux[i] };
    }
  }

  return {
    times: picked.map((p) => p.f * secPerFrame),
    strength: picked.map((p) => p.v),
    vocalStart,
    vocalEnd,
    segments,
  };
}

/* ================= 对齐 ================= */
/* ---------- 工具：人声段判定 / 归一化乐句强度 ---------- */
function makeVocalHelpers(onsets: OnsetInfo) {
  const segs = onsets.segments ?? [];
  const inVocal = (t: number): boolean => {
    for (const s of segs) {
      if (t >= s.start - 0.15 && t <= s.end - 0.35) return true;
    }
    return false;
  };
  let maxStr = 1e-9;
  for (const s of onsets.strength) if (s > maxStr) maxStr = s;
  const strengthNorm = (t: number): number => {
    let w = 0;
    for (let k = 0; k < onsets.times.length; k++) {
      if (Math.abs(onsets.times[k] - t) <= 0.45) w = Math.max(w, onsets.strength[k]);
    }
    return w / maxStr;
  };
  return { inVocal, strengthNorm };
}

/* ---------- 重建模式：把歌词按官方节奏填进「真正唱词」的段，呼喊/间奏一律跳过 ---------- */
function rebuildIntoSegments(
  lines: LyricLine[],
  weights: number[],
  segs: { start: number; end: number }[],
  onsets: OnsetInfo,
  duration: number,
  notes: string[]
): { lines: LyricLine[]; snapped: number } {
  const use =
    segs.length > 0
      ? segs
      : onsets.vocalStart != null && onsets.vocalEnd != null
        ? [{ start: onsets.vocalStart, end: onsets.vocalEnd }]
        : [{ start: Math.min(5, duration * 0.05), end: Math.max(duration * 0.97, 10) }];

  const totalW = weights.reduce((a, b) => a + b, 0) || lines.length;
  const capacity = use.reduce((a, s) => a + (s.end - s.start), 0) || 1;

  /* 每句的官方起始位置 = 累计权重占比 × 唱词总容量，再定位到对应唱段 */
  const starts: number[] = [];
  let wAcc = 0;
  for (let i = 0; i < lines.length; i++) {
    const target = (wAcc / totalW) * capacity;
    let t: number | null = null;
    let cum = 0;
    for (const s of use) {
      const len = s.end - s.start;
      if (target <= cum + len) {
        t = s.start + (target - cum);
        break;
      }
      cum += len;
    }
    if (t === null) t = use[use.length - 1].end - 0.5;
    /* 句首吸附到「段内」最近的乐句点（±0.6s），不允许吸到段外间奏里 */
    let bestO: number | null = null;
    let bestD = 0.6;
    for (let k = 0; k < onsets.times.length; k++) {
      const o = onsets.times[k];
      let inside = false;
      for (const s of use) {
        if (o >= s.start - 0.1 && o <= s.end) {
          inside = true;
          break;
        }
      }
      if (!inside) continue;
      const d = Math.abs(o - t!);
      if (d <= bestD) {
        bestD = d;
        bestO = o;
      }
    }
    starts.push(bestO ?? t);
    wAcc += weights[i];
  }
  /* 单调递增 + 最小句距 */
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] < starts[i - 1] + 0.45) starts[i] = starts[i - 1] + 0.45;
  }
  for (let i = 0; i < starts.length; i++) starts[i] = Math.max(0, starts[i]);
  if (duration > 0 && starts.length > 0) {
    const lastCap = Math.max(starts[starts.length - 1], duration - 0.5);
    if (starts[starts.length - 1] > lastCap) starts[starts.length - 1] = lastCap;
  }
  const snapped = starts.reduce((a, t, i) => a + (Math.abs(t - lines[i].time) > 0.05 ? 1 : 0), 0);
  notes.push(
    `唱词段 ${use.length} 个（首段 ${use[0].start.toFixed(1)}s 起），${lines.length} 句按官方节奏排进唱段；已排除无唱词的呼喊/演奏段`
  );
  return { lines: lines.map((l, i) => ({ ...l, time: starts[i] })), snapped };
}

/** 自动对齐：先切人声段并甄别「真正唱词」的段，再决定「整体平移」还是「按唱段重建」 */
export function autoAlign(lines: LyricLine[], onsets: OnsetInfo, duration = 0): AlignResult {
  const notes: string[] = [];
  if (lines.length === 0) {
    return { lines, aligned: false, mode: "none", anchors: [], confidence: 0, avgDelta: 0, notes: ["歌词为空"] };
  }

  const hasTime = lines.some((l) => l.time > 0.01);
  const allSegs = onsets.segments ?? [];
  const { inVocal, strengthNorm } = makeVocalHelpers(onsets);

  /* 统计每个 δ 下各人声段「吸收」的句数 —— 一句都吸不到的段就是呼喊/演奏，不配对歌词 */
  const segHits = (s: number): number[] => {
    const hits = new Array<number>(allSegs.length).fill(0);
    for (const l of lines) {
      const t = l.time + s;
      for (let j = 0; j < allSegs.length; j++) {
        const seg = allSegs[j];
        if (t >= seg.start - 0.15 && t <= seg.end - 0.35) {
          hits[j]++;
          break;
        }
      }
    }
    return hits;
  };

  /* 不变量：句首必须落在唱段内——连续掉进间奏的句子整块搬进后面的唱段开头，
     在「唱段起点 → 下一句」的空间里均匀铺开（最小间距 0.45s，保序） */
  const pullIntoSegs = (ls: LyricLine[]): LyricLine[] => {
    if (allSegs.length === 0) return ls;
    let i = 0;
    while (i < ls.length) {
      if (inVocal(ls[i].time)) {
        i++;
        continue;
      }
      let j = i;
      while (j < ls.length && !inVocal(ls[j].time)) j++;
      /* run = [i, j)：整块落在间奏的句子。目标 = 第 j 句所在唱段（末尾 run 则取其后最近唱段） */
      const target =
        j < ls.length
          ? allSegs.find((s) => ls[j].time >= s.start - 0.15 && ls[j].time <= s.end - 0.35)
          : (allSegs.find((s) => s.start > (ls[j - 1]?.time ?? 0)) ?? allSegs[allSegs.length - 1]);
      if (target) {
        const run = j - i;
        const prevBound = i > 0 ? ls[i - 1].time + 0.45 : 0;
        const start = Math.max(target.start + 0.05, prevBound);
        const end = j < ls.length ? Math.min(target.end - 0.35, ls[j].time - 0.45) : target.end - 0.35;
        const step = run > 1 ? Math.min(0.45, (end - start) / (run - 1)) : 0;
        if (start + step * (run - 1) <= end + 1e-9) {
          for (let k = i; k < j; k++) ls[k].time = start + (k - i) * step;
          i = j;
          continue;
        }
      }
      /* 放不下：逐句拉到其后最近唱段开头，不留在间奏深处 */
      for (let k = i; k < j; k++) {
        const next = allSegs.find((s) => s.start > ls[k].time);
        const cap = k + 1 < ls.length ? ls[k + 1].time - 0.45 : Number.POSITIVE_INFINITY;
        if (next) ls[k].time = Math.min(next.start + 0.05, Math.max(ls[k].time, cap));
        else ls[k].time = Math.min(ls[k].time, Math.max(0, allSegs[allSegs.length - 1].end - 0.4));
      }
      i = j;
    }
    return ls;
  };

  if (hasTime) {
    /* 锚点模式（人声段版）：
       歌词只可能在「有人唱」的时间段开始——前奏/间奏里出现句首 = 时间轴没对上。
       滑窗扫描 δ∈[-35,+35]s，给每个 δ 打分：句首落进人声段 +2、命中强乐句点 +0~1。 */
    let best = 0;
    let bestScore = -1;
    let zeroScore = 0;
    for (let s = -35; s <= 35.001; s += 0.25) {
      let sc = 0;
      for (const l of lines) {
        if (inVocal(l.time + s)) sc += 2;
        sc += strengthNorm(l.time + s);
      }
      if (s === 0) zeroScore = sc;
      if (sc > bestScore) {
        bestScore = sc;
        best = s;
      }
    }
    const insideAt = (s: number) => lines.filter((l) => inVocal(l.time + s)).length;
    const inside = insideAt(best);
    const ratio = inside / lines.length;
    const ratio0 = insideAt(0) / lines.length;

    /* 版本差异修正：lrclib 的同步时间轴常来自别的剪辑版（前奏/间奏长短不同），
       首句/末句掉在唱段之外（Waka Waka MV：歌词轴 21.3s 开唱、音频 34.1s 开唱）。
       试「边缘句吸附到边缘唱段」的整体平移：平移后无句掉出（≥95%）且落段比例
       明显变好才采纳——比泛滑窗稳，不会动本来就对的时间轴。 */
    const edgeShift = (): number | null => {
      const first = lines[0];
      const last = lines[lines.length - 1];
      const segLast = allSegs[allSegs.length - 1];
      const cands: number[] = [];
      if (!inVocal(first.time) && first.time < allSegs[0].start) {
        cands.push(allSegs[0].start + 0.05 - first.time);
      }
      if (!inVocal(last.time) && last.time > segLast.end - 0.35) {
        cands.push(segLast.end - 0.35 - last.time);
      }
      for (const d of cands) {
        if (Math.abs(d) < 0.5 || Math.abs(d) > 40) continue;
        const ratioD = insideAt(d) / lines.length;
        if (ratioD >= 0.95 && ratioD - ratio0 >= 0.03) return d;
      }
      return null;
    };
    const dEdge = edgeShift();
    if (dEdge !== null) {
      notes.push(
        `歌词时间轴与这条音频的前奏长度不一致（版本差异），整体平移 ${dEdge >= 0 ? "+" : ""}${dEdge.toFixed(1)}s，句首落进唱段比例 ${Math.round((insideAt(dEdge) / lines.length) * 100)}%`
      );
      return {
        lines: pullIntoSegs(lines.map((l) => ({ ...l, time: Math.max(0, l.time + dEdge) }))),
        aligned: true,
        mode: "anchor",
        anchors: [],
        confidence: insideAt(dEdge) / lines.length,
        avgDelta: dEdge,
        notes,
      };
    }

    /* 采纳平移：命中率明显提升（≥10 个百分点）或总分明显更优 */
    const beats = bestScore > zeroScore * 1.15 || ratio - ratio0 >= 0.1;

    if (best === 0 || (ratio >= 0.55 && !beats)) {
      notes.push(
        ratio >= 0.55
          ? "歌词时间轴与音频的唱段基本吻合，未做修正；如有细微偏差用「校准」微调"
          : "人声段检出不足，沿用歌词自带时间轴；如有偏差用「校准」微调"
      );
      return {
        lines: pullIntoSegs(lines.map((l) => ({ ...l }))),
        aligned: best !== 0,
        mode: "anchor",
        anchors: [],
        confidence: ratio,
        avgDelta: best,
        notes,
      };
    }

    if (ratio >= 0.55 && beats) {
      /* 整体偏移可信：精修（对落在唱段里的句子取中位数 delta）后整体平移 */
      const deltas: number[] = [];
      for (const l of lines) {
        if (!inVocal(l.time + best)) continue;
        let bestD = 0.45;
        let bestO: number | null = null;
        for (let k = 0; k < onsets.times.length; k++) {
          const d = onsets.times[k] - (l.time + best);
          if (Math.abs(d) <= bestD) {
            bestD = Math.abs(d);
            bestO = onsets.times[k];
          }
        }
        if (bestO !== null) deltas.push(bestO - (l.time + best));
      }
      const sorted = [...deltas].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const total = best + median;
      notes.push(
        `歌词时间轴整体偏了 ${total >= 0 ? "+" : ""}${total.toFixed(1)}s（${ratio0 * 100 | 0}% → ${ratio * 100 | 0}% 句首落进唱段），已整体修正；剩余误差用「校准」微调`
      );
      return {
        lines: pullIntoSegs(lines.map((l) => ({ ...l, time: Math.max(0, l.time + total) }))),
        aligned: true,
        mode: "anchor",
        anchors: [],
        confidence: ratio,
        avgDelta: total,
        notes,
      };
    }

    /* 结构对不上（句首怎么平移都大量落进间奏）：放弃官方时间点，按「唱词段」重建。
       唱词段 = 粗扫 δ 下至少吸到 1 句的人声段；一句都吸不到的（开头呼喊/合唱/纯演奏）剔除。 */
    const hits = segHits(best);
    const lyricSegs = allSegs.filter((_, j) => hits[j] > 0);
    const dropped = allSegs.length - lyricSegs.length;
    notes.push(
      `歌词结构与音频差异较大（平移后仍大量落进间奏），按唱词段重建时间轴` +
        (dropped > 0 ? `；已剔除 ${dropped} 个无唱词的呼喊/演奏段` : "")
    );
    const durations: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const d = i + 1 < lines.length ? lines[i + 1].time - lines[i].time : NaN;
      durations.push(Number.isFinite(d) ? Math.min(12, Math.max(1.2, d)) : 3);
    }
    const fin = durations.filter((d) => Number.isFinite(d));
    durations[durations.length - 1] = Math.min(
      8,
      Math.max(2, fin.length ? fin.sort((a, b) => a - b)[Math.floor(fin.length / 2)] : 3)
    );
    const rebuilt = rebuildIntoSegments(lines, durations, lyricSegs, onsets, duration, notes);
    return {
      lines: rebuilt.lines,
      aligned: true,
      mode: "rebuild",
      anchors: [],
      confidence: 0.55,
      avgDelta: 0,
      notes,
    };
  }

  /* 纯文本歌词：按人声段重建（句长做权重）。
     没有时间轴做甄别，依赖 detectOnsetsBuffer 已剔掉孤岛（前奏呼喊/人群齐唱），
     这里把「首句之前且与后续隔了长间奏」的段再兜底剔一次。 */
  const firstMain = allSegs.findIndex((s, j) => {
    const next = allSegs[j + 1];
    return s.end - s.start >= 8 || (next && next.start - s.end < 6);
  });
  const plainSegs = firstMain < 0 ? allSegs : allSegs.slice(firstMain);
  if (plainSegs.length < allSegs.length) {
    notes.push(`已剔除 ${allSegs.length - plainSegs.length} 个开头的呼喊/合唱段（无歌词对应）`);
  }
  const weights = lines.map((l) => Math.max(1, l.text.length));
  const rebuilt = rebuildIntoSegments(lines, weights, plainSegs, onsets, duration, notes);
  return {
    lines: rebuilt.lines,
    aligned: true,
    mode: "segment",
    anchors: [],
    confidence: 0.6,
    avgDelta: 0,
    notes,
  };
}
