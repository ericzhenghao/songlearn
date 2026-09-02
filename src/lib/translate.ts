/**
 * 逐句翻译（免费、免密钥）：主源 Google gtx，备源 MyMemory。带内存缓存。
 */

const cache = new Map<string, string>();

function timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

async function viaGoogle(text: string, from: string, to: string): Promise<string | null> {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t` +
    `&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { signal: timeoutSignal(6000) });
  if (!res.ok) throw new Error(`gtx ${res.status}`);
  const data = await res.json();
  const segs: string[] = [];
  if (Array.isArray(data?.[0])) {
    for (const seg of data[0]) {
      if (Array.isArray(seg) && typeof seg[0] === "string") segs.push(seg[0]);
    }
  }
  return segs.join("").trim() || null;
}

async function viaMyMemory(text: string, from: string, to: string): Promise<string | null> {
  const mmTo = to === "zh" ? "zh-CN" : to;
  const mmFrom = from === "zh" ? "zh-CN" : from;
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}` +
    `&langpair=${encodeURIComponent(`${mmFrom}|${mmTo}`)}`;
  const res = await fetch(url, { signal: timeoutSignal(6000) });
  if (!res.ok) throw new Error(`mymemory ${res.status}`);
  const d = await res.json();
  const t = d?.responseData?.translatedText;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

export async function translate(text: string, from: string | null, to: string): Promise<string | null> {
  if (!text.trim() || !from || from === to) return null;
  const key = `${from}|${to}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit || null;

  let out: string | null = null;
  try {
    out = await viaGoogle(text, from, to);
  } catch {
    /* 主源失败走备源 */
  }
  if (!out) {
    try {
      out = await viaMyMemory(text, from, to);
    } catch {
      out = null;
    }
  }
  cache.set(key, out || "");
  return out;
}
