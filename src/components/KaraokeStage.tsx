import { useEffect, useRef } from "react";
import type { SyncSnap } from "../hooks/useSyncEngine";
import type { LyricLine } from "../lib/lrc";
import { formatStamp } from "../lib/lrc";
import { transliterate, toIPA, splitWords } from "../lib/phonetics";

const cleanTranslation = (t?: string) => (t ? t.replace(/[「」]/g, "") : undefined);

/* 单行歌词渲染：字符级卡拉OK高亮 + 发音标注（中文音译 + 国际音标） */
function LyricRow({
  line,
  active,
  big,
  snap,
  lang,
  showPhonetics,
}: {
  line: LyricLine;
  active: boolean;
  big: boolean;
  snap: SyncSnap;
  lang?: string | null;
  showPhonetics?: boolean;
}) {
  const ws = splitWords(line.text);
  return (
    <div className={active ? "scale-100" : "scale-[0.985] opacity-60"}>
      <span
        className={`block whitespace-pre-wrap break-words transition-colors duration-300 ${
          big ? "font-display text-[26px] sm:text-[32px] leading-snug" : "font-display text-lg sm:text-xl leading-snug"
        }`}
      >
        {Array.from(line.text).map((ch, k) => {
          const lit = active && k < Math.floor(snap.progress * line.text.length);
          return (
            <span
              key={k}
              className={lit ? "text-amber" : active ? "text-paper" : "text-dim/75"}
              style={{ transition: "color 0.1s linear", textShadow: lit ? "0 0 26px rgba(255,180,84,0.5)" : undefined }}
            >
              {ch}
            </span>
          );
        })}
      </span>

      {showPhonetics && (
        <div className={`mt-0.5 ${big ? "space-y-0" : "space-y-0"}`}>
          <span className="block whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-teal/75">
            {ws.map((w, k) => {
              const tip = transliterate(w, lang);
              return (
                <span key={k} className="inline-block text-center" style={{ minWidth: `${Math.max(2, w.length * 0.62)}ch` }}>
                  {tip || "·"}
                </span>
              );
            })}
          </span>
          <span className="block whitespace-pre-wrap break-words font-mono text-[9px] leading-snug text-sky/55">
            {ws.map((w, k) => {
              const ipa = toIPA(w, lang);
              return (
                <span key={k} className="inline-block text-center" style={{ minWidth: `${Math.max(2, w.length * 0.62)}ch` }}>
                  {ipa ? `/${ipa}/` : ""}
                </span>
              );
            })}
          </span>
        </div>
      )}
    </div>
  );
}

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
  lang,
  showPhonetics = true,
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
  lang?: string | null;
  showPhonetics?: boolean;
}) {
  const cur = lines[snap.index];
  const nxt = lines[snap.index + 1];
  const curTr = cleanTranslation(cur?.translation) ?? translations?.[snap.index];

  useEffect(() => {
    /* 每句播放结束（进度条走完）时短暂闪烁"下一句"提示，让用户提前注意 */
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

      {/* 歌词区：当前句（大字卡拉OK）+ 下一句（灰色预告） */}
      <div className="thin-scroll relative flex-1 overflow-y-auto px-5 py-8">
        <div className="mx-auto max-w-xl space-y-6">
          {cur && (
            <div
              key={`cur-${snap.index}`}
              onClick={onLineClick ? () => onLineClick(snap.index) : undefined}
              className={`animate-rise ${onLineClick ? "cursor-pointer" : ""}`}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="font-mono text-[10px] text-amber">{formatStamp(cur.time)}</span>
                {onToggleMastered && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMastered(snap.index);
                    }}
                    title={mastered?.has(snap.index) ? "取消掌握标记" : "标记本句已掌握"}
                    className={`grid h-4 w-4 place-items-center rounded-full border transition-all ${
                      mastered?.has(snap.index)
                        ? "border-teal bg-teal/20 text-teal"
                        : "border-line text-faint hover:border-teal/60 hover:text-teal"
                    }`}
                  >
                    <svg viewBox="0 0 10 10" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1.5 5.5 4 8l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <span className="h-px flex-1 bg-gradient-to-r from-amber/60 to-transparent" />
              </div>

              <LyricRow line={cur} active snap={snap} lang={lang} showPhonetics={showPhonetics} big />

              <div className="mt-2.5 h-[3px] w-full max-w-md overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber to-rose"
                  style={{ width: `${(snap.progress * 100).toFixed(2)}%` }}
                />
              </div>

              {showTranslation && curTr && (
                <p className="animate-rise mt-2 text-sm text-teal">{curTr}</p>
              )}
            </div>
          )}

          {nxt && (
            <div
              key={`nxt-${snap.index + 1}`}
              onClick={onLineClick ? () => onLineClick(snap.index + 1) : undefined}
              className={`animate-rise border-t border-line-soft/70 pt-4 ${onLineClick ? "cursor-pointer" : ""}`}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="font-mono text-[10px] text-faint/80">下一句 · {formatStamp(nxt.time)}</span>
                <span className="h-px flex-1 bg-gradient-to-r from-faint/30 to-transparent" />
              </div>
              <LyricRow line={nxt} active={false} snap={snap} lang={lang} showPhonetics={showPhonetics} big={false} />
              {showTranslation && (() => {
                const t = cleanTranslation(nxt.translation) ?? translations?.[snap.index + 1];
                return t ? <p className="mt-1 text-sm text-faint/80">{t}</p> : null;
              })()}
            </div>
          )}
          <div className="h-10" />
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
