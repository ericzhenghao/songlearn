/**
 * 本地对齐后端（backend/start.cmd）的前端接入层。
 *
 * 后端是「可选增强」：探不到就退回浏览器端启发式对齐，应用照常工作、不报错。
 * 探测必须校验 magic 字段 —— 静态托管（Vercel 等）的 SPA rewrite 会把任意路径
 * 都返回 index.html，只看 HTTP 200 会误判成「后端存在」。
 */

import type { Timings } from "./lrc";   // 词级数据结构定义在 lrc.ts，这里只负责传输

export type AlignBackend = {
  base: string;              // "" = 同源（vite 代理），否则是 http://127.0.0.1:8787 之类
  version: string;
  models: string[];
  ffmpeg: string;
};

export type AlignJob = {
  status: "queued" | "running" | "done" | "error";
  stage: string;
  progress: number;
  result?: Timings;
  error?: string | null;
  cached?: boolean;
};

export type AlignRequest = {
  lines?: { time: number; text: string }[];
  lrc?: string;
  duration?: number;
  model?: string;            // tiny | base | small，默认 base
  lang?: string | null;      // 强制首趟识别语种（用户声明的演唱语言）
  escalate?: boolean;        // matchRatio 过低时自动换 small 重跑，默认 true
};

const MAGIC = "songlearn-align";
const DEFAULT_BASE = "http://127.0.0.1:8787";

let cached: AlignBackend | null = null;
let probing: Promise<AlignBackend | null> | null = null;

function candidates(): string[] {
  const out: string[] = [];
  const override = typeof localStorage !== "undefined" ? localStorage.getItem("sl-backend") : null;
  if (override) out.push(override.replace(/\/+$/, ""));
  out.push("");                                   // 同源：dev 下走 vite 代理
  if (typeof location === "undefined" || location.origin !== DEFAULT_BASE) out.push(DEFAULT_BASE);
  return out;
}

async function probeOne(base: string): Promise<AlignBackend | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") || "").includes("application/json")) return null;
    const d = (await res.json()) as { ok?: boolean; magic?: string; version?: string; models?: string[]; ffmpeg?: string };
    if (!d?.ok || d.magic !== MAGIC) return null;
    return { base, version: d.version ?? "", models: d.models ?? [], ffmpeg: d.ffmpeg ?? "" };
  } catch {
    return null;                                  // 后端没起 / 网络受限：静默退回启发式
  } finally {
    clearTimeout(timer);
  }
}

/** 探测后端（结果记在内存，force=true 可重探，比如用户刚点了「重试连接后端」） */
export function probeBackend(force = false): Promise<AlignBackend | null> {
  if (!force && probing) return probing;
  if (!force && cached) return Promise.resolve(cached);
  probing = (async () => {
    for (const base of candidates()) {
      const b = await probeOne(base);
      if (b) {
        cached = b;
        probing = null;
        return b;
      }
    }
    cached = null;
    probing = null;
    return null;
  })();
  return probing;
}

/** meta 走请求头（base64url JSON）：歌词可能几 KB，塞 query 有长度风险 */
function encodeMeta(meta: AlignRequest): string {
  const bytes = new TextEncoder().encode(JSON.stringify(meta));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function startAlignJob(b: AlignBackend, audio: Blob, meta: AlignRequest): Promise<string | null> {
  return jsonRequest<{ jobId?: string }>(`${b.base}/api/wordalign`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Songlearn-Meta": encodeMeta(meta) },
    body: audio,
  }).then((r) => r?.jobId ?? null);
}

export function fetchJob(b: AlignBackend, jobId: string): Promise<AlignJob | null> {
  return jsonRequest<AlignJob>(`${b.base}/api/job/${encodeURIComponent(jobId)}`, { method: "GET" });
}

/** 起 job + 轮询到结束。失败/超时返回 null（调用方继续用启发式时间轴，不影响学唱） */
export async function wordAlign(
  b: AlignBackend,
  audio: Blob,
  meta: AlignRequest,
  onProgress?: (stage: string, progress: number) => void,
  timeoutMs = 15 * 60_000
): Promise<Timings | null> {
  const jobId = await startAlignJob(b, audio, meta);
  if (!jobId) return null;
  const deadline = Date.now() + timeoutMs;
  let misses = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const job = await fetchJob(b, jobId);
    if (!job) {
      if (++misses >= 5) return null;              // 后端中途挂了：别无限轮询
      continue;
    }
    misses = 0;
    onProgress?.(job.stage, job.progress);
    if (job.status === "done") return job.result ?? null;
    if (job.status === "error") return null;
  }
  return null;
}
