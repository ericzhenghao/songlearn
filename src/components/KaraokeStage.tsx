import { useEffect, useRef } from "react";
import type { SyncSnap } from "../hooks/useSyncEngine";
import type { LyricLine } from "../lib/lrc";
import { formatStamp } from "../lib/lrc";

const cleanTranslation = (t?: string) => (t ? t.replace(/[「」]/g, "") : undefined);

export default function KaraokeStage({
  lines,
  snap,
  showTranslation,
  loopOn,
  meta,
  translations,
  onLineClick,
  mastered,
  onToggleMastered,
}: {
  lines: LyricLine[];
  snap: SyncSnap;
  showTranslation: boolean;
  loopOn: boolean;
  meta: Record<string, string>;
  translations?: Record<number, string>;
  onLineClick?: (i: number) => void;
  mastered?: Set<number>;
  onToggleMastered?: (i: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const c = containerRef.current;
    const el = rowRefs.current[snap.index];
    if (c && el) {
      c.scrollTo({
        top: el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2,
        behavior: "smooth",
      });
    }
  }, [snap.index]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-gradient-to-b from-ink-850/90 to-ink-900/95">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft bg-ink-850/70 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-lg leading-tight text-paper">{meta.ti || "未命名曲目"}</p>
          <p className="truncate font-mono text-[11px] text-faint">{meta.ar || "未知艺术家"}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 font-mono text-[10px] tracking-widest">
          {loopOn && (
            <span className="flex items-center gap-1 rounded border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3" strokeLinecap="round" />
                <path d="M12 2v3.5H8.5M4 14v-3.5h3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              单句精学
            </span>
          )}
          <span className="rounded border border-line px-2 py-0.5 text-dim">{lines.length} 句</span>
        </div>
      </div>

      <div ref={containerRef} className="thin-scroll relative flex-1 overflow-y-auto px-5 py-10">
        <div className="mx-auto max-w-xl space-y-7">
          {lines.map((line, i) => {
            const isCurrent = i === snap.index;
            const isPast = snap.index > i;
            const translation = cleanTranslation(line.translation);
            const tr = translation ?? translations?.[i];
            return (
              <div
                key={`${i}-${line.time}`}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                onClick={onLineClick ? () => onLineClick(i) : undefined}
                title={onLineClick ? "点击：跳到这里唱 + 立即翻译" : undefined}
                className={`transition-all duration-500 ${isCurrent ? "scale-100" : "scale-[0.97]"} ${
                  onLineClick ? "cursor-pointer hover:translate-x-1" : ""
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className={`font-mono text-[10px] transition-colors ${isCurrent ? "text-amber" : "text-faint/70"}`}>
                    {formatStamp(line.time)}
                  </span>
                  {onToggleMastered && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleMastered(i);
                      }}
                      title={mastered?.has(i) ? "取消掌握标记" : "标记本句已掌握"}
                      className={`grid h-4 w-4 place-items-center rounded-full border transition-all ${
                        mastered?.has(i)
                          ? "border-teal bg-teal/20 text-teal"
                          : "border-line text-faint hover:border-teal/60 hover:text-teal"
                      }`}
                    >
                      <svg viewBox="0 0 10 10" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1.5 5.5 4 8l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                  {isCurrent && <span className="h-px flex-1 bg-gradient-to-r from-amber/60 to-transparent" />}
                </div>

                <div className="relative inline-block max-w-full">
                  <span
                    className={`block whitespace-nowrap transition-colors duration-300 ${
                      isCurrent
                        ? "font-display text-2xl text-dim/40 sm:text-[28px]"
                        : isPast
                          ? "text-base text-dim/45"
                          : "text-base text-dim/70"
                    }`}
                  >
                    {line.text}
                  </span>
                  {isCurrent && (
                    <span
                      className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap font-display text-2xl text-amber sm:text-[28px]"
                      style={{
                        width: `${(snap.progress * 100).toFixed(2)}%`,
                        textShadow: "0 0 24px rgba(255,180,84,0.45)",
                      }}
                    >
                      {line.text}
                    </span>
                  )}
                </div>

                {isCurrent && (
                  <div className="mt-2.5 h-[3px] w-full max-w-md overflow-hidden rounded-full bg-ink-700">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber to-rose"
                      style={{ width: `${(snap.progress * 100).toFixed(2)}%` }}
                    />
                  </div>
                )}

                {showTranslation && tr && (
                  <p className={`animate-rise mt-1.5 text-sm transition-colors duration-300 ${isCurrent ? "text-teal" : "text-faint/80"}`}>
                    {tr}
                  </p>
                )}
              </div>
            );
          })}
          <div className="h-16" />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line-soft bg-ink-850/70 px-4 py-2 font-mono text-[10px] tracking-widest text-faint">
        <span>
          当前句 <span className="text-amber">#{String(Math.max(0, snap.index) + 1).padStart(2, "0")}</span> /{" "}
          {String(lines.length).padStart(2, "0")}
        </span>
        <span>引擎 rAF · 时基 clock.currentTime</span>
      </div>
    </div>
  );
}
