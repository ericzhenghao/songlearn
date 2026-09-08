import { useEffect, useRef, useState } from "react";
import type { Clock } from "../lib/clock";
import { findIndex, type LyricLine } from "../lib/lrc";

export type SyncSnap = {
  time: number;
  duration: number;
  index: number;
  /** 句内进度。分母是这句「唱完的时刻」（sungEnd），不是下一句的开始 ——
      否则句尾换气和间奏里高亮还在匀速爬，爬到 100% 正好是下一句开口，
      主观上就是「歌词总比唱慢半拍」。没有词级数据的句子退回下一句开始。 */
  progress: number;
  /** 正在唱的词下标。-1 = 这句没有词级数据，或还没开口 */
  wordIndex: number;
  /** 当前词内部进度 0-1，用来在词内部做擦除。唱完最后一个词后停在 1 */
  wordProgress: number;
  playing: boolean;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const IDLE: SyncSnap = {
  time: 0,
  duration: 0,
  index: -1,
  progress: 0,
  wordIndex: -1,
  wordProgress: 0,
  playing: false,
};

/**
 * 同步引擎：每一帧 rAF 直接读 clock.currentTime → 二分定位句子 → 插值算句内进度。
 * 不用 setInterval / Date.now / timeupdate，唯一事实来源是媒体本身，
 * 拖动、缓冲、变速都天然跟手。
 */
export function useSyncEngine(clock: Clock | null, lines: LyricLine[]): SyncSnap {
  const [snap, setSnap] = useState<SyncSnap>(IDLE);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  useEffect(() => {
    if (!clock) {
      setSnap(IDLE);
      return;
    }
    let raf = 0;
    const tick = () => {
      const t = clock.currentTime;
      const d = clock.duration;
      const ls = linesRef.current;
      if (d > 0 && clock.playing && t >= d - 0.04) clock.pause();
      const idx = findIndex(ls, t);
      const line = idx >= 0 ? ls[idx] : null;
      const start = line ? line.time : 0;
      const nextStart = idx + 1 < ls.length ? ls[idx + 1].time : Math.max(d, start + 5);
      const end = line?.sungEnd != null && line.sungEnd > start ? Math.min(line.sungEnd, nextStart) : nextStart;

      const words = line?.words;
      let wordIndex = -1;
      let wordProgress = 0;
      if (words && words.length > 0) {
        /* 取最后一个「已经开口」的词。零长度词（拖腔/证据不足）合法，
           它的结束时刻借下一个词的开口，渲染端靠这个自然接管 */
        for (let k = words.length - 1; k >= 0; k--) {
          if (t >= words[k].s) {
            wordIndex = k;
            break;
          }
        }
        if (wordIndex >= 0) {
          const w = words[wordIndex];
          const wEnd = w.e > w.s ? w.e : (words[wordIndex + 1]?.s ?? end);
          wordProgress = clamp01((t - w.s) / Math.max(0.001, wEnd - w.s));
        }
      }

      setSnap({
        time: t,
        duration: d,
        index: idx,
        progress: idx < 0 ? 0 : clamp01((t - start) / Math.max(0.001, end - start)),
        wordIndex,
        wordProgress,
        playing: clock.playing,
      });
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
