/**
 * 统一时间源：歌词永远不自己计时，只订阅一个 Clock。
 * 无论底层是 <audio> 还是 <video>，同步逻辑完全一样。
 */
export interface Clock {
  readonly currentTime: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly rate: number;
  play(): Promise<void>;
  pause(): void;
  seek(t: number): void;
  setRate(r: number): void;
  onState(cb: () => void): () => void;
  destroy?(): void;
}

export class MediaFileClock implements Clock {
  playing = false;
  rate = 1;
  readonly isVideo: boolean;
  readonly media: HTMLMediaElement;
  private listeners = new Set<() => void>();
  private el: HTMLMediaElement;

  constructor(file: File) {
    const url = URL.createObjectURL(file);
    this.isVideo = file.type.startsWith("video");
    this.el = this.isVideo ? document.createElement("video") : document.createElement("audio");
    this.el.src = url;
    this.el.preload = "auto";
    if (this.isVideo) (this.el as HTMLVideoElement).playsInline = true;
    this.media = this.el;

    const notify = () => this.listeners.forEach((cb) => cb());
    (["play", "pause", "seeked", "durationchange", "ended", "ratechange"] as const).forEach((ev) =>
      this.el.addEventListener(ev, () => {
        this.playing = !this.el.paused;
        this.rate = this.el.playbackRate;
        notify();
      })
    );
  }

  get currentTime() {
    return this.el.currentTime;
  }
  get duration() {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }
  async play() {
    await this.el.play();
  }
  pause() {
    this.el.pause();
  }
  seek(t: number) {
    this.el.currentTime = Math.max(0, t);
  }
  setRate(r: number) {
    this.el.playbackRate = r;
  }
  onState(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  destroy() {
    const url = this.el.src;
    this.el.pause();
    /* 先让元素中止正在进行的取流，再回收 URL，避免控制台报 ERR_ABORTED */
    this.el.removeAttribute("src");
    try {
      this.el.load();
    } catch {
      /* 个别浏览器对空 src 调 load 会抛错，忽略 */
    }
    if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

/** 从 Blob/URL 构造一个可播放的 File 时钟（曲库里取出的歌用） */
export function clockFromBlob(blob: Blob, name: string, type: string): MediaFileClock {
  return new MediaFileClock(new File([blob], name, { type }));
}
