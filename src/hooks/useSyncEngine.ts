import { useEffect, useRef, useState } from "react";
import type { Clock } from "../lib/clock";
import { findIndex, type LyricLine } from "../lib/lrc";

export type SyncSnap = {
  time: number;
  duration: number;
  index: number;
  progress: number;
  playing: boolean;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 同步引擎：每一帧 rAF 直接读 clock.currentTime → 二分定位句子 → 插值算句内进度。
 * 不用 setInterval / Date.now / timeupdate，唯一事实来源是媒体本身，
 * 拖动、缓冲、变速都天然跟手。
 */
export function useSyncEngine(clock: Clock | null, lines: LyricLine[]): SyncSnap {
  const [snap, setSnap] = useState<SyncSnap>({ time: 0, duration: 0, index: -1, progress: 0, playing: false });
  const linesRef = useRef(lines);
  linesRef.current = lines;

  useEffect(() => {
    if (!clock) {
      setSnap({ time: 0, duration: 0, index: -1, progress: 0, playing: false });
      return;
    }
    let raf = 0;
    const tick = () => {
      const t = clock.currentTime;
      const d = clock.duration;
      const ls = linesRef.current;
      if (d > 0 && clock.playing && t >= d - 0.04) clock.pause();
      const idx = findIndex(ls, t);
      const start = idx >= 0 ? ls[idx].time : 0;
      const end = idx + 1 < ls.length ? ls[idx + 1].time : Math.max(d, start + 5);
      const progress = idx < 0 ? 0 : clamp01((t - start) / Math.max(0.001, end - start));
      setSnap({ time: t, duration: d, index: idx, progress, playing: clock.playing });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const off = clock.onState(() => setSnap((s) => ({ ...s, playing: clock.playing })));
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [clock]);

  return snap;
}
