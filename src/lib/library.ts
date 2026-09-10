/**
 * 曲库数据层 —— 曲库是项目资产，不是一次性缓存：
 *
 * 三层来源（按优先级合并、按「歌名+歌手」去重）：
 *  1. bundled  内置曲库：src/data/library.json 随项目代码发布。
 *     下载项目、重新部署、分享链接，曲库都在；把导出的 JSON 写回这里并 commit，
 *     曲库就真正"长"进项目里。
 *  2. cloud    共享曲库：Supabase。任何人上传新歌自动回写，打开分享链接的人都能看到。
 *  3. local    本地缓存：访客自己浏览器里的 IndexedDB（含音频，秒开）。
 *
 * 音频文件不进 JSON（太大）：
 *  - audioInRepo：音频放在仓库 public/songs/ 下，随项目部署（推荐小文件）
 *  - audioUrl：云端存储桶地址（配置 Supabase 后自动可用）
 */
import seedRaw from "../data/library.json?raw";
import type { SongRecord } from "./songdb";

export type BundledEntry = {
  id?: string;
  title: string;
  artist: string;
  album?: string;
  lang?: string | null;
  duration?: number;
  lrc: string;
  mastered?: number[];
  addedAt?: number;
  /** 音频随仓库发布：public/songs/xxx.mp3 → 填 "songs/xxx.mp3" */
  audioInRepo?: string;
  /** 云端存储桶地址（导出时若已配置云端会自动填上） */
  audioUrl?: string;
  /** 时间轴校准版本：2 = 已按音频校准（打开时跳过自动对齐），缺省按 2 处理 */
  alignV?: number;
  /** 逐行中文翻译（与 lrc 歌词行一一对应，离线可用，不依赖在线翻译） */
  translations?: string[];
};

export type LibrarySong = Omit<SongRecord, "source"> & {
  source: "bundled" | "cloud" | "local";
  audioInRepo?: string;
  audioUrl?: string;
  /** 歌词全文的永久直链（云端条目正文存在这，打开时再拉） */
  lrcUrl?: string | null;
  /** 词级对齐 JSON 的永久直链（同 lrcUrl：索引只存引用） */
  timingsUrl?: string | null;
  /** 歌词行数（云端条目正文在直链上，用行数显示进度而不必拉全文） */
  lineCount?: number;
  /** 共享曲库里的全局热度（学唱人次）与上传者 */
  plays?: number;
  by?: string;
  /** 该歌在共享曲库里有条目（即使被本地/内置同名覆盖，计数仍算云端歌曲） */
  cloudSource?: boolean;
  /** 逐行中文翻译（内置校准版预置，随歌词合并一起保留） */
  translations?: string[];
};

/* ---------------- 内置曲库 ---------------- */

export function loadBundled(): LibrarySong[] {
  try {
    const raw = JSON.parse(seedRaw) as BundledEntry[] | { songs?: BundledEntry[] };
    /* 兼容两种格式：纯数组，或「导出曲库」生成的 {app, version, songs} 包装 */
    const arr = Array.isArray(raw) ? raw : raw?.songs;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && typeof e.title === "string" && typeof e.lrc === "string")
      .map((e, i) => ({
        id: e.id || `bundled-${i}-${e.title}`.toLowerCase().replace(/\s+/g, "-"),
        title: e.title,
        artist: e.artist || "未知艺人",
        album: e.album,
        lang: e.lang ?? null,
        fileName: e.audioInRepo ? e.audioInRepo.split("/").pop() || `${e.title}.mp3` : `${e.title}.mp3`,
        mime: "audio/mpeg",
        fileBlob: null,
        source: "bundled" as const,
        duration: e.duration ?? 0,
        lrc: e.lrc,
        mastered: e.mastered ?? [],
        addedAt: e.addedAt ?? 0,
        size: 0,
        audioInRepo: e.audioInRepo,
        audioUrl: e.audioUrl,
        alignV: e.alignV ?? 2,
        translations: e.translations,
      }));
  } catch {
    return [];
  }
}

/* ---------------- 三层合并去重 ---------------- */

const keyOf = (t: string, a: string) => `${t.trim().toLowerCase()}|${a.trim().toLowerCase()}`;

/* 宽松标题：去括号/去标点，用于识别「同一首歌的版本变体」。
   例：《Waka Waka (This Time for Africa)…》≈《Waka Waka (Esto es África)》——
   都是 Shakira 的同名歌，音频同一版本，歌词应以内置人工校准版为准。 */
/* 宽松标题：去括号/去标点，用于识别「同一首歌的版本变体」。
   例：《Waka Waka (This Time for Africa)…》≈《Waka Waka (Esto es África)》——
   都是 Shakira 的同名歌，音频同一版本，歌词应以内置人工校准版为准。
   按括号配对整段去除（方括号先吃，避免内部圆括号残留）。 */
const normTitle = (t: string) =>
  (t || "")
    .toLowerCase()
    .replace(/\[[^\]\[]*\]/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const keyLoose = (t: string, a: string) => `${normTitle(t)}|${(a || "").trim().toLowerCase()}`;

/** 合并三层曲库：本地优先（有音频），其次云端，最后内置 */
export function mergeLibrary(
  local: SongRecord[],
  cloud: LibrarySong[],
  bundled: LibrarySong[]
): LibrarySong[] {
  const map = new Map<string, LibrarySong>();
  /* 内置校准版的宽松索引：云端/本地版本变体（标题不同）也能命中 */
  const loose = new Map<string, LibrarySong>();
  /* 顺序：bundled → cloud → local，后写覆盖先写 = 本地优先 */
  for (const s of bundled) {
    const k = keyOf(s.title, s.artist);
    map.set(k, s);
    const lk = keyLoose(s.title, s.artist);
    if (!loose.has(lk)) loose.set(lk, s);
  }
  /* 精确命中内置 → 直接返回；否则宽松命中内置校准版（同歌手+去括号同名） */
  const matchCalibrated = (t: string, a: string): LibrarySong | undefined => {
    const exact = map.get(keyOf(t, a));
    if (exact?.alignV === 2) return exact;
    return loose.get(keyLoose(t, a));
  };
  for (const s of cloud) {
    const k = keyOf(s.title, s.artist);
    const prev = map.get(k);
    if (prev?.alignV === 2) {
      /* 同名内置版已人工校准：云端条目保留展示（热度/上传者/云直链），
         歌词/音频沿用内置校准版，避免云端旧自动对齐版覆盖准的 */
      map.set(k, {
        ...s,
        lrc: prev.lrc,
        alignV: 2,
        lang: prev.lang ?? s.lang,
        cloudSource: true,
        audioInRepo: prev.audioInRepo ?? s.audioInRepo,
        audioUrl: prev.audioUrl ?? s.audioUrl,
        translations: prev.translations,
      });
      continue;
    }
    const b = matchCalibrated(s.title, s.artist);
    if (b?.alignV === 2) {
      /* 标题版本变体（如中英文副标题不同）命中内置校准版：同样合并 */
      map.set(k, {
        ...s,
        lrc: b.lrc,
        alignV: 2,
        lang: b.lang ?? s.lang,
        cloudSource: true,
        audioInRepo: b.audioInRepo ?? s.audioInRepo,
        audioUrl: b.audioUrl ?? s.audioUrl,
        translations: b.translations,
      });
    } else {
      map.set(k, { ...s, cloudSource: true });
    }
  }
  for (const s of local) {
    const k = keyOf(s.title, s.artist);
    /* 精确匹配优先；本地旧版标题（如英文副标题变体）宽松命中内置/云端校准版 */
    const prev = map.get(k) ?? matchCalibrated(s.title, s.artist);
    /* 内置版时间轴已人工校准（alignV=2）。本地记录若没有独立音频（只是打开过内置歌的
       进度缓存），一律沿用内置校准歌词——旧的自动对齐缓存（alignV=2 但歌词错位）不得
       覆盖内置版，这是用户反馈"对不齐"反复出现的根因。本地有自己上传的音频/直链则用本地 */
    /* 内置/云端已有同首歌且时间轴已校准（alignV=2）→ 永远用校准版歌词。
       本地后端自动对齐结果反复被证实错位（第11句起"乱七八糟"），且同名同歌手
       基本就是同一首歌版本；本地记录只保留音频（fileBlob）、掌握进度等。
       用户上传的全新歌（prev 不存在）走本地自己对齐的歌词。 */
    const keepCalibrated = prev?.alignV === 2;
    /* 并入校准版的条目，key 也统一到校准版标题下，避免旧变体标题重复占一行 */
    const targetKey = keepCalibrated && prev ? keyOf(prev.title, prev.artist) : k;
    map.set(targetKey, {
      ...s,
      /* 版本变体合并到校准版后，标题/歌手统一用校准版（如西语名），
         避免旧英文副标题条目继续占位显示 */
      title: keepCalibrated ? prev?.title ?? s.title : s.title,
      artist: keepCalibrated ? prev?.artist ?? s.artist : s.artist,
      lang: keepCalibrated ? prev?.lang ?? s.lang : s.lang,
      source: "local",
      lrc: keepCalibrated ? prev.lrc : s.lrc || prev?.lrc || "",
      alignV: keepCalibrated ? 2 : s.alignV ?? prev?.alignV,
      /* 云端热度/上传者随同名歌一起继承 */
      plays: prev?.plays ?? s.plays,
      by: prev?.by ?? s.by,
      cloudSource: prev?.cloudSource ?? s.cloudSource,
      /* 本地记录没音频时，继承内置/云端的音频来源 */
      audioInRepo: prev?.audioInRepo,
      audioUrl: s.audioUrl ?? prev?.audioUrl,
      /* 预置翻译随校准版歌词一起保留 */
      translations: keepCalibrated ? prev?.translations : s.translations ?? prev?.translations,
    });
  }
  return [...map.values()].sort((a, b) => b.addedAt - a.addedAt);
}

/* ---------------- 导出 / 导入 ---------------- */

export type LibraryExport = {
  app: "songlearn-library";
  version: 1;
  exportedAt: string;
  songs: BundledEntry[];
};

/** 把整个曲库导出成 JSON（元数据+歌词+进度；音频走 audioInRepo/audioUrl 引用） */
export function exportLibrary(songs: LibrarySong[]): string {
  const payload: LibraryExport = {
    app: "songlearn-library",
    version: 1,
    exportedAt: new Date().toISOString(),
    songs: songs.map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      lang: s.lang,
      duration: s.duration,
      lrc: s.lrc,
      mastered: s.mastered,
      addedAt: s.addedAt,
      audioInRepo: s.audioInRepo,
      audioUrl: s.audioUrl,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/** 导入曲库 JSON（兼容 {songs:[...]} 或纯数组），返回可入库的记录 */
export function parseImport(text: string): BundledEntry[] {
  const data = JSON.parse(text) as LibraryExport | BundledEntry[];
  const arr = Array.isArray(data) ? data : data.songs;
  if (!Array.isArray(arr)) throw new Error("格式不对：需要歌曲数组");
  const ok = arr.filter((e) => e && typeof e.title === "string" && typeof e.lrc === "string");
  if (ok.length === 0) throw new Error("文件里没有有效的歌曲条目");
  return ok;
}

/** 把导入的条目转成本地记录（音频待上传/待云端） */
export function entriesToRecords(entries: BundledEntry[]): SongRecord[] {
  return entries.map((e, i) => ({
    id: e.id || `imported-${Date.now()}-${i}`,
    title: e.title,
    artist: e.artist || "未知艺人",
    album: e.album,
    lang: e.lang ?? null,
    fileName: e.audioInRepo ? e.audioInRepo.split("/").pop() || `${e.title}.mp3` : `${e.title}.mp3`,
    mime: "audio/mpeg",
    fileBlob: null,
    source: "upload" as const,
    duration: e.duration ?? 0,
    lrc: e.lrc,
    mastered: e.mastered ?? [],
    addedAt: e.addedAt ?? Date.now(),
    size: 0,
  }));
}
