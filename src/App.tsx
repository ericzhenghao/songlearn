import { useEffect, useMemo, useRef, useState } from "react";
import AutoProcess, { type ProcessStage } from "./components/AutoProcess";
import LearnStep from "./components/LearnStep";
import SongLibrary from "./components/SongLibrary";
import { StepUpload } from "./components/PipelineSteps";
import { autoAlign, detectOnsetsBuffer, type OnsetInfo } from "./lib/align";
import { decodeAudio } from "./lib/audio";
import { MediaFileClock, type Clock } from "./lib/clock";
import { langLabel, NATIVE_LANGS } from "./lib/langs";
import { exportLibrary, loadBundled, mergeLibrary, parseImport, entriesToRecords, type LibrarySong } from "./lib/library";
import { parseLRC, splitPlainLyrics, type ParsedLRC } from "./lib/lrc";
import { detectLanguage, fetchLyricsForRecognizedSong } from "./lib/lyrics";
import {
  bumpPlays,
  createLib,
  fetchAudio,
  fetchText,
  hostAudio,
  hostText,
  libLink,
  loadLib,
  loadNick,
  MAX_AUDIO,
  pushGlobal,
  readLib,
  removeGlobal,
  saveLib,
  type GlobalSong,
} from "./lib/globalLib";
import { recognizeAudio, type RecogResult } from "./lib/recognize";
import { deleteSong, findByTitleArtist, listSongs, newId, putSong, updateSong, type SongRecord } from "./lib/songdb";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STEPS = ["上传歌曲", "自动处理", "学唱"];

/** 云端条目 → 统一曲库条目 */
const g2l = (g: GlobalSong): LibrarySong => ({
  id: g.id,
  title: g.title,
  artist: g.artist,
  album: g.album,
  lang: g.lang,
  fileName: `${g.title}.mp3`,
  mime: g.audioMime || "audio/mpeg",
  fileBlob: null,
  source: "cloud",
  duration: g.duration,
  /* 歌词正文在 catbox 直链上，打开歌曲时再拉；lineCount 让列表不拉全文也能显示进度 */
  lrc: g.lrc ?? "",
  lrcUrl: g.lrcUrl ?? null,
  lineCount: g.lines,
  mastered: [],
  addedAt: g.addedAt,
  size: 0,
  audioUrl: g.audioUrl ?? undefined,
  plays: g.plays,
  by: g.by,
});

export default function App() {
  /* ---------------- 基础流程状态 ---------------- */
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState<ProcessStage>("decode");
  const [file, setFile] = useState<File | null>(null);
  const [clock, setClock] = useState<Clock | null>(null);
  const [onsets, setOnsets] = useState<OnsetInfo | null>(null);
  const [song, setSong] = useState<{ title: string; artist: string; album?: string; lang: string; year: string } | null>(null);
  const [parsed, setParsed] = useState<ParsedLRC | null>(null);
  const [alignNote, setAlignNote] = useState<string | null>(null);
  const [mastered, setMastered] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [recogNote, setRecogNote] = useState<string | null>(null);
  const [lyricPreview, setLyricPreview] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  /* ---------------- 语言 & token ---------------- */
  const [nativeLang, setNativeLangState] = useState(() => localStorage.getItem("sl-native") || "zh-CN");
  const [songLang, setSongLangState] = useState(() => localStorage.getItem("sl-song") || "auto");
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [auddToken, setAuddTokenState] = useState(() => localStorage.getItem("sl-audd-token") || "");
  const setNativeLang = (v: string) => {
    setNativeLangState(v);
    localStorage.setItem("sl-native", v);
  };
  const setSongLang = (v: string) => {
    setSongLangState(v);
    localStorage.setItem("sl-song", v);
  };
  const setAuddToken = (v: string) => {
    setAuddTokenState(v);
    localStorage.setItem("sl-audd-token", v);
  };
  const toCode = NATIVE_LANGS.find((l) => l.code === nativeLang)?.short ?? "zh";
  const toLabel = NATIVE_LANGS.find((l) => l.code === nativeLang)?.label ?? "简体中文";

  /* ---------------- 曲库：共享（npoint+catbox）· 内置（仓库）· 本地（IndexedDB） ---------------- */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libId, setLibId] = useState<string | null>(() => loadLib());
  const [libError, setLibError] = useState<string | null>(null);
  const [creatingLib, setCreatingLib] = useState(false);
  const [globalSongs, setGlobalSongs] = useState<LibrarySong[]>([]);
  const [localSongs, setLocalSongs] = useState<SongRecord[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const bundled = useMemo(() => loadBundled(), []);
  const merged = useMemo(
    () => mergeLibrary(localSongs, globalSongs, bundled),
    [localSongs, globalSongs, bundled]
  );

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3800);
  };

  const refreshLocal = async () => {
    try {
      setLocalSongs(await listSongs());
    } catch {
      /* IndexedDB 不可用时静默降级 */
    }
  };

  const refreshGlobal = async (bin?: string | null) => {
    const id = bin ?? libId;
    if (!id) return;
    try {
      setLibError(null);
      setGlobalSongs((await readLib(id)).map(g2l));
    } catch (e) {
      setLibError(e instanceof Error ? e.message : "共享曲库连接失败");
    }
  };

  useEffect(() => {
    void refreshLocal();
    void refreshGlobal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 掌握进度自动回写本地存档 */
  useEffect(() => {
    if (!currentId) return;
    void updateSong(currentId, { mastered: [...mastered] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mastered, currentId]);

  /* ---------------- 共享曲库：上传后自动入库（别人上传的也进同一个库） ----------------
   * 歌词正文 → catbox 永久直链（.lrc 文件）；音频 → catbox 永久直链（带进度）；
   * npoint 索引只存 {标题/歌手/两个直链/行数/热度}，约 250B/首，可容 ~300 首。
   */
  async function shareToGlobal(rec: SongRecord, f: File | null) {
    const bin = libId;
    if (!bin) return;
    const slug = (s: string) => s.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "");
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
    try {
      setShareMsg(`共享《${rec.title}》· 歌词写入永久存储…`);
      const lrcUrl = await hostText(rec.lrc, `${slug(rec.title)}-${slug(rec.artist)}.lrc`);
      if (!lrcUrl) {
        setShareMsg(null);
        showToast("共享库暂不可用（歌词上传失败），已存本地曲库");
        return;
      }

      let audioUrl: string | null = null;
      if (f) {
        if (f.size > MAX_AUDIO) {
          setShareMsg(`共享《${rec.title}》· 音频 ${mb(f.size)} 超过 ${mb(MAX_AUDIO)}，改为仅共享歌词`);
          await wait(900);
        } else {
          audioUrl = await hostAudio(f, f.name, (loaded, total) => {
            setShareMsg(`共享《${rec.title}》· 音频上传 ${Math.round((loaded / total) * 100)}%（${mb(loaded)} / ${mb(total)}）`);
          });
        }
      }

      const lines = rec.lrc.split(/\r?\n/).filter((l) => /^\[\d{1,3}:\d{1,2}[.:,]\d{1,3}\]/.test(l.trim())).length;
      const g: GlobalSong = {
        id: rec.id,
        title: rec.title,
        artist: rec.artist,
        album: rec.album,
        lang: rec.lang,
        duration: rec.duration,
        lines,
        lrcUrl,
        plays: 0,
        audioUrl,
        audioMime: rec.mime || "audio/mpeg",
        by: loadNick(),
        addedAt: Date.now(),
      };
      const songs = await pushGlobal(bin, g);
      setGlobalSongs(songs.map(g2l));
      setShareMsg(null);
      showToast(
        audioUrl
          ? `✓ 《${rec.title}》已共享：含音频直链，朋友点开就能唱`
          : `✓ 《${rec.title}》已共享歌词+时间轴（朋友可配自己的音频学唱）`
      );
    } catch {
      setShareMsg(null);
      showToast("同步共享曲库失败（网络），歌曲已存进你的本地曲库");
    }
  }

  /* ---------------- 收尾：解析 → 对齐 → 存档 → 入库 → 开学唱 ---------------- */
  async function finalize(
    hitTitle: string,
    hitArtist: string,
    album: string | undefined,
    lyricsText: string,
    detected: string | null,
    f: File | null,
    duration: number
  ) {
    setSong({ title: hitTitle, artist: hitArtist, album, lang: detected ?? "", year: "" });
    setDetectedLang(detected);
    setStage("lyrics");

    const firstLine = lyricsText
      .split(/\r?\n/)
      .map((l) => l.replace(/^\[[^\]]*\]/g, "").trim())
      .find((l) => l.length > 0);
    setLyricPreview(firstLine ?? null);

    await wait(600);

    /* 解析：带时间戳的 LRC 直接用；纯文本先逐句切分 */
    const parsed0 = parseLRC(lyricsText);
    let lines = parsed0.lines;
    if (lines.length === 0 && lyricsText.trim()) {
      lines = splitPlainLyrics(lyricsText).map((text) => ({ time: 0, text }));
    }
    if (lines.length === 0) throw new Error("歌词解析为空");

    setStage("align");
    await wait(500);

    let finalLines = lines;
    if (onsets) {
      const res = autoAlign(lines, onsets, duration);
      finalLines = res.aligned ? res.lines : lines;
      setAlignNote(
        res.mode === "anchor"
          ? `自动对齐：锁定 ${res.anchors.length}/${lines.length} 个句点` +
            (Math.abs(res.avgDelta) > 0.05 ? ` · 整体修正 ${res.avgDelta >= 0 ? "+" : ""}${res.avgDelta.toFixed(1)}s` : "")
          : res.mode === "segment"
            ? (res.notes[0] ?? `纯文本歌词：已按人声段排好 ${finalLines.length} 句`)
            : "按歌词自带时间轴播放"
      );
    }
    if (finalLines.every((l) => l.time <= 0.01)) {
      const dur = duration || finalLines.length * 4;
      const st = (dur * 0.92) / finalLines.length;
      finalLines = finalLines.map((l, i) => ({ ...l, time: st * (i + 0.5) }));
      setAlignNote(`没检测到清晰句点：按歌长把 ${finalLines.length} 句歌词均匀排好`);
    }
    setParsed({ ...parsed0, lines: finalLines });

    /* 存档：本地 IndexedDB（含音频）+ 共享曲库（npoint 元数据 + catbox 音频直链） */
    const lrcText = exportLRC(hitTitle, hitArtist, album, finalLines);
    const existed = await findByTitleArtist(hitTitle, hitArtist);
    const recId = existed?.id ?? newId();
    const rec: SongRecord = {
      id: recId,
      title: hitTitle,
      artist: hitArtist,
      album,
      lang: detected,
      fileName: f?.name ?? `${hitTitle}.mp3`,
      mime: f?.type ?? "audio/mpeg",
      fileBlob: f ?? null,
      source: "upload",
      duration,
      lrc: lrcText,
      mastered: existed?.mastered ?? [],
      addedAt: Date.now(),
      size: f?.size ?? 0,
    };
    await putSong(rec);
    setCurrentId(recId);
    void refreshLocal();
    void shareToGlobal(rec, f); // 不阻塞进入学唱

    setStage("done");
    showToast(`《${hitTitle}》已存进曲库，开始学唱`);
    await wait(1200);
    setStep(2);
  }

  /* ---------------- 全自动流水线 ---------------- */
  async function runPipeline(f: File) {
    clock?.destroy?.();
    setClock(null);
    setParsed(null);
    setSong(null);
    setMastered(new Set());
    setAlignNote(null);
    setFailReason(null);
    setRecogNote(null);
    setLyricPreview(null);
    setFile(f);
    setStep(1);
    setStage("decode");

    try {
      const buffer = await decodeAudio(f);
      const mediaClock = new MediaFileClock(f);
      setClock(mediaClock);

      const duration = buffer.duration;
      setStage("fingerprint");
      const onsetsRes = await detectOnsetsBuffer(buffer);
      setOnsets(onsetsRes);

      setStage("recognize");
      let result: RecogResult | null = null;

      if (auddToken.trim()) {
        result = await recognizeAudio(f, auddToken, setRecogNote);
        if (!result) {
          setRecogNote("音频指纹比对完成，未命中曲库");
          await wait(300);
        }
      } else {
        setRecogNote("未配置 audD token，跳过听声识曲（上传页可填免费 token）");
        await wait(300);
      }

      if (!result) {
        setFailReason(
          auddToken.trim()
            ? "音频指纹没有命中曲库。可手动指定歌名，或进跟读模式。"
            : "还没认出这首歌：听声识曲需要一枚免费 audD token（audd.io 注册即送，上传页粘贴即可）。也可手动指定歌名。"
        );
        setStage("failed");
        return;
      }

      setRecogNote(result.detail);
      setStage("lyrics");

      const foundLyrics = await fetchLyricsForRecognizedSong(result.title, result.artist, duration);
      let lyricsText: string | null = null;
      if (foundLyrics) {
        lyricsText = foundLyrics.text;
        setRecogNote(
          `${result.detail} · 歌词来自 ${foundLyrics.via}${
            foundLyrics.synced ? "（带时间戳，对齐更准）" : "（纯文本，按人声段估算）"
          }`
        );
      } else if (result.lyrics) {
        lyricsText = result.lyrics;
        setRecogNote(`${result.detail} · 在线歌词库未返回全文，用识别服务自带的歌词`);
      }

      if (!lyricsText) {
        setFailReason(`认出了《${result.title}》— ${result.artist}，但没取到歌词（可能网络受限）。可重试，或手动指定歌名。`);
        setStage("failed");
        return;
      }

      const detected = detectLanguage(lyricsText) ?? null;
      await finalize(result.title, result.artist, result.album, lyricsText, detected, f, duration);
    } catch {
      setFailReason((r) => r || "处理过程出了点意外（解码或网络），重试一次通常能解决。");
      setStage("failed");
    }
  }

  /* 手动指定歌名：识别失败时的兜底 */
  async function manualResolve(title: string, artist: string) {
    if (!onsets || !file) return;
    setFailReason(null);
    setStage("recognize");
    setRecogNote(`按你给的歌名「${title}${artist ? ` — ${artist}` : ""}」搜索歌词库…`);
    try {
      await wait(400);
      const found = await fetchLyricsForRecognizedSong(title, artist || title, clock?.duration ?? 0);
      if (!found) {
        setFailReason(`歌词库没找到《${title}》的歌词。换个写法试试，或进跟读模式。`);
        setStage("failed");
        return;
      }
      setRecogNote(`命中《${title}》${artist ? ` — ${artist}` : ""}（${found.via}），正在解析并对齐…`);
      const detected = detectLanguage(found.text) ?? null;
      await finalize(title, artist || "未知艺人", undefined, found.text, detected, file, clock?.duration ?? 0);
    } catch {
      setFailReason("网络异常，没取到歌词，稍后再试。");
      setStage("failed");
    }
  }

  /* 跟读模式：识别全失败也不卡住 —— 按人声段自动生成「♪ 跟唱段」逐段练 */
  function openFallback() {
    if (!clock) return;
    const vs = onsets?.vocalStart ?? 5;
    const ve = onsets?.vocalEnd ?? (clock.duration || 60);
    const span = Math.max(10, ve - vs);
    const n = Math.max(4, Math.min(30, Math.round(span / 6)));
    const lines = Array.from({ length: n }, (_, i) => ({
      time: vs + (span * i) / n,
      text: `♪ 跟唱段 ${i + 1}`,
    }));
    setParsed({ lines, offsetMs: 0, meta: {}, warnings: [] });
    setSong({ title: file?.name ?? "跟唱练习", artist: "未识别出歌词 · 跟读模式", lang: "", year: "" });
    setDetectedLang(null);
    setMastered(new Set());
    setAlignNote(`跟读模式：按人声段 ${vs.toFixed(0)}s → ${ve.toFixed(0)}s 切成 ${n} 段`);
    setLibraryOpen(false);
    setStep(2);
    showToast("进入跟读模式：逐段听、逐段唱");
  }

  /* ---------------- 曲库操作 ---------------- */
  async function openLibrarySong(s: LibrarySong) {
    setOpeningId(s.id);
    try {
      let f: File | null = s.fileBlob ? new File([s.fileBlob], s.fileName, { type: s.mime || "audio/mpeg" }) : null;
      if (!f && s.audioInRepo) {
        try {
          const r = await fetch(`${import.meta.env.BASE_URL}${s.audioInRepo}`);
          if (r.ok) {
            const b = await r.blob();
            f = new File([b], s.fileName, { type: s.mime || "audio/mpeg" });
          }
        } catch {
          /* 继续尝试下一个来源 */
        }
      }
      if (!f && s.audioUrl) {
        f = await fetchAudio(s.audioUrl);
      }
      if (!f) {
        showToast(`《${s.title}》暂时只有歌词 —— 上传同名音频即可学唱`);
        return;
      }
      /* 歌词：本地内联优先，否则从永久直链拉全文 */
      let lrcText = s.lrc && s.lrc.trim() ? s.lrc : null;
      if (!lrcText && s.lrcUrl) lrcText = await fetchText(s.lrcUrl);
      if (!lrcText) {
        showToast(`《${s.title}》的歌词拉取失败，请重试`);
        return;
      }
      clock?.destroy?.();
      const mc = new MediaFileClock(f);
      setClock(mc);
      setFile(f);
      setOnsets(null);
      setSong({ title: s.title, artist: s.artist, album: s.album, lang: s.lang ?? "", year: "" });
      setDetectedLang(s.lang);
      setParsed(parseLRC(lrcText));
      setMastered(new Set(s.mastered ?? []));
      setAlignNote(null);
      setCurrentId(s.id);
      setLibraryOpen(false);
      setStep(2);
      showToast(`从曲库打开《${s.title}》${s.source === "cloud" ? ` · ${s.by ?? "听友"} 分享` : ""}`);
      if (s.source === "cloud" && libId) void bumpPlays(libId, s.id).then(() => refreshGlobal());
    } catch (e) {
      showToast(e instanceof Error ? e.message : "打开歌曲失败");
    } finally {
      setOpeningId(null);
    }
  }

  async function deleteLibrarySong(s: LibrarySong) {
    try {
      if (s.source === "local") {
        await deleteSong(s.id);
        if (currentId === s.id) setCurrentId(null);
        await refreshLocal();
      } else if (s.source === "cloud" && libId) {
        setGlobalSongs((await removeGlobal(libId, s.id)).map(g2l));
      } else {
        showToast("内置曲目属于项目资产：编辑 src/data/library.json 才能移除");
        return;
      }
      showToast(`已删除《${s.title}》`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const json = exportLibrary(merged);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "library.json";
      a.click();
      URL.revokeObjectURL(a.href);
      showToast("已导出 library.json —— 覆盖进 src/data/library.json 重新部署，曲库就随项目发布");
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(f: File) {
    try {
      const entries = parseImport(await f.text());
      const recs = entriesToRecords(entries);
      for (const r of recs) await putSong(r);
      await refreshLocal();
      showToast(`已导入 ${recs.length} 首${libId ? "，可点曲目同步进共享曲库" : ""}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "导入失败：文件格式不对");
    }
  }

  async function handleCreateLib() {
    setCreatingLib(true);
    try {
      const id = await createLib();
      saveLib(id);
      setLibId(id);
      setGlobalSongs([]);
      showToast("共享曲库已创建！复制曲库链接发朋友圈，朋友上传的歌都会进这个库");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "创建共享曲库失败（网络受限）");
    } finally {
      setCreatingLib(false);
    }
  }

  async function handleCopyLink() {
    if (!libId) return;
    try {
      await navigator.clipboard.writeText(libLink(libId));
      showToast("曲库链接已复制 —— 任何人点开都进入同一个曲库");
    } catch {
      showToast(libLink(libId));
    }
  }

  const resetAll = () => {
    clock?.destroy?.();
    setClock(null);
    setFile(null);
    setOnsets(null);
    setSong(null);
    setParsed(null);
    setAlignNote(null);
    setMastered(new Set());
    setFailReason(null);
    setRecogNote(null);
    setLyricPreview(null);
    setStep(0);
  };

  /* ---------------- 渲染 ---------------- */
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-ink-950 font-body text-paper">
      {/* 分层环境背景 */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-blueprint" />
        <div className="absolute -top-48 left-1/2 h-[540px] w-[840px] -translate-x-1/2 rounded-full bg-amber/8 blur-[130px]" />
        <div className="absolute bottom-[-220px] left-[-120px] h-[480px] w-[480px] rounded-full bg-sky/7 blur-[110px]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink-950 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-950 to-transparent" />
      </div>

      {/* Toast */}
      {toast && (
        <div className="animate-rise fixed left-1/2 top-5 z-[60] w-max max-w-[92vw] -translate-x-1/2">
          <div className="flex items-center gap-2.5 rounded-full border border-teal/50 bg-ink-900/95 px-5 py-2.5 shadow-[0_16px_50px_-12px_rgba(61,220,192,0.45)]">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal text-ink-950">
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="m2 6.5 2.5 2.5L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="font-display text-sm text-paper">{toast}</span>
          </div>
        </div>
      )}

      {/* 共享进度浮标（上传音频到永久存储时显示） */}
      {shareMsg && (
        <div className="animate-rise fixed bottom-6 left-1/2 z-[60] w-max max-w-[92vw] -translate-x-1/2">
          <div className="flex items-center gap-2.5 rounded-full border border-amber/50 bg-ink-900/95 px-5 py-2.5 shadow-[0_16px_50px_-12px_rgba(255,180,84,0.4)]">
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber animate-pulse-soft" />
            <span className="font-mono text-xs text-amber">{shareMsg}</span>
          </div>
        </div>
      )}

      <div className="relative z-10">
        {/* 页头 */}
        <header className="sticky top-0 z-40 border-b border-line-soft bg-ink-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
            <button onClick={resetAll} className="group flex items-center gap-3 text-left">
              <span className="grid h-10 w-10 place-items-center rounded-lg border border-amber/40 bg-gradient-to-br from-amber/20 to-transparent text-amber transition-transform duration-300 group-hover:rotate-6">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V6l11-2v12" />
                  <circle cx="6.5" cy="18" r="2.5" />
                  <circle cx="17.5" cy="16" r="2.5" />
                </svg>
              </span>
              <span>
                <span className="block font-display text-xl leading-tight text-paper">
                  Song<span className="text-amber">Learn</span>
                </span>
                <span className="block font-mono text-[10px] tracking-[0.2em] text-faint">听歌学外语 · 曲库是项目资产</span>
              </span>
            </button>

            <div className="flex items-center gap-3">
              {libId && (
                <button
                  onClick={handleCopyLink}
                  className="hidden items-center gap-1.5 rounded-md border border-sky/40 bg-sky/10 px-3 py-2 font-mono text-[11px] text-sky transition-all hover:-translate-y-0.5 hover:bg-sky/20 sm:flex"
                  title="复制曲库链接 —— 发朋友圈，人人共享同一个曲库"
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M6.5 9.5 9.5 6.5M5 8 3.5 9.5a2.8 2.8 0 0 0 4 4L9 12M7 4l1.5-1.5a2.8 2.8 0 0 1 4 4L11 8" strokeLinecap="round" />
                  </svg>
                  分享曲库
                </button>
              )}
              <button
                onClick={() => setLibraryOpen(true)}
                className="group flex items-center gap-2 rounded-md border border-amber/45 bg-amber/10 px-3.5 py-2 font-display text-sm text-amber transition-all hover:-translate-y-0.5 hover:bg-amber/20 hover:shadow-[0_10px_30px_-10px_rgba(255,180,84,0.55)]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </svg>
                歌曲库
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber px-1 font-mono text-[10px] text-ink-950">
                  {merged.length}
                </span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-8">
          {/* 步骤指示 */}
          <div className="mb-8 flex items-center justify-center gap-1.5 sm:gap-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5 sm:gap-2">
                <div
                  className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-[11px] transition-all duration-300 sm:text-xs ${
                    i === step
                      ? "border-amber/60 bg-amber/12 text-amber shadow-[0_0_24px_-6px_rgba(255,180,84,0.5)]"
                      : i < step
                        ? "border-teal/40 text-teal"
                        : "border-line text-faint"
                  }`}
                >
                  <span className={`grid h-4 w-4 place-items-center rounded-full border text-[9px] ${i === step ? "border-amber" : i < step ? "border-teal" : "border-line"}`}>
                    {i < step ? "✓" : i + 1}
                  </span>
                  {s}
                </div>
                {i < STEPS.length - 1 && <span className="h-px w-6 bg-line sm:w-10" />}
              </div>
            ))}
          </div>

          {step === 0 && (
            <StepUpload
              onFile={(f) => void runPipeline(f)}
              nativeLang={nativeLang}
              songLang={songLang}
              onNative={setNativeLang}
              onSong={setSongLang}
              auddToken={auddToken}
              onToken={(v) => {
                setAuddToken(v);
                if (v) showToast("token 已保存 · 听声识曲已开启");
              }}
            />
          )}

          {step === 1 && (
            <AutoProcess
              stage={stage}
              fileName={file?.name ?? ""}
              song={song ? { title: song.title, artist: song.artist } : null}
              failReason={failReason}
              recogNote={recogNote}
              lyricPreview={lyricPreview}
              onRetry={file ? () => void runPipeline(file) : undefined}
              onManual={(t, a) => void manualResolve(t, a)}
              onFallback={openFallback}
            />
          )}

          {step === 2 && clock && parsed && song && (
            <div className="animate-rise space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-2xl text-paper">
                    {song.title}
                    <span className="ml-3 text-base text-dim">{song.artist}</span>
                  </p>
                  {alignNote && (
                    <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-teal">
                      <span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulse-soft" />
                      {alignNote}
                    </p>
                  )}
                </div>
                <button
                  onClick={resetAll}
                  className="ml-auto rounded-md border border-line px-3.5 py-2 font-mono text-[11px] text-dim transition-colors hover:border-amber/50 hover:text-amber"
                >
                  ← 换一首
                </button>
              </div>

              <LearnStep
                clock={clock}
                parsed={parsed}
                song={song}
                mastered={mastered}
                pair={{ from: detectedLang, to: toCode, toLabel }}
                onToggle={(i) =>
                  setMastered((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
              />
            </div>
          )}
        </main>

        <footer className="border-t border-line-soft py-6">
          <p className="text-center font-mono text-[10px] tracking-wider text-faint">
            SongLearn · 曲库三层：共享（npoint + catbox 免费托管）· 内置（随仓库）· 本地（你的缓存）· 音频本地处理
          </p>
        </footer>
      </div>

      {/* 歌曲库抽屉 */}
      <SongLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        songs={merged}
        onOpen={(s) => void openLibrarySong(s)}
        onDelete={(s) => void deleteLibrarySong(s)}
        onExport={() => void handleExport()}
        onImport={(f) => void handleImport(f)}
        openingId={openingId}
        libId={libId}
        libError={libError}
        creatingLib={creatingLib}
        onCreateLib={() => void handleCreateLib()}
        onCopyLink={() => void handleCopyLink()}
        onRefreshLib={() => void refreshGlobal()}
      />
    </div>
  );
}

/* LRC 序列化（存档用） */
function exportLRC(
  title: string,
  artist: string,
  album: string | undefined,
  lines: { time: number; text: string; translation?: string }[]
): string {
  const stamp = (t: number) => {
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60);
    const cs = Math.round((t % 1) * 100);
    return `[${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
  };
  const head = [`[ti:${title}]`, `[ar:${artist}]`, album ? `[al:${album}]` : ""].filter(Boolean).join("\n");
  const body = lines
    .map((l) => `${stamp(l.time)}${l.text}${l.translation ? `\n${stamp(l.time)}「${l.translation}」` : ""}`)
    .join("\n");
  return `${head}\n${body}\n`;
}
