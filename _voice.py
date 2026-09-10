# -*- coding: utf-8 -*-
"""语音频带能量分析：ffmpeg bandpass(250-3000Hz) 后 RMS 包络，定位人声段。
输出 110-175s 精细包络（0.15s 窗）。"""
import subprocess, numpy as np, wave, json

FF = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\backend\.venv\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
SRC = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\public\songs\wakawaka.mp3"
WAV = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_voice.wav"
subprocess.run([FF, "-y", "-loglevel", "error", "-i", SRC, "-af", "highpass=f=250,lowpass=f=3000", "-ac", "1", "-ar", "16000", WAV], check=True)
with wave.open(WAV, "rb") as w:
    sr = w.getframerate()
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

win = int(0.15 * sr)
n = len(data) // win
rms = np.array([np.sqrt(np.mean(data[i*win:(i+1)*win]**2)) for i in range(n)])
t = np.arange(n) * 0.15
base = np.percentile(rms, 30)
thr = max(base * 2.5, 0.008)
print("背景 %.5f 阈值 %.5f" % (base, thr))

# 唱段边界（>thr，合并 <0.9s 间隙）
active = rms > thr
seg = []
s = None
for i, a in enumerate(active):
    if a and s is None:
        s = t[i]
    elif not a and s is not None:
        if t[i] - s >= 0.35:
            seg.append((s, t[i]))
        s = None
if s is not None:
    seg.append((s, t[-1]))
merged = []
for st, en in seg:
    if merged and st - merged[-1][1] < 0.9:
        merged[-1] = (merged[-1][0], en)
    else:
        merged.append((st, en))

out = ["## 全曲语音段（%d 段）" % len(merged)]
for st, en in merged:
    out.append("[%7.2f - %7.2f] %5.1fs" % (st, en, en - st))

out.append("## 110-175s 精细（0.15s 步进，#>阈值用#标记）")
for i in range(int(110/0.15), int(175/0.15), 2):
    r = rms[i]
    bar = "#" * int(r / thr * 40) if r > thr else "." * max(1, int(r / thr * 40))
    out.append("[%6.2f] %5.4f %s" % (t[i], r, bar))
txt = "\n".join(out)
print(txt)
open(r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_voice_out.txt", "w", encoding="utf-8").write(txt)
