import { useEffect, useMemo, useRef, useState } from "react";
import { useSyncEngine } from "../hooks/useSyncEngine";
import type { Clock } from "../lib/clock";
import { translate } from "../lib/translate";
import { getIpa } from "../lib/phonetics";
import { formatTime, type ParsedLRC } from "../lib/lrc";
import KaraokeStage from "./KaraokeStage";
import PronunciationLab from "./PronunciationLab";

const extractWords = (text: string) =>
  (text.toLowerCase().match(/[a-zà-ÿ'’]{3,}/g) || []).filter((w, i, arr) => arr.indexOf(w) === i);

const RATES = [0.5, 0.75, 1, 1.25, 1.5];

export default function LearnStep({
  clock,
  parsed,
  song,
  mastered,
  onToggle,
  pair,
}: {
  clock: Clock;
  parsed: ParsedLRC;
  song: { title: string; artist: string };
  mastered: Set<number>;
  onToggle: (i: number) => void;
  pair: { from: string | null; to: string; toLabel: string };
}) {
  const snap = useSyncEngine(clock, parsed.lines);
  const [showTr, setShowTr] = useState(true);
  const [loop, setLoop] = useState(false);
  const [tab, setTab] = useState<"vocab" | "progress">("vocab");
  const [word, setWord] = useState<string | null>(null);
  const [entry, setEntry] = useState<{ cn: string; note?: string } | null>(null);
  const [dictState, setDictState] = useState<"idle" | "loading" | "error">("idle");
  const [ipa, setIpa] = useState<string | null>(null);
  const mediaHost = useRef<HTMLDivElement>(null);
  /* 用户操作保护期：seek 后短暂禁用自动回卷，防止「按快进被拽回」 */
  const guardUntil = useRef(0);
  const guardedSeek = (t: number) => {
    guardUntil.current = performance.now() + 450;
    clock.seek(t);
  };

  const canTranslate = !!pair.from && pair.from !== pair.to;

  /* 单句精学：当前句唱完 → 自动暂停回到句首。再按播放 = 重唱这一句 */
  useEffect(() => {
    if (!loop || snap.index < 0 || snap.index >= parsed.lines.length) return;
    if (performance.now() < guardUntil.current) return;
    const end = snap.index + 1 < parsed.lines.length ? parsed.lines[snap.index + 1].time : snap.duration;
    if (clock.playing && snap.time >= end - 0.06) {
      clock.pause();
      clock.seek(parsed.lines[snap.index].time);
    }
  }, [snap.time, snap.index, snap.duration, loop, clock, parsed.lines]);

  const gotoLine = (delta: number) => {
    const cur = snap.index < 0 ? 0 : snap.index;
    const target = Math.max(0, Math.min(parsed.lines.length - 1, cur + delta));
    guardedSeek(parsed.lines[target].time);
    if (!clock.playing) void clock.play();
  };

  /* 逐句即时翻译（带预取 + 缓存） */
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const trRef = useRef(translations);
  trRef.current = translations;
  const inflight = useRef(new Set<number>());
  const ensureTranslation = (i: number) => {
    if (!canTranslate) return;
    const line = parsed.lines[i];
    if (!line || line.translation) return;
    if (trRef.current[i] !== undefined || inflight.current.has(i)) return;
    inflight.current.add(i);
    void translate(line.text, pair.from, pair.to).then((t) => {
      inflight.current.delete(i);
      if (t) setTranslations((m) => ({ ...m, [i]: t }));
    });
  };
  useEffect(() => {
    if (snap.index < 0) return;
    for (const i of [snap.index - 1, snap.index, snap.index + 1, snap.index + 2]) {
      if (i >= 0 && i < parsed.lines.length) ensureTranslation(i);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.index, pair.from, pair.to]);

  const onLineClick = (i: number) => {
    guardedSeek(parsed.lines[i].time);
    if (!clock.playing) void clock.play();
    ensureTranslation(i);
  };

  /* 视频画面挂载 */
  useEffect(() => {
    const host = mediaHost.current;
    const el = (clock as unknown as { media?: HTMLMediaElement }).media;
    if (host && el && el instanceof HTMLVideoElement) {
      /* 手机端一屏优先：视频只播声音，不显示画面（避免「封面」占屏） */
      el.controls = false;
      el.playsInline = true;
      el.muted = false;
      el.className = "hidden";
      host.appendChild(el);
      return () => {
        if (el.parentNode === host) host.removeChild(el);
      };
    }
  }, [clock]);

  const vocab = useMemo(() => {
    const m = new Map<string, number>();
    parsed.lines.forEach((l) => extractWords(l.text).forEach((w) => m.set(w, (m.get(w) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  }, [parsed]);

  useEffect(() => {
    if (!word) {
      setEntry(null);
      setIpa(null);
      return;
    }
    let alive = true;
    setDictState("loading");
    setEntry(null);
    setIpa(null);
    void translate(word, pair.from, pair.to).then((t) => {
      if (!alive) return;
      if (t && t.toLowerCase() !== word) {
        setEntry({ cn: t });
        setDictState("idle");
      } else {
        setEntry(null);
        setDictState("error");
      }
    });
    void getIpa(word, pair.from).then((p) => {
      if (alive) setIpa(p);
    });
    return () => {
      alive = false;
    };
  }, [word, pair.from, pair.to]);

  const speak = () => {
    if (!word) return;
    try {
      const u = new SpeechSynthesisUtterance(word);
      u.lang = pair.from === "es" ? "es-ES" : "en-US";
      u.rate = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* 忽略 */
    }
  };

  const pct = parsed.lines.length ? Math.round((mastered.size / parsed.lines.length) * 100) : 0;

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-8">
        <div ref={mediaHost} className="empty:hidden" />
        <div className="h-[300px] md:h-[430px]">
          <KaraokeStage
            lines={parsed.lines}
            snap={snap}
            showTranslation={showTr && canTranslate}
            loopOn={loop}
            meta={{ ti: song.title, ar: song.artist, ...(parsed.meta || {}) }}
            translations={translations}
            onLineClick={onLineClick}
            mastered={mastered}
            onToggleMastered={onToggle}
            lang={pair.from}
          />
        </div>

        <div className="rounded-lg border border-line bg-ink-900/80 p-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => gotoLine(-1)}
              className="grid h-10 w-10 place-items-center rounded-md border border-line text-dim transition-all hover:-translate-y-0.5 hover:border-amber/50 hover:text-amber"
              title="上一句"
            >
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
                <path d="M11 12 18 7v10l-7-5Zm-7 0 7-5v10l-7-5Z" />
              </svg>
            </button>
            <button
              onClick={() => (clock.playing ? clock.pause() : clock.play())}
              className="grid h-14 w-14 place-items-center rounded-full bg-amber text-ink-950 shadow-[0_10px_35px_-8px_rgba(255,180,84,0.55)] transition-all hover:scale-105 active:scale-95"
            >
              {snap.playing ? (
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-6 w-6 translate-x-0.5" fill="currentColor">
                  <path d="M8 5v14l11-7L8 5Z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => gotoLine(1)}
              className="grid h-10 w-10 place-items-center rounded-md border border-line text-dim transition-all hover:-translate-y-0.5 hover:border-amber/50 hover:text-amber"
              title="下一句"
            >
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
                <path d="m13 12-7 5V7l7 5Zm7 0-7 5V7l7 5Z" />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <input
                type="range"
                min={0}
                max={Math.max(0.01, snap.duration)}
                step={0.05}
                value={Math.min(snap.time, snap.duration)}
                onChange={(e) => guardedSeek(parseFloat(e.target.value))}
                className="w-full accent-amber"
              />
              <div className="mt-1 flex justify-between font-mono text-[11px] text-faint">
                <span className="text-paper">{formatTime(snap.time)}</span>
                <span>{formatTime(snap.duration)}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setLoop((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[11px] transition-all ${
                loop ? "border-teal/60 bg-teal/10 text-teal" : "border-line text-dim hover:border-teal/40 hover:text-teal"
              }`}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3" strokeLinecap="round" />
                <path d="M12 2v3.5H8.5M4 14v-3.5h3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              单句精学{loop ? " · 唱完暂停" : ""}
            </button>
            <button
              onClick={() => setShowTr((v) => !v)}
              className={`rounded-md border px-3 py-1.5 font-mono text-[11px] transition-all ${
                showTr ? "border-sky/60 bg-sky/10 text-sky" : "border-line text-dim hover:border-sky/40 hover:text-sky"
              }`}
            >
              双语对照 {pair.from ? `${pair.from.toUpperCase()} → ${pair.toLabel}` : ""}
            </button>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] tracking-widest text-faint">语速</span>
              {RATES.map((r) => (
                <button
                  key={r}
                  onClick={() => clock.setRate(r)}
                  className={`rounded-md px-2.5 py-1.5 font-mono text-[11px] transition-all ${
                    Math.abs(clock.rate - r) < 0.01 ? "bg-amber text-ink-950" : "bg-ink-950/60 text-dim hover:text-paper"
                  }`}
                >
                  {r}×
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { k: "听到", v: formatTime(snap.time) },
            { k: "已掌握", v: `${mastered.size}/${parsed.lines.length}` },
            { k: "完成度", v: `${pct}%` },
          ].map((s) => (
            <div key={s.k} className="rounded-md border border-line bg-ink-900/70 px-4 py-3">
              <p className="font-mono text-[10px] tracking-widest text-faint">{s.k}</p>
              <p className="mt-1 font-display text-xl text-paper">{s.v}</p>
            </div>
          ))}
        </div>

        <PronunciationLab lang={pair.from} />
      </div>

      <div className="lg:col-span-4">
        <div className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-ink-900/80">
          <div className="flex border-b border-line-soft">
            {(
              [
                ["vocab", "单词本"],
                ["progress", "学习进度"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex-1 px-4 py-3 font-display text-sm transition-colors ${
                  tab === k ? "bg-ink-850 text-amber" : "text-dim hover:text-paper"
                }`}
              >
                {label}
                {k === "progress" && <span className="ml-1.5 font-mono text-[10px] text-teal">{pct}%</span>}
              </button>
            ))}
          </div>

          {tab === "vocab" ? (
            <div className="thin-scroll flex-1 overflow-y-auto p-3">
              <p className="mb-2.5 px-1 font-mono text-[10px] tracking-widest text-faint">点击单词查释义</p>
              <div className="flex flex-wrap gap-1.5">
                {vocab.map(([w, count]) => (
                  <button
                    key={w}
                    onClick={() => setWord(w)}
                    className={`rounded-md border px-2.5 py-1.5 font-mono text-xs transition-all hover:-translate-y-0.5 ${
                      word === w
                        ? "border-amber bg-amber/15 text-amber"
                        : "border-line bg-ink-850 text-dim hover:border-amber/40 hover:text-paper"
                    }`}
                  >
                    {w}
                    <span className="ml-1 text-[9px] text-faint">×{count}</span>
                  </button>
                ))}
              </div>
              {word && (
                <div className="animate-rise mt-4 rounded-md border border-amber/30 bg-amber/6 p-4">
                  <div className="flex items-center gap-2.5">
                    <p className="font-display text-2xl text-paper">{word}</p>
                    {ipa && <p className="font-mono text-sm text-teal">{ipa}</p>}
                    <button
                      onClick={speak}
                      className="ml-auto grid h-8 w-8 place-items-center rounded-md border border-line text-dim transition-all hover:border-amber/50 hover:text-amber"
                      title="朗读"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
                      </svg>
                    </button>
                  </div>
                  {dictState === "loading" && <p className="mt-2 font-mono text-xs text-dim">查词典中…</p>}
                  {dictState === "error" && <p className="mt-2 font-mono text-xs text-rose">没查到，换个词试试</p>}
                  {entry && <p className="mt-2 text-sm leading-relaxed text-paper">{entry.cn}</p>}
                </div>
              )}
            </div>
          ) : (
            <div className="thin-scroll flex-1 overflow-y-auto p-4">
              <div className="h-2 overflow-hidden rounded-full bg-ink-800">
                <div className="h-full rounded-full bg-gradient-to-r from-amber to-teal transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 font-mono text-[11px] text-dim">已掌握 {mastered.size} / {parsed.lines.length} 句</p>
              <ul className="mt-4 space-y-1.5">
                {parsed.lines.map((l, i) => {
                  const done = mastered.has(i);
                  return (
                    <li key={i}>
                      <button
                        onClick={() => onToggle(i)}
                        className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-all ${
                          done ? "border-teal/40 bg-teal/8 text-paper" : "border-line-soft bg-ink-850/60 text-dim hover:border-line hover:text-paper"
                        }`}
                      >
                        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors ${done ? "border-teal bg-teal text-ink-950" : "border-line"}`}>
                          {done && (
                            <svg viewBox="0 0 10 10" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="2.2">
                              <path d="M1.5 5.5 4 8l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs">{l.text}</span>
                        <span className="shrink-0 font-mono text-[10px] text-faint">{formatTime(l.time)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
