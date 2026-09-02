/**
 * 本地曲库（IndexedDB）：上传过的歌连同【音频 + 对齐好的歌词 + 进度】一起存档，
 * 关掉浏览器也在。这是曲库三层里的「本地缓存层」。
 */

export type SongRecord = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** 歌曲语言代码（en/es/zh…） */
  lang: string | null;
  fileName: string;
  mime: string;
  /** 音频文件本体（本地缓存才有；内置/云端条目为 null） */
  fileBlob: Blob | null;
  source: "upload" | "import";
  duration: number;
  /** 对齐后的完整 LRC 文本 */
  lrc: string;
  mastered: number[];
  addedAt: number;
  size: number;
};

const DB_NAME = "songlearn-db";
const STORE = "songs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => {
      /* 申请持久存储：浏览器空间紧张时也不清掉曲库（尽力而为，部署环境下通常获批） */
      try {
        void navigator.storage?.persist?.();
      } catch {
        /* 不支持也无妨 */
      }
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function putSong(rec: SongRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listSongs(): Promise<SongRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = (req.result as SongRecord[]).sort((a, b) => b.addedAt - a.addedAt);
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getSong(id: string): Promise<SongRecord | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as SongRecord) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function updateSong(id: string, patch: Partial<Pick<SongRecord, "mastered" | "lrc">>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const g = store.get(id);
    g.onsuccess = () => {
      const rec = g.result as SongRecord | undefined;
      if (!rec) return resolve();
      store.put({ ...rec, ...patch });
    };
    g.onerror = () => reject(g.error);
    store.transaction.oncomplete = () => resolve();
  });
}

export async function deleteSong(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function findByTitleArtist(title: string, artist: string): Promise<SongRecord | null> {
  const all = await listSongs();
  const t = title.trim().toLowerCase();
  const a = artist.trim().toLowerCase();
  return all.find((r) => r.title.trim().toLowerCase() === t && r.artist.trim().toLowerCase() === a) ?? null;
}
