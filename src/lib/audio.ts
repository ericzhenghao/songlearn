/**
 * 音频解码：把用户上传的音频/视频文件解成 AudioBuffer，
 * 供声纹分析、乐句起点检测（自动对齐）使用。
 */

/** 解码任意音频/视频文件为 AudioBuffer */
export async function decodeAudio(file: File): Promise<AudioBuffer> {
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
