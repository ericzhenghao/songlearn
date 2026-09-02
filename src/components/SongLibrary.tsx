import { useMemo, useRef, useState } from "react";
import type { LibrarySong } from "../lib/library";
import { langLabel } from "../lib/langs";
import { LIB_SONG_CAP } from "../lib/globalLib";

const fmtDur = (s: number) => {
  if (!s || !Number.isFinite(s)) return "--:--";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const SOURCE_BADGE: Record<LibrarySong["source"], { label: string; cls: string; hint: string }> = {
  bundled: { label: "内置", cls: "border-amber/50 bg-amber/10 text-amber", hint: "随项目发布，人人可见" },
  cloud: { label: "云端", cls: "border-sky/50 bg-sky/10 text-sky", hint: "共享曲库，打开链接的人都能看到" },
  local: { label: "本地", cls: "border-teal/50 bg-teal/10 text-teal", hint: "你的浏览器缓存，含音频秒开" },
};

export default function SongLibrary({
  open,
  onClose,
  songs,
  onOpen,
  onDelete,
  onExport,
  onImport,
  openingId,
  libId,
  libError,
  creatingLib,
  onCreateLib,
  onCopyLink,
  onRefreshLib,
}: {
  open: boolean;
  onClose: () => void;
  songs: LibrarySong[];
  onOpen: (s: LibrarySong) => void;
  onDelete: (s: LibrarySong) => void;
  onExport: () => void;
  onImport: (f: File) => void;
  openingId?: string | null;
  libId?: string | null;
  libError?: string | null;
  creatingLib?: boolean;
  onCreateLib?: () => void;
  onCopyLink?: () => void;
  onRefreshLib?: () => void;
}) {
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cloudCount = songs.filter((s) => s.source === "cloud").length;

  /* 容量账：索引按首数计（~250B/首，上限 400）；音频按永久直链总体积计（不设上限） */
  const hostedBytes = songs.reduce((sum, s) => sum + (s.audioUrl ? s.size || 0 : 0), 0);
  const capPct = Math.min(100, Math.round((cloudCount / LIB_SONG_CAP) * 100));
  const nearCap = capPct >= 85;
  const fmtBytes = (b: number) =>
    b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b > 0 ? `${Math.round(b / 1024)} KB` : "0";

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return songs;
    return songs.filter((r) => `${r.title} ${r.artist}`.toLowerCase().includes(s));
  }, [songs, q]);

  const hasAudio = (s: LibrarySong) => !!(s.fileBlob || s.audioInRepo || s.audioUrl);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-line bg-ink-900 shadow-[-30px_0_90px_-20px_rgba(4,8,20,0.95)] transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center gap-3 border-b border-line-soft bg-ink-850/80 px-5 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-md border border-amber/40 bg-amber/10 text-amber">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="font-display text-lg leading-tight text-paper">歌曲库</p>
            <p className="font-mono text-[10px] tracking-widest text-faint">{songs.length} 首 · 项目资产</p>
          </div>
          <button onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-md border border-line text-dim transition-colors hover:border-rose/50 hover:text-rose" title="关闭">
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m3.5 3.5 7 7m0-7-7 7" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 容量账本：索引按首数封顶，音频是永久直链不设上限 */}
        <div className="border-b border-line-soft bg-ink-950/50 px-5 py-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] tracking-[0.22em] text-faint">共享库容量</span>
            <span className={`font-mono text-[11px] ${nearCap ? "text-rose animate-pulse-soft" : "text-dim"}`}>
              索引 <span className={nearCap ? "text-rose" : "text-amber"}>{cloudCount}</span> / {LIB_SONG_CAP} 首
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-700">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                nearCap ? "bg-rose" : "bg-gradient-to-r from-amber via-sky to-teal"
              }`}
              style={{ width: `${Math.max(2, capPct)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-faint">
            <span>
              已托管音频 <span className="text-teal">{fmtBytes(hostedBytes)}</span>
            </span>
            <span title="索引只存引用（约 250B/首）；歌词与音频各自是 catbox 永久直链，体积不计入索引">
              音频体积不设上限 · 单文件 ≤150MB
            </span>
          </div>
        </div>

        {/* 共享曲库：曲库链接 = 朋友圈入口，人人共享同一个库 */}
        <div className="border-b border-line-soft bg-gradient-to-r from-sky/8 to-transparent px-5 py-3">
          {libId ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-teal animate-pulse-soft" />
                <span className="font-mono text-[11px] text-paper">
                  共享曲库已连接 · <span className="text-sky">{cloudCount}</span> 首云端歌曲
                </span>
                <button onClick={onRefreshLib} className="ml-auto font-mono text-[10px] text-faint transition-colors hover:text-sky" title="刷新云端列表">
                  ↻ 刷新
                </button>
              </div>
              <button
                onClick={onCopyLink}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-sky/50 bg-sky/10 px-3 py-2.5 font-display text-sm text-sky transition-all hover:-translate-y-0.5 hover:bg-sky/20 hover:shadow-[0_10px_30px_-10px_rgba(126,178,255,0.5)]"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M6.5 9.5 9.5 6.5M5 8 3.5 9.5a2.8 2.8 0 0 0 4 4L9 12M7 4l1.5-1.5a2.8 2.8 0 0 1 4 4L11 8" strokeLinecap="round" />
                </svg>
                复制曲库链接 · 发朋友圈
              </button>
              <p className="font-mono text-[10px] leading-relaxed text-faint">
                任何人点开链接都进入这 {songs.length} 首的曲库；他们上传的歌也会自动进这个库（库 ID {libId.slice(0, 8)}…）
              </p>
              {libError && <p className="font-mono text-[10px] text-rose">{libError}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-dim">
                现在的歌只存在<strong className="text-teal">你的浏览器</strong>里。建一个共享曲库（免费、免注册），
                上传的歌自动同步进去，链接发给朋友就能一起攒这个库。
              </p>
              <button
                onClick={onCreateLib}
                disabled={creatingLib}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-sky px-3 py-2.5 font-display text-sm text-ink-950 transition-all enabled:hover:-translate-y-0.5 enabled:hover:shadow-[0_10px_30px_-10px_rgba(126,178,255,0.6)] disabled:opacity-50"
              >
                {creatingLib ? "创建中…" : "⊕ 创建共享曲库（免费 · 免注册）"}
              </button>
            </div>
          )}
        </div>

        {/* 导出 / 导入 */}
        <div className="flex items-center gap-2 border-b border-line-soft px-5 py-3">
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 rounded-md border border-amber/50 bg-amber/10 px-3 py-1.5 font-mono text-[11px] text-amber transition-all hover:-translate-y-0.5 hover:bg-amber/20"
            title="把整个曲库导出成 JSON，写进项目就随代码发布"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 2v8m0 0 3-3M8 10 5 7M3 13h10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            导出曲库
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md border border-teal/50 bg-teal/10 px-3 py-1.5 font-mono text-[11px] text-teal transition-all hover:-translate-y-0.5 hover:bg-teal/20"
            title="导入别人分享的曲库 JSON"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 10V2m0 0 3 3M8 2 5 5M3 13h10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            导入曲库
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = "";
            }}
          />
          <span className="ml-auto font-mono text-[10px] text-faint">曲库 = 项目资产，越攒越值钱</span>
        </div>

        {/* 搜索 */}
        <div className="border-b border-line-soft px-5 py-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索歌名 / 歌手…"
            className="w-full rounded-md border border-line bg-ink-950/80 px-3 py-2 text-sm text-paper outline-none transition-colors placeholder:text-faint/60 focus:border-amber/60"
          />
        </div>

        {/* 列表 */}
        <div className="thin-scroll flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <svg viewBox="0 0 48 48" className="h-12 w-12 text-faint" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 38V10l20-4v26" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="13" cy="38" r="5" />
                <circle cx="33" cy="32" r="5" />
              </svg>
              <p className="text-sm text-dim">{songs.length === 0 ? "曲库还空着" : "没有匹配的歌"}</p>
              <p className="max-w-[260px] text-xs leading-relaxed text-faint">
                上传第一首歌，它会自动存进曲库；点「导出曲库」写进项目，就会随下载和分享带出去。
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {filtered.map((s) => {
                const badge = SOURCE_BADGE[s.source];
                const total = s.lineCount ?? countLines(s.lrc);
                const masteredPct = s.mastered.length && total ? Math.round((s.mastered.length / total) * 100) : 0;
                return (
                  <li
                    key={s.id}
                    className="group animate-rise rounded-lg border border-line bg-ink-850/70 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber/40 hover:shadow-[0_12px_30px_-14px_rgba(255,180,84,0.4)]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-display text-base text-paper">{s.title}</p>
                          <span className={`shrink-0 rounded border px-1.5 py-px font-mono text-[9px] tracking-wider ${badge.cls}`} title={badge.hint}>
                            {badge.label}
                          </span>
                          {hasAudio(s) ? (
                            <span className="shrink-0 rounded border border-teal/40 bg-teal/8 px-1.5 py-px font-mono text-[9px] text-teal" title="含音频，点开就能跟唱">
                              ♪ 含音频
                            </span>
                          ) : (
                            <span className="shrink-0 rounded border border-line px-1.5 py-px font-mono text-[9px] text-faint" title="只带歌词+时间轴；上传同名音频即可跟唱">
                              仅歌词
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-dim">
                          {s.artist}
                          {s.lang ? ` · ${langLabel(s.lang)}` : ""}
                          {` · ${fmtDur(s.duration)}`}
                          {s.plays ? ` · ♪${s.plays}` : ""}
                          {s.by ? ` · ${s.by} 上传` : ""}
                        </p>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-700">
                          <div className="h-full rounded-full bg-gradient-to-r from-amber to-teal transition-all" style={{ width: `${masteredPct}%` }} />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <button
                          onClick={() => onOpen(s)}
                          disabled={openingId === s.id}
                          className="rounded-md bg-amber px-3 py-1.5 font-display text-xs text-ink-950 transition-all enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-60"
                        >
                          {openingId === s.id ? "打开中…" : "学唱"}
                        </button>
                        <button
                          onClick={() => onDelete(s)}
                          className="rounded-md border border-line px-3 py-1 font-mono text-[10px] text-dim transition-colors hover:border-rose/50 hover:text-rose"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 机制说明 */}
        <div className="border-t border-line-soft bg-ink-950/60 px-5 py-3">
          <p className="font-mono text-[10px] leading-relaxed text-faint">
            三层曲库：<span className="text-amber">内置</span>（随项目代码）· <span className="text-sky">云端</span>（共享）·{" "}
            <span className="text-teal">本地</span>（你的缓存）。
          </p>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
            云端容量：索引只存引用（约 250B/首，可容 ~300 首）；<span className="text-teal">歌词与音频各自存永久直链，不计入索引、不限量</span>。
          </p>
        </div>
      </aside>
    </>
  );
}

function countLines(lrc: string): number {
  let n = 0;
  for (const line of lrc.split(/\r?\n/)) {
    if (/^\[\d{1,3}:\d{1,2}[.:,]\d{1,3}\]/.test(line.trim())) n++;
  }
  return n;
}
