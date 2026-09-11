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

async function postFingerprint(
  wav: Blob,
  token: string,
  onProgress?: (s: string) => void
): Promise<RecogResult | null> {
  const form = new FormData();
  form.append("api_token", token);
  form.append("file", wav, "clip.wav");
  form.append("return", "apple_music,spotify,lyrics");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(AUDD_API, { method: "POST", body: form, signal: ctrl.signal });
    if (!res.ok) {
      onProgress?.(`audD 服务异常：HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (data?.status === "error") {
      /* audD 明确报错：token 无效 / 额度用完 / 音频有问题，透出真实原因 */
      const msg: string = data.error?.error_message || data.error?.message || "未知错误";
      const code = data.error?.error_code ?? data.error?.code;
      const codeStr = code != null ? `（code ${code}）` : "";
      const hint =
        code === 902
          ? " —— 免费额度已用完：明天自动恢复，或到 audd.io 付费扩容"
          : code === 900
            ? " —— token 无效或试用期已结束：登录 dashboard.audd.io 查看账号状态，或用新邮箱重新注册拿一枚新 token"
            : "";
      onProgress?.(`audD 报错：${msg}${codeStr}${hint}`);
      return null;
    }
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
    /* success 但 result 为空：token 有效，纯粹曲库里没有这段音频 */
    onProgress?.("audD 比对完成：token 正常，指纹库里没有命中这首歌（现场版/翻唱版常查不到）");
    return null;
  } catch {
    onProgress?.("连不上 audD 服务（网络受限或超时）");
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
    const r1 = await postFingerprint(wav1, token, onProgress);
    if (r1) return r1;

    if (dur > 14) {
      onProgress?.("通道A · 未命中，换开头 12 秒重试…");
      const wav2 = sliceToWav(buffer, 0, 12);
      const r2 = await postFingerprint(wav2, token, onProgress);
      if (r2) return r2;
    }
    return null;
  } catch {
    onProgress?.("音频解码失败，无法提取声纹");
    return null;
  }
}

/** 3 秒低幅白噪声 WAV（探测 token 用）：audD 要求 2~12 秒且非静音，纯静音/过短会报 code 300「无法建指纹」 */
function probeWav(): Blob {
  const sr = 16000;
  const seconds = 3;
  const dataLen = sr * seconds * 2;
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
  /* 低幅伪随机噪声（±800/32767，约 -52dB）：足以建指纹，人耳几乎听不见 */
  let seed = 42;
  for (let i = 0; i < sr * seconds; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    view.setInt16(44 + i * 2, (seed % 1601) - 800, true);
  }
  return new Blob([ab], { type: "audio/wav" });
}

/** 校验 token：发一段 3 秒低幅噪声（探测不消耗识别命中），无效 token audD 直接报错，有效则返回 success */
export async function validateAudDToken(token: string): Promise<{ ok: boolean; message: string }> {
  try {
    const form = new FormData();
    form.append("api_token", token);
    form.append("file", probeWav(), "probe.wav");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(AUDD_API, { method: "POST", body: form, signal: ctrl.signal }).finally(() =>
      clearTimeout(timer)
    );
    const data = await res.json();
    if (data?.status === "success") return { ok: true, message: "token 有效" };
    const msg: string = data?.error?.error_message || data?.error?.message || "被 audD 拒绝";
    const code = data?.error?.error_code ?? data?.error?.code;
    const codeStr = code != null ? `（code ${code}）` : "";
    if (code === 902)
      return {
        ok: false,
        message: `token 有效，但今日免费额度已用完${codeStr}——明天自动恢复，或到 audd.io 付费扩容`,
      };
    if (code === 900)
      return {
        ok: false,
        message: `token 无效或试用期已结束${codeStr}——登录 dashboard.audd.io 查看账号，或用新邮箱重新注册拿新 token`,
      };
    return { ok: false, message: `audD：${msg}${codeStr}` };
  } catch {
    return { ok: false, message: "连不上 audD（网络受限），token 未验证" };
  }
}
