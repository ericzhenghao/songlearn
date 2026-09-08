import { useState } from "react";
import { validateAudDToken } from "../lib/recognize";

export type ProcessStage = "decode" | "fingerprint" | "recognize" | "lyrics" | "align" | "done" | "failed";

const STAGES: { key: ProcessStage; name: string; detail: string }[] = [
  { key: "decode", name: "解码音频轨道", detail: "从你的文件里提取声音（视频同样支持）" },
  { key: "fingerprint", name: "提取声纹指纹", detail: "频谱特征 + 乐句起点 + 人声段检测" },
  { key: "recognize", name: "识别歌曲", detail: "听声识曲（audD）· 不读文件名" },
  { key: "lyrics", name: "联网搜索歌词", detail: "lrclib.net · 多通道取词 · 防串歌" },
  { key: "align", name: "自动对齐时间轴", detail: "把歌词吸附到检测到的乐句点" },
  { key: "done", name: "就绪 · 已存进曲库", detail: "正在进入学唱…" },
];

const ORDER: ProcessStage[] = ["decode", "fingerprint", "recognize", "lyrics", "align", "done"];

export default function AutoProcess({
  stage,
  fileName,
  song,
  failReason,
  recogNote,
  lyricPreview,
  auddToken,
  onToken,
  onRetry,
  onManual,
  onFallback,
}: {
  stage: ProcessStage;
  fileName: string;
  song: { title: string; artist: string } | null;
  failReason?: string | null;
  recogNote?: string | null;
  lyricPreview?: string | null;
  auddToken?: string;
  onToken?: (v: string) => void;
  onRetry?: () => void;
  onManual?: (title: string, artist: string) => void;
  onFallback?: () => void;
}) {
  const failed = stage === "failed";
  const curIdx = failed ? 2 : ORDER.indexOf(stage);
  const [manualOpen, setManualOpen] = useState(false);
  const [mTitle, setMTitle] = useState("");
  const [mArtist, setMArtist] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenChecking, setTokenChecking] = useState(false);
  const [tokenErr, setTokenErr] = useState<string | null>(null);

  const statusOf = (key: ProcessStage): "wait" | "active" | "done" | "fail" => {
    const i = ORDER.indexOf(key);
    if (failed && key === "recognize") return "fail";
    if (failed) return i < 2 ? "done" : "wait";
    if (i < curIdx || stage === "done") return "done";
    if (i === curIdx) return "active";
    return "wait";
  };

  return (
    <div className="animate-rise mx-auto max-w-2xl">
      <div className="overflow-hidden rounded-lg border border-line bg-ink-900/85 shadow-[0_30px_90px_-30px_rgba(4,8,20,0.9)]">
        <div className="flex items-center gap-3 border-b border-line-soft bg-ink-850/80 px-5 py-4">
          <span className={`grid h-10 w-10 place-items-center rounded-md border ${failed ? "border-rose/50 bg-rose/10 text-rose" : "border-amber/50 bg-amber/10 text-amber"}`}>
            {failed ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5V13m0 3.2h.01" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3.2" />
                <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" />
              </svg>
            )}
          </span>
          <div className="min-w-0">
            <p className="font-display text-xl leading-tight text-paper">
              {failed ? "卡住了 —— 但有好几个办法" : "正在自动处理，你什么都不用做"}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{fileName}</p>
          </div>
          {!failed && (
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-amber">
              <span className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse-soft" />
              AUTO
            </span>
          )}
        </div>

        <div className="p-5">
          <ol className="relative space-y-1">
            <span className="absolute bottom-4 left-[15px] top-4 w-px bg-line-soft" />
            {STAGES.map((s) => {
              const st = statusOf(s.key);
              return (
                <li key={s.key} className="relative flex items-start gap-4 rounded-md px-1 py-2.5">
                  <span
                    className={`z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-ink-900 transition-all duration-300 ${
                      st === "done"
                        ? "border-teal text-teal"
                        : st === "active"
                          ? "border-amber text-amber shadow-[0_0_20px_-4px_rgba(255,180,84,0.6)]"
                          : st === "fail"
                            ? "border-rose text-rose"
                            : "border-line text-faint"
                    }`}
                  >
                    {st === "done" ? (
                      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m2.5 7.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : st === "active" ? (
                      <span className="h-2 w-2 rounded-full bg-amber animate-pulse-soft" />
                    ) : st === "fail" ? (
                      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m3.5 3.5 7 7m0-7-7 7" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <span className="h-1 w-1 rounded-full bg-current" />
                    )}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className={`font-display text-base transition-colors ${st === "active" ? "text-amber" : st === "done" ? "text-paper" : st === "fail" ? "text-rose" : "text-faint"}`}>
                      {s.name}
                      {st === "active" && <span className="ml-2 inline-block h-3.5 w-1.5 translate-y-0.5 bg-amber animate-blink" />}
                    </p>
                    <p className={`mt-0.5 text-xs ${st === "done" ? "text-dim" : "text-faint/70"}`}>
                      {s.key === "recognize" && song && st !== "wait"
                        ? `命中：${song.title} — ${song.artist}`
                        : s.key === "align" && st === "done"
                          ? "歌词时间轴已贴合你的音频"
                          : s.detail}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          {recogNote && (
            <p className="animate-rise mt-3 rounded-md border border-line-soft bg-ink-950/60 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-dim">
              <span className="mr-1.5 text-amber">识别链路</span>
              {recogNote}
            </p>
          )}

          {lyricPreview && !failed && (
            <p className="animate-rise mt-2 rounded-md border border-line-soft bg-ink-950/60 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-dim">
              <span className="mr-1.5 text-teal">歌词首句</span>
              “{lyricPreview}”
            </p>
          )}

          {failed && (
            <div className="animate-rise mt-4 space-y-3">
              <div className="rounded-md border border-line-soft bg-ink-850/70 px-4 py-3">
                <p className="font-mono text-[10px] tracking-[0.25em] text-rose">失败原因</p>
                <p className="mt-1.5 text-sm leading-relaxed text-paper/90">{failReason || "没有认出这首歌，或没取到歌词"}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onRetry && (
                  <button onClick={onRetry} className="rounded-md border border-amber/50 bg-amber/10 px-4 py-2 font-display text-sm text-amber transition-all hover:-translate-y-0.5 hover:bg-amber/20">
                    ↻ 重试
                  </button>
                )}
                {onManual && (
                  <button onClick={() => setManualOpen((v) => !v)} className="rounded-md border border-teal/50 bg-teal/10 px-4 py-2 font-display text-sm text-teal transition-all hover:-translate-y-0.5 hover:bg-teal/20">
                    ✎ 我知道歌名
                  </button>
                )}
                {onToken && (
                  <button
                    onClick={() => {
                      setTokenDraft(auddToken ?? "");
                      setTokenOpen((v) => !v);
                    }}
                    className="rounded-md border border-sky/50 bg-sky/10 px-4 py-2 font-display text-sm text-sky transition-all hover:-translate-y-0.5 hover:bg-sky/20"
                  >
                    🔑 {auddToken ? "重新填写 audD token" : "填写 audD token"}
                  </button>
                )}
                {onFallback && (
                  <button onClick={onFallback} className="rounded-md border border-line px-4 py-2 font-mono text-[11px] text-dim transition-colors hover:border-sky/50 hover:text-sky">
                    先随便听听 →
                  </button>
                )}
              </div>

              {manualOpen && onManual && (
                <div className="animate-rise space-y-2 rounded-md border border-line-soft bg-ink-850/50 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={mTitle} onChange={(e) => setMTitle(e.target.value)} placeholder="歌名 *" className="rounded-md border border-line bg-ink-950/80 px-3 py-2 text-sm text-paper outline-none focus:border-teal/60" />
                    <input value={mArtist} onChange={(e) => setMArtist(e.target.value)} placeholder="歌手（可选）" className="rounded-md border border-line bg-ink-950/80 px-3 py-2 text-sm text-paper outline-none focus:border-teal/60" />
                  </div>
                  <button
                    onClick={() => mTitle.trim() && onManual(mTitle.trim(), mArtist.trim())}
                    disabled={!mTitle.trim()}
                    className="rounded-md bg-teal px-4 py-2 font-display text-sm text-ink-950 transition-all enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    按歌名找歌词并对齐 →
                  </button>
                </div>
              )}

              {tokenOpen && onToken && (
                <div className="animate-rise space-y-2 rounded-md border border-line-soft bg-ink-850/50 p-3">
                  <p className="text-xs leading-relaxed text-dim">
                    听声识曲需要一枚免费 token（<span className="font-mono text-sky">audd.io</span> 注册即送额度）。保存前会先验证 token 是否有效，通过后点上方「重试」重新识别。
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={tokenDraft}
                      onChange={(e) => {
                        setTokenDraft(e.target.value);
                        setTokenErr(null);
                      }}
                      placeholder="粘贴 audD token…"
                      className="min-w-0 flex-1 rounded-md border border-line bg-ink-950/80 px-3 py-2 font-mono text-xs text-paper outline-none transition-colors placeholder:text-faint/50 focus:border-sky/60"
                    />
                    <button
                      onClick={async () => {
                        const v = tokenDraft.trim();
                        if (!v || tokenChecking) return;
                        setTokenChecking(true);
                        setTokenErr(null);
                        const check = await validateAudDToken(v);
                        setTokenChecking(false);
                        if (check.ok) {
                          onToken(v);
                          setTokenOpen(false);
                        } else {
                          setTokenErr(check.message);
                        }
                      }}
                      disabled={!tokenDraft.trim() || tokenChecking}
                      className="shrink-0 rounded-md bg-sky px-4 py-2 font-display text-sm text-ink-950 transition-all enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {tokenChecking ? "验证中…" : "验证并保存"}
                    </button>
                  </div>
                  {tokenErr && <p className="font-mono text-[11px] leading-relaxed text-rose">✕ {tokenErr}</p>}
                  <p className="font-mono text-[10px] text-faint">token 只存在你自己的浏览器里，不会上传。</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-line-soft bg-ink-950/60 px-5 py-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
            <div
              className={`h-full rounded-full transition-all duration-700 ${failed ? "bg-rose" : "bg-gradient-to-r from-amber via-sky to-teal"}`}
              style={{ width: failed ? "45%" : `${Math.min(100, ((curIdx + 0.6) / ORDER.length) * 100)}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[10px] tracking-widest text-faint">
            {failed ? "等待你的选择" : "PIPELINE · 全自动 · 无需操作"}
          </p>
        </div>
      </div>
    </div>
  );
}
