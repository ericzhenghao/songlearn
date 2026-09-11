import { useRef, useState } from "react";
import { NATIVE_LANGS, SONG_LANGS } from "../lib/langs";
import { validateAudDToken } from "../lib/recognize";

export function StepUpload({
  onFile,
  nativeLang,
  songLang,
  onNative,
  onSong,
  auddToken,
  onToken,
}: {
  onFile: (f: File) => void;
  nativeLang: string;
  songLang: string;
  onNative: (v: string) => void;
  onSong: (v: string) => void;
  auddToken: string;
  onToken: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [showEngine, setShowEngine] = useState(false);
  const [tokenDraft, setTokenDraft] = useState(auddToken);
  const [tokenChecking, setTokenChecking] = useState(false);
  const [tokenErr, setTokenErr] = useState<string | null>(null);

  const pick = (f: File | undefined | null) => {
    if (f && (f.type.startsWith("audio") || f.type.startsWith("video"))) onFile(f);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 语言设置 */}
      <div className="animate-rise rounded-lg border border-line bg-ink-900/80 p-5">
        <p className="font-mono text-[11px] tracking-[0.3em] text-faint">开始之前 · 选好语言，翻译方向一次定好</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block font-display text-sm text-paper">母语（歌词译成它）</span>
            <select
              value={nativeLang}
              onChange={(e) => onNative(e.target.value)}
              className="w-full rounded-md border border-line bg-ink-950/80 px-3 py-2.5 text-sm text-paper outline-none transition-colors focus:border-amber/60"
            >
              {NATIVE_LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block font-display text-sm text-paper">歌曲语言 · 按唱的选，别照歌名</span>
            <select
              value={songLang}
              onChange={(e) => onSong(e.target.value)}
              className="w-full rounded-md border border-line bg-ink-950/80 px-3 py-2.5 text-sm text-paper outline-none transition-colors focus:border-amber/60"
            >
              {SONG_LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 font-mono text-[11px] text-dim">
          翻译方向：歌曲语言 → <span className="text-teal">{NATIVE_LANGS.find((l) => l.code === nativeLang)?.label}</span>
        </p>
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-faint">
          找歌词时按<span className="text-amber">演唱语言</span>为准，不照歌名——比如《Waka Waka》歌名是英文，但西语版就选 Español。
        </p>

        <button onClick={() => setShowEngine((v) => !v)} className="mt-3 font-mono text-[11px] text-faint underline-offset-2 transition-colors hover:text-amber hover:underline">
          {showEngine ? "▾ 收起" : "▸ 听声识曲设置（audD token）"}
        </button>
        {showEngine && (
          <div className="animate-rise mt-3 space-y-2">
            <p className="text-xs leading-relaxed text-dim">
              听声识曲需要一枚免费的 audD token（<span className="font-mono text-teal">audd.io</span> 注册即送额度）。配置后，上传任意歌曲都能自动认出歌名。
            </p>
            <div className="flex gap-2">
              <input
                value={tokenDraft}
                onChange={(e) => {
                  setTokenDraft(e.target.value);
                  setTokenErr(null);
                }}
                placeholder="粘贴 audD token…"
                className="min-w-0 flex-1 rounded-md border border-line bg-ink-950/80 px-3 py-2 font-mono text-xs text-paper outline-none transition-colors placeholder:text-faint/50 focus:border-amber/60"
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
                    setTokenDraft(v);
                  } else {
                    setTokenErr(check.message);
                  }
                }}
                disabled={!tokenDraft.trim() || tokenChecking}
                className="shrink-0 rounded-md border border-amber/50 bg-amber/10 px-4 py-2 font-display text-sm text-amber transition-all enabled:hover:-translate-y-0.5 enabled:hover:bg-amber/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {tokenChecking ? "验证中…" : "验证并保存"}
              </button>
            </div>
            {tokenErr && <p className="font-mono text-[11px] leading-relaxed text-rose">✕ {tokenErr}</p>}
            <p className="font-mono text-[10px] text-faint">token 只存在你自己的浏览器里，不会上传。</p>
          </div>
        )}
      </div>

      {/* 拖拽区 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        className={`animate-rise group cursor-pointer rounded-xl border-2 border-dashed px-6 py-14 text-center transition-all duration-300 ${
          drag
            ? "scale-[1.01] border-amber bg-amber/8 shadow-[0_20px_60px_-20px_rgba(255,180,84,0.4)]"
            : "border-line bg-ink-900/60 hover:-translate-y-1 hover:border-amber/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/*"
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full border transition-all duration-300 ${drag ? "border-amber text-amber" : "border-line text-dim group-hover:border-amber/50 group-hover:text-amber"}`}>
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
            <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
        </div>
        <p className="mt-4 font-display text-xl text-paper">{drag ? "松手，交给系统" : "把歌曲拖进来"}</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-dim">
          音频、视频都行（mp3 / wav / mp4 / webm…）。上传后<strong className="text-amber">全自动</strong>：
          识别歌曲 → 搜索歌词 → <strong className="text-teal">自动对齐</strong> → 存进曲库 → 直接开唱。
        </p>
        <p className="mt-3 font-mono text-[11px] text-faint">文件只在浏览器本地处理，不上传服务器</p>
      </div>
    </div>
  );
}
