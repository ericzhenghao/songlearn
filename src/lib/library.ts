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
};

export type LibrarySong = Omit<SongRecord, "source"> & {
  source: "bundled" | "cloud" | "local";
  audioInRepo?: string;
  audioUrl?: string;
  /** 共享曲库里的全局热度（学唱人次）与上传者 */
  plays?: number;
  by?: string;
};

/* ---------------- 内置曲库 ---------------- */

export function loadBundled(): LibrarySong[] {
  try {
    const arr = JSON.parse(seedRaw) as BundledEntry[];
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
      }));
  } catch {
    return [];
  }
}

/* ---------------- 三层合并去重 ---------------- */

const keyOf = (t: string, a: string) => `${t.trim().toLowerCase()}|${a.trim().toLowerCase()}`;

/** 合并三层曲库：本地优先（有音频），其次云端，最后内置 */
export function mergeLibrary(
  local: SongRecord[],
  cloud: LibrarySong[],
  bundled: LibrarySong[]
): LibrarySong[] {
  const map = new Map<string, LibrarySong>();
  /* 顺序：bundled → cloud → local，后写覆盖先写 = 本地优先 */
  for (const s of bundled) map.set(keyOf(s.title, s.artist), s);
  for (const s of cloud) map.set(keyOf(s.title, s.artist), s);
  for (const s of local) {
    const k = keyOf(s.title, s.artist);
    const prev = map.get(k);
    map.set(k, {
      ...s,
      source: "local",
      /* 本地记录没音频时，继承内置/云端的音频来源 */
      audioInRepo: prev?.audioInRepo,
      audioUrl: prev?.audioUrl ?? prev?.audioUrl,
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
