/**
 * 跟唱评分：用户麦克风音高序列 vs 原唱旋律参考线
 * - 音高转半音后做 1D DTW，容忍节奏偏差，返回 0–100 分
 */
import type { PitchPoint } from "./pitch";
import { hzToMidi } from "./pitch";

/** 过滤静音点（f<=0 视为无声），并转成 [midi] 序列 */
function toMidiSeq(pts: PitchPoint[]): number[] {
  const out: number[] = [];
  for (const p of pts) {
    if (p.f > 60) out.push(hzToMidi(p.f));
  }
  return out;
}

/** 两个半音值的绝对差（clamp 到 12 半音内） */
const d = (a: number, b: number) => Math.min(Math.abs(a - b), 12);

/** DTW 距离（1D 序列，允许 1 步水平/垂直/对角） */
function dtw(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const INF = 1e9;
  const prev = new Float64Array(b.length + 1).fill(INF);
  const cur = new Float64Array(b.length + 1).fill(INF);
  prev[0] = 0;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = INF;
    for (let j = 1; j <= b.length; j++) {
      const cost = d(a[i - 1], b[j - 1]);
      cur[j] = cost + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    prev.set(cur);
  }
  return prev[b.length];
}

/**
 * 综合评分（0-100）：
 * - 覆盖度：用户音高点覆盖参考线的比例（缺唱扣分）
 * - 相似度：DTW 平均每点半音误差映射到分数（2 半音内 ≈ 准）
 */
export function scoreMelody(user: PitchPoint[], ref: PitchPoint[]): number {
  const a = toMidiSeq(user);
  const b = toMidiSeq(ref);
  if (!b.length) return 0;

  const cover = Math.min(1, a.length / b.length);
  if (!a.length) return Math.round(cover * 20); // 完全没唱

  const dist = dtw(a, b);
  const perPoint = dist / a.length; // 平均半音误差
  /* 0 半音 = 100 分；6 半音以上 = 40 分下限 */
  let sim = 100 - Math.min(40, perPoint * 10);
  if (sim < 40) sim = 40;

  return Math.round(sim * (0.65 + 0.35 * cover));
}

/** 分数 → 评级 */
export function gradeOf(score: number): { label: string; color: string } {
  if (score >= 90) return { label: "S", color: "#ffd166" };
  if (score >= 78) return { label: "A", color: "#2dd4bf" };
  if (score >= 65) return { label: "B", color: "#58a6ff" };
  if (score >= 50) return { label: "C", color: "#d29922" };
  return { label: "D", color: "#f85149" };
}

/** 句子是否算「难点」（评分低于阈值且唱过） */
export const HARD_THRESHOLD = 65;
export function isHard(score: number | null): boolean {
  return score != null && score > 0 && score < HARD_THRESHOLD;
}
