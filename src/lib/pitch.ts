/**
 * 音高检测与旋律采集（纯前端，Web Audio API）
 * - detectPitchMono: ACF2 时域自相关 F0 检测（人声范围 70–1000Hz）
 * - MelodyTracker: 从媒体元素/麦克风持续采样旋律点 [t, f]
 * - collectRefLine: 播放原唱区间并采集「原唱旋律」参考线（跟唱对比用）
 */

export interface PitchPoint {
  t: number; // 相对采集起点的秒
  f: number; // 频率 Hz（0 表示无声/清音，由调用方过滤）
}

/** 频率 → MIDI 半音（69 = A4 440Hz） */
export function hzToMidi(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}

/** 自相关法 F0 检测：返回 Hz，无稳定音高返回 null */
export function detectPitchMono(buf: Float32Array, sampleRate: number): number | null {
  const n = buf.length;
  if (n < 256) return null;

  /* 简单能量门限：静音直接判无音高 */
  let energy = 0;
  for (let i = 0; i < n; i++) energy += buf[i] * buf[i];
  const rms = Math.sqrt(energy / n);
  if (rms < 0.008) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / 1000)); // 最高 1000Hz
  const maxLag = Math.min(n, Math.floor(sampleRate / 65)); // 最低 65Hz
  if (maxLag <= minLag) return null;

  let bestLag = -1;
  let bestScore = 0;
  /* ACF2：两段互相关归一化，抗基频抖动 */
  for (let lag = minLag; lag < maxLag; lag++) {
    let num = 0, den1 = 0, den2 = 0;
    for (let i = 0; i + lag < n; i += 2) {
      num += buf[i] * buf[i + lag];
      den1 += buf[i] * buf[i];
      den2 += buf[i + lag] * buf[i + lag];
    }
    const den = Math.sqrt(den1 * den2);
    if (den < 1e-6) continue;
    const r = num / den;
    if (r > bestScore) {
      bestScore = r;
      bestLag = lag;
    }
  }
  if (bestLag <= 0 || bestScore < 0.72) return null;

  /* 抛物线插值提精度 */
  let fine = bestLag;
  if (bestLag > minLag && bestLag < maxLag - 1) {
    const r0 = corrAt(buf, bestLag - 1, n);
    const r1 = corrAt(buf, bestLag, n);
    const r2 = corrAt(buf, bestLag + 1, n);
    const denom = r0 - 2 * r1 + r2;
    if (Math.abs(denom) > 1e-9) {
      const delta = 0.5 * (r0 - r2) / denom;
      if (delta > -1 && delta < 1) fine = bestLag + delta;
    }
  }
  const f = sampleRate / fine;
  return f > 55 && f < 1100 ? f : null;
}

function corrAt(buf: Float32Array, lag: number, n: number): number {
  let num = 0, d1 = 0, d2 = 0;
  for (let i = 0; i + lag < n; i++) {
    num += buf[i] * buf[i + lag];
    d1 += buf[i] * buf[i];
    d2 += buf[i + lag] * buf[i + lag];
  }
  const den = Math.sqrt(d1 * d2);
  return den < 1e-6 ? 0 : num / den;
}

/** 持续旋律采样器：连接一个音频源（媒体元素或麦克风），按 intervalMs 采样 F0。
 *  内置 5 帧中值滤波：音乐伴奏/环境噪声会让单帧 ACF 结果跳变半音级，
 *  直接画线就是锯齿尖角。中值滤波后输出稳定主音高，曲线才丝滑。 */
export class MelodyTracker {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null = null;
  private raf = 0;
  private buf: Float32Array = new Float32Array(2048);
  startedAt = 0;
  onPitch: ((t: number, f: number | null) => void) | null = null;
  private intervalMs: number;
  /** 采集窗口（相对媒体时间的绝对区间）；为 null 不过滤 */
  private winT0: number | null = null;
  private winT1: number | null = null;
  /** 已挂载过的媒体元素（同一元素只能 createMediaElementSource 一次） */
  private attachedMedia: HTMLMediaElement | null = null;
  /** 中值滤波窗口（保留最近 N 个有效频率） */
  private hist: number[] = [];
  /** 最近一次输出的音高（半音差钳制用） */
  private lastOut: number | null = null;
  /** 跳变确认缓存：连续两帧落在同一新音高才接受跳变 */
  private jumpPending: number | null = null;

  constructor(intervalMs = 60) {
    this.intervalMs = intervalMs;
  }

  private static median(arr: number[]): number {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /** 设置采集窗口：只输出落在 [t0,t1] 内的音高点（媒体绝对时间） */
  setWindow(t0: number, t1: number) {
    this.winT0 = t0;
    this.winT1 = t1;
  }

  /** 清除窗口（不过滤） */
  clearWindow() {
    this.winT0 = null;
    this.winT1 = null;
  }

  /** 连接源并开始采样；source 可为媒体元素或麦克风流（同一媒体元素只挂一次） */
  start(source: HTMLMediaElement | MediaStream) {
    if (source instanceof HTMLMediaElement && this.attachedMedia === source) {
      /* 已挂载过：只恢复采样，不重建 AudioContext（重建会因元素被占用而抛错） */
      this.resume();
      return;
    }
    this.stop();
    try {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.buf = new Float32Array(this.analyser.fftSize);
      if (source instanceof MediaStream) {
        this.source = this.ctx.createMediaStreamSource(source);
      } else {
        this.source = this.ctx.createMediaElementSource(source);
        this.attachedMedia = source;
      }
      this.source.connect(this.analyser);
      /* 媒体源必须再连回 destination 才能听到声音；麦克风不需要 */
      if (!(source instanceof MediaStream)) this.analyser.connect(this.ctx.destination);
      /* 自动播放策略：手势后创建的 context 可能仍 suspended，显式唤醒 */
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
      this.startedAt = performance.now() / 1000;
      this.loop();
    } catch {
      /* AudioContext 受限或设备不可用时静默降级 */
      this.ctx = null;
    }
  }

  private loop = () => {
    if (!this.analyser || !this.onPitch) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const f0 = detectPitchMono(this.buf, this.analyser.context.sampleRate);
    /* 中值滤波 + 稳定性门限：至少 3 帧有效才输出，单帧误检被过滤 */
    let f: number | null = null;
    if (f0) {
      this.hist.push(f0);
      if (this.hist.length > 5) this.hist.shift();
      if (this.hist.length >= 3) {
        f = MelodyTracker.median(this.hist);
        /* 与上一次输出差 > 5 半音视为跳变（伴奏/换气），退回中值仍抖则保持 */
        if (this.lastOut != null && Math.abs(hzToMidi(f) - hzToMidi(this.lastOut)) > 5) {
          /* 只在连续两帧都跳到同一新音高时才接受（避免单次爆音） */
          if (!this.jumpPending) {
            this.jumpPending = f;
            f = this.lastOut;
          } else {
            f = Math.abs(hzToMidi(this.jumpPending) - hzToMidi(f)) < 1.5 ? f : this.lastOut;
            this.jumpPending = null;
          }
        } else {
          this.jumpPending = null;
        }
        this.lastOut = f;
      }
    } else {
      /* 无声/清音：清空历史，下一句开口重新建立 */
      this.hist.length = 0;
      this.lastOut = null;
      this.jumpPending = null;
    }
    /* 窗口过滤：媒体采集用绝对时间（media.currentTime 由调用方经 setWindow 传入区间） */
    let t = performance.now() / 1000 - this.startedAt;
    if (this.attachedMedia && (this.winT0 != null || this.winT1 != null)) {
      t = this.attachedMedia.currentTime;
    }
    if (this.winT0 != null && t < this.winT0 - 0.05) return;
    if (this.winT1 != null && t > this.winT1 + 0.05) return;
    try {
      this.onPitch(t, f);
    } catch {
      /* 忽略回调异常 */
    }
    this.raf = window.setTimeout(this.loop, this.intervalMs);
  };

  /** 暂停采样但保留连接 */
  pause() {
    window.clearTimeout(this.raf);
  }

  /** 恢复采样 */
  resume() {
    if (!this.analyser) return;
    this.loop();
  }

  /** 断开并释放所有资源 */
  stop() {
    window.clearTimeout(this.raf);
    this.raf = 0;
    this.hist.length = 0;
    this.lastOut = null;
    this.jumpPending = null;
    try {
      this.source?.disconnect();
    } catch { /* 忽略 */ }
    try {
      this.analyser?.disconnect();
    } catch { /* 忽略 */ }
    this.source = null;
    this.analyser = null;
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }
}

/**
 * 采集原唱一段区间的旋律参考线。
 * 播放区间 [t0, t1]（秒），每 intervalMs 采一个点；播放结束后把媒体还原。
 * 返回按时间升序的 [t 相对区间起点, f] 列表（f=0 的点保留，显示时跳过）。
 */
export async function collectRefLine(
  media: HTMLMediaElement,
  t0: number,
  t1: number,
  intervalMs = 90
): Promise<PitchPoint[]> {
  const tracker = new MelodyTracker(intervalMs);
  const pts: PitchPoint[] = [];
  const wasPlaying = !media.paused;
  const prevT = media.currentTime;

  return await new Promise<PitchPoint[]>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      tracker.stop();
      try {
        media.pause();
        media.currentTime = prevT;
      } catch { /* 忽略 */ }
      if (wasPlaying) void media.play().catch(() => undefined);
      resolve(pts);
    };

    /* 起点：media 当前时间基准（媒体已 seek 到 t0 由调用方保证） */
    const base = media.currentTime;
    tracker.onPitch = (dt, f) => {
      const t = media.currentTime;
      if (t < t0 - 0.05 || t > t1 + 0.05) return;
      pts.push({ t: t - t0, f: f ?? 0 });
    };
    tracker.start(media);

    const check = window.setInterval(() => {
      if (!media.paused && media.currentTime >= t1 - 0.03) finish();
    }, 120);
    /* 兜底超时（变速或 seek 干扰） */
    window.setTimeout(finish, (t1 - t0 + 1.5) * 1000 + 4000);

    /* 若媒体未在播放（调用方已 play），轮询检测播放 */
    const startedAt = Date.now();
    const poll = window.setInterval(() => {
      if (media.currentTime >= t1 - 0.03 || Date.now() - startedAt > 3000) {
        window.clearInterval(poll);
        finish();
      }
    }, 150);
    void (() => {
      const holder = check;
      void holder;
    })();
  });
}
