/**
 * 听声识曲（audD.io 音频指纹，类 QQ音乐「听歌识曲」）。
 * 不读文件名，只认内容：本地截取歌曲中段（大概率副歌）转 WAV 上传比对。
 */

export type RecogResult = {
  title: string;
  artist: string;
  album?: string;
  lyrics?: string | null;
  confidence: number;
  detail: string;
};

const AUDD_API = "https://api.audd.io/";

async function decodeToBuffer(file: File): Promise<AudioBuffer> {
  const buf = await file.arrayBuffer();
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(buf);
  } finally {
    void ctx.close();
  }
}

function sliceToWav(buffer: AudioBuffer, start: number, seconds: number): Blob {
  const sr = 16000;
  const startSample = Math.max(0, Math.floor(start * buffer.sampleRate));
  const len = Math.min(buffer.length - startSample, Math.floor(seconds * buffer.sampleRate));
  const ch = buffer.getChannelData(0);
  const mono = new Float32Array(len);
  const ratio = buffer.sampleRate / sr;
  for (let i = 0; i < len; i++) {
    mono[i] = ch[Math.min(ch.length - 1, startSample + Math.floor(i * ratio))];
  }
  const dataLen = mono.length * 2;
  const ab = new ArrayBuffer(44 + dataLen);
  const view = new DataView(ab);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([ab], { type: "audio/wav" });
}

async function postFingerprint(wav: Blob, token: string): Promise<RecogResult | null> {
  const form = new FormData();
  form.append("api_token", token);
  form.append("file", wav, "clip.wav");
  form.append("return", "apple_music,spotify,lyrics");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(AUDD_API, { method: "POST", body: form, signal: ctrl.signal });
    const data = await res.json();
    if (data?.status === "success" && data.result) {
      const r = data.result;
      return {
        title: r.title || "未知歌曲",
        artist: r.artist || "未知艺人",
        album: r.album || undefined,
        lyrics: r.lyrics || null,
        confidence: 0.95,
        detail: `音频指纹命中曲库：《${r.title}》— ${r.artist}`,
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 识别：先截 30% 处 18 秒（副歌），未命中再截开头 12 秒重试 */
export async function recognizeAudio(
  file: File,
  token: string,
  onProgress?: (s: string) => void
): Promise<RecogResult | null> {
  try {
    onProgress?.("通道A · 解码音频，提取声纹指纹…");
    const buffer = await decodeToBuffer(file);
    const dur = buffer.duration;

    onProgress?.("通道A · 截取副歌片段（30% 处 18 秒）比对曲库…");
    const start1 = Math.max(0, dur * 0.3);
    const wav1 = sliceToWav(buffer, start1, Math.min(18, Math.max(6, dur - start1)));
    const r1 = await postFingerprint(wav1, token);
    if (r1) return r1;

    if (dur > 14) {
      onProgress?.("通道A · 未命中，换开头 12 秒重试…");
      const wav2 = sliceToWav(buffer, 0, 12);
      const r2 = await postFingerprint(wav2, token);
      if (r2) return r2;
    }
    return null;
  } catch {
    return null;
  }
}

/** 校验 token 是否有效（不消耗识别额度） */
export async function probeAudDToken(token: string): Promise<boolean | null> {
  try {
    const form = new FormData();
    form.append("api_token", token);
    const res = await fetch(AUDD_API, { method: "POST", body: form });
    const data = await res.json();
    return data?.status !== "error";
  } catch {
    return null;
  }
}
