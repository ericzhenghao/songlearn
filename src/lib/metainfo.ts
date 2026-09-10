/**
 * 本地歌曲识别（零 API、零 token）：
 * - 音频文件：解析文件内嵌 ID3v2/v1 标签（标题 TIT2、艺术家 TPE1）
 * - 任何文件：解析文件名（"歌手 - 歌名"、"歌名 - 歌手"、平台后缀等国内常见命名）
 * 识别结果返回候选列表，供上层逐个搜索歌词验证；全部失败才需要用户手动填写。
 */

export type RecogResult = {
  title: string;
  artist: string;
  album?: string;
  lyrics?: string | null;
  confidence: number;
  detail: string;
};

/* ---------- ID3v2 解析 ---------- */

const encoders: Record<number, string> = {
  0: "latin1",
  1: "utf-16", // BOM 自动
  2: "utf-16be",
  3: "utf-8",
};

function readSyncsafeInt(u8: Uint8Array, off: number): number {
  return ((u8[off] & 0x7f) << 21) | ((u8[off + 1] & 0x7f) << 14) | ((u8[off + 2] & 0x7f) << 7) | (u8[off + 3] & 0x7f);
}

function decodeText(bytes: Uint8Array, enc: number): string {
  const encName = encoders[enc] ?? "utf-8";
  try {
    if (enc === 1) {
      /* UTF-16 with BOM：去掉 BOM 交给 TextDecoder 处理 */
      return new TextDecoder("utf-16", { fatal: false }).decode(bytes);
    }
    return new TextDecoder(encName as Encoding, { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

/** 解析 ID3v2 帧区，返回 {title, artist, album} */
function parseId3v2(u8: Uint8Array): { title?: string; artist?: string; album?: string } {
  if (u8[0] !== 0x49 || u8[1] !== 0x44 || u8[2] !== 0x33) return {}; // "ID3"
  const ver = u8[3];
  const size = readSyncsafeInt(u8, 6);
  if (size <= 0 || size > u8.length - 10) return {};
  const framesEnd = Math.min(u8.length, 10 + size);
  const out: { title?: string; artist?: string; album?: string } = {};
  let p = 10;
  const grab = (id: string, next: () => void) => {
    if (p + 10 > framesEnd) return false;
    const fid = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    if (fid === "TXXX" || fid === "TCOM") {
      /* 跳过这些帧继续 */
    }
    if (fid === id) {
      let flen = 0;
      if (ver === 2) {
        flen = (u8[p + 3] << 16) | (u8[p + 4] << 8) | u8[p + 5];
        p += 6;
      } else if (ver === 3) {
        flen = (u8[p + 4] << 24) | (u8[p + 5] << 16) | (u8[p + 6] << 8) | u8[p + 7];
        p += 10;
      } else {
        flen = readSyncsafeInt(u8, p + 4);
        p += 10;
      }
      if (flen > 0 && p + flen <= framesEnd) {
        const body = u8.subarray(p, p + flen);
        const enc = body[0] ?? 3;
        let txt = decodeText(body.subarray(1), enc).replace(/\u0000+$/g, "").trim();
        /* UTF-16 的 BOM 由 TextDecoder 处理；去掉可能残留的 BOM 字符 */
        txt = txt.replace(/^\uFEFF/, "");
        if (txt) {
          if (id === "TIT2") out.title = txt;
          else if (id === "TPE1") out.artist = txt;
          else if (id === "TALB") out.album = txt;
        }
        return true;
      }
      return false;
    }
    next();
    return false;
  };
  while (p + 10 <= framesEnd) {
    const fid = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    if (fid === "\u0000\u0000\u0000\u0000" || fid === "APIC" || fid === "PRIV" || fid === "GEOB") break;
    if (ver === 2) {
      const id3 = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2]);
      const map2: Record<string, "TIT2" | "TPE1" | "TALB"> = { TT2: "TIT2", TP1: "TPE1", TAL: "TALB" };
      const m = map2[id3];
      if (m) {
        if (grab(m, () => {})) continue;
      }
      const flen = (u8[p + 3] << 16) | (u8[p + 4] << 8) | u8[p + 5];
      p += 6 + flen;
      continue;
    }
    if (fid === "TIT2" || fid === "TPE1" || fid === "TALB") {
      const done = grab(fid as "TIT2", () => {});
      if (done) continue;
      /* 帧异常：跳到下一个 */
      const flen = ver === 3 ? (u8[p + 4] << 24) | (u8[p + 5] << 16) | (u8[p + 6] << 8) | u8[p + 7] : readSyncsafeInt(u8, p + 4);
      p += 10 + flen;
      continue;
    }
    const flen = ver === 3 ? (u8[p + 4] << 24) | (u8[p + 5] << 16) | (u8[p + 6] << 8) | u8[p + 7] : readSyncsafeInt(u8, p + 4);
    p += 10 + flen;
  }
  return out;
}

/** 解析文件尾部 ID3v1（TAG + 30 字节标题 + 30 字节艺术家） */
function parseId3v1(u8: Uint8Array): { title?: string; artist?: string } {
  if (u8.length < 128) return {};
  const tag = String.fromCharCode(u8[u8.length - 128], u8[u8.length - 127], u8[u8.length - 126]);
  if (tag !== "TAG") return {};
  const s = (off: number) => {
    let end = off + 30;
    for (let i = off; i < off + 30; i++) {
      if (u8[i] === 0) {
        end = i;
        break;
      }
    }
    return new TextDecoder("latin1").decode(u8.subarray(off, end)).trim();
  };
  return { title: s(u8.length - 125) || undefined, artist: s(u8.length - 95) || undefined };
}

/** 从音频文件字节里读内嵌标签（先 ID3v2，再 v1 兜底） */
async function readId3(file: File): Promise<{ title?: string; artist?: string; album?: string }> {
  try {
    const head = await file.slice(0, Math.min(file.size, 10 + 4096)).arrayBuffer();
    const u8 = new Uint8Array(head);
    let out = parseId3v2(u8);
    if (!out.title && !out.artist) {
      const tail = await file.slice(Math.max(0, file.size - 128)).arrayBuffer();
      out = { ...parseId3v1(new Uint8Array(tail)), ...out };
    }
    return out;
  } catch {
    return {};
  }
}

/* ---------- 文件名解析 ---------- */

/** 常见平台/来源后缀杂质：出现在文件名末尾（"- 小红书"、"|抖音" 等） */
const PLATFORM_RE =
  /(?:\s*[|\-–—·]\s*)(?:小红书|抖音|快手|哔哩哔哩|b站|B站|网易云|网抑云|QQ音乐|qq音乐|酷狗|酷我|虾米|全民k歌|唱吧|微博|微信|今日头条|视频号|youtube|YouTube|yt|spotify|apple music|itunes|soundcloud)(?:\s*(?:音乐|热歌|神曲|推荐|热门|搬运|翻唱|cover|mv|MV|官方|现场|live|字幕|歌词|伴奏|原唱|高清|4k|8k|720p|1080p|60fps|remix|extended)?)*$/i;

/** 前缀杂质："日推｜"、"每日推荐"、"热歌榜"、"[4K]" 等 */
const PREFIX_RE =
  /^(?:日推|每日推荐|今日推荐|每日一歌|热歌|神曲|新歌|经典|循环|单曲|车载|洗脑|上头|治愈|伤感|抖音热歌|抖音神曲|网络热门|热门歌曲|超好听|好听|[^\u4e00-\u9fa5A-Za-z0-9]{0,12}[|｜\s\-–—·]+)(?:[|｜\s\-–—·]+)?/;

/** 去扩展名 */
function stripExt(name: string): string {
  return name.replace(/\.[a-zA-Z0-9]{1,5}$/, "").trim();
}

/** 归一化待解析串：去平台杂质、去括号注解、清理空白 */
function cleanName(name: string): string {
  let s = stripExt(name.trim());
  /* 去掉末尾平台杂质（可重复） */
  for (let i = 0; i < 3; i++) {
    const m = s.match(PLATFORM_RE);
    if (m) s = s.slice(0, m.index).trim();
    else break;
  }
  /* 去掉前缀杂质（"日推｜" 等） */
  const pm = s.match(PREFIX_RE);
  if (pm) s = s.slice(pm[0].length).trim();
  /* 去掉括号注解：歌名 (cover)、[4K] */
  s = s
    .replace(/[（(](?:cover|翻唱|现场|live|伴奏|纯音乐|官方|MV|mv|字幕|歌词|搬运|remix|extended)[）)]/gi, "")
    .replace(/\[[^\]]{0,20}\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s;
}

/** 从"歌手《歌名》"格式提取 */
function extractFromBookTitle(s: string): { title?: string; artist?: string } | null {
  const m = s.match(/^(.{1,40})[《「「]([^》」」]{1,80})[》」」]/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return null;
}

/**
 * 解析文件名，返回候选 [title, artist] 列表（从最可信到最次）。
 * 支持：歌手 - 歌名（国内主流）、歌名 - 歌手、歌手《歌名》、《歌名》歌手、纯歌名
 */
export function parseFilename(name: string): { title?: string; artist?: string }[] {
  let s = cleanName(name);
  if (!s) return [];

  /* 1) 歌手《歌名》 */
  const book = extractFromBookTitle(s);
  if (book) return [{ title: book.title!, artist: book.artist }];

  /* 2) " - " 分隔 */
  const sep = s.match(/\s+[-–—]\s+/);
  if (sep) {
    const a = s.slice(0, sep.index).trim();
    const b = s.slice(sep.index + sep[0].length).trim();
    if (a && b) {
      /* 国内主流：歌手 - 歌名。同时给换序候选，上层用歌词搜索验证取舍 */
      return [
        { title: b, artist: a },
        { title: a, artist: b },
      ];
    }
    return [{ title: a || b, artist: undefined }];
  }

  /* 3) "《》" 在中间/末尾 */
  const bm = s.match(/《([^》]{1,80})》/);
  if (bm) {
    const before = s.slice(0, bm.index).replace(/[|｜\s\-–—·]+$/g, "").trim();
    const after = s.slice(bm.index + bm[0].length).replace(/^[|｜\s\-–—·]+/g, "").trim();
    const artist = before || after || undefined;
    return [{ title: bm[1].trim(), artist }];
  }

  /* 4) 整串当歌名 */
  return [{ title: s, artist: undefined }];
}

/* ---------- 综合识别 ---------- */

/** 从上传文件识别歌曲：ID3 标签 → 文件名；返回候选列表 */
export async function identifyFromFile(file: File): Promise<{ candidates: { title: string; artist?: string }[]; detail: string }> {
  const isAudio = file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i.test(file.name);
  const id3 = isAudio ? await readId3(file) : {};
  const fromName = parseFilename(file.name);
  const seen = new Set<string>();
  const cands: { title: string; artist?: string }[] = [];
  const push = (t?: string, a?: string) => {
    if (!t || !t.trim()) return;
    const key = `${t.trim().toLowerCase()}|${(a || "").trim().toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    cands.push({ title: t.trim(), artist: a?.trim() || undefined });
  };

  /* 优先级：ID3 标签最可信 */
  push(id3.title, id3.artist);
  /* 文件名 */
  for (const c of fromName) push(c.title, c.artist);

  const srcs: string[] = [];
  if (id3.title) srcs.push("文件内嵌标签");
  if (fromName.length && (id3.title ? false : true)) srcs.push("文件名");
  const detail = cands.length
    ? `本地识别命中：${srcs.join(" + ") || "文件名"} → 《${cands[0].title}》${cands[0].artist ? ` — ${cands[0].artist}` : ""}`
    : "本地没识别出歌名（文件名/标签都没有线索）";

  return { candidates: cands, detail };
}
