import { useState } from "react";
import { PRON_DATA, LANG_NAMES } from "../data/pronunciation";
import { voiceLang } from "../lib/phonetics";

/** 按歌曲语言渲染的发音学习区（音标 + 示例词 + 点击朗读） */
export default function PronunciationLab({ lang }: { lang: string | null }) {
  const [open, setOpen] = useState(true);
  const [speaking, setSpeaking] = useState<string | null>(null);

  const code = lang?.toLowerCase().split(/[-_]/)[0] ?? "";
  const data = PRON_DATA[code];
  if (!data) return null;

  const speak = (word: string, ipa: string) => {
    try {
      const u = new SpeechSynthesisUtterance(word);
      u.lang = voiceLang(code) ?? "en-US";
      u.rate = 0.8;
      setSpeaking(ipa);
      u.onend = () => setSpeaking(null);
      u.onerror = () => setSpeaking(null);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      setSpeaking(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-ink-900/80">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-850/60"
      >
        <span className="grid h-8 w-8 place-items-center rounded-md border border-teal/40 bg-teal/10 text-teal">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V6l11-2v12" />
            <circle cx="6.5" cy="18" r="2.5" />
            <circle cx="17.5" cy="16" r="2.5" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-display text-sm text-paper">
            {LANG_NAMES[code] ?? code.toUpperCase()}发音学习
            <span className="ml-2 font-mono text-[10px] tracking-widest text-teal">{data.groups.length} 组 · 点示例词听发音</span>
          </span>
          <span className="mt-0.5 block font-mono text-[11px] leading-relaxed text-dim">{data.intro}</span>
        </span>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-faint transition-transform duration-300 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="grid gap-4 px-4 pb-4 md:grid-cols-2 xl:grid-cols-3">
          {data.groups.map((g) => (
            <div key={g.title} className="rounded-md border border-line-soft bg-ink-850/50 p-3">
              <p className="mb-2 font-mono text-[10px] tracking-widest text-amber">{g.title}</p>
              <ul className="space-y-1.5">
                {g.items.map((it) => {
                  const isSpeaking = speaking === it.ipa;
                  return (
                    <li key={`${g.title}-${it.ipa}-${it.word}`}>
                      <button
                        onClick={() => speak(it.word, it.ipa)}
                        className="group flex w-full items-start gap-2.5 rounded-md border border-transparent px-1.5 py-1 text-left transition-all hover:border-teal/40 hover:bg-teal/6"
                        title={`朗读「${it.word}」`}
                      >
                        <span className={`shrink-0 font-mono text-[13px] ${isSpeaking ? "text-teal" : "text-teal/90 group-hover:text-teal"}`}>
                          {it.ipa}
                        </span>
                        <span className="shrink-0 font-display text-sm text-paper">{it.word}</span>
                        <span className="flex-1 text-[11px] leading-snug text-faint">{it.zh}</span>
                        <span className={`mt-0.5 shrink-0 ${isSpeaking ? "text-teal" : "text-faint/60 group-hover:text-teal"}`}>
                          {isSpeaking ? (
                            <span className="flex gap-0.5">
                              {[0, 1, 2].map((i) => (
                                <span key={i} className="h-2.5 w-0.5 animate-pulse rounded bg-current" style={{ animationDelay: `${i * 120}ms` }} />
                              ))}
                            </span>
                          ) : (
                            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                              <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
                            </svg>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
