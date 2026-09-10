# -*- coding: utf-8 -*-
"""Waka Waka 全曲能量包络 + 唱段边界检测
- 转 16k 单声道 wav
- 50ms RMS 包络
- 相对能量阈值找"唱段"（人声活跃）区间，输出 125-210s 的唱段起止
- 同时输出全曲每 10s 的唱段分布，供对照 LRC"""
import subprocess, numpy as np

FF = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\backend\.venv\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
SRC = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\public\songs\wakawaka.mp3"
WAV = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_energy.wav"

subprocess.run([FF, "-y", "-loglevel", "error", "-i", SRC, "-ac", "1", "-ar", "16000", WAV], check=True)
import wave
with wave.open(WAV, "rb") as w:
    sr = w.getframerate()
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
dur = len(data) / sr
print("总时长 %.1fs" % dur)

win = int(0.05 * sr)
n = len(data) // win
rms = np.array([np.sqrt(np.mean(data[i*win:(i+1)*win]**2)) for i in range(n)])
t = np.arange(n) * 0.05

# 全局背景（取能量中位数）与阈值
base = np.percentile(rms, 40)
thr = max(base * 2.2, 0.02)
print("背景 %.4f 阈值 %.4f" % (base, thr))

# 唱段：连续 rms>thr 的区间（>0.4s 才算），合并间隔<0.5s
active = rms > thr
seg = []
s = None
for i, a in enumerate(active):
    if a and s is None:
        s = t[i]
    elif not a and s is not None:
        if t[i] - s >= 0.4:
            seg.append((s, t[i]))
        s = None
if s is not None:
    seg.append((s, t[-1]))
merged = []
for st, en in seg:
    if merged and st - merged[-1][1] < 0.5:
        merged[-1] = (merged[-1][0], en)
    else:
        merged.append((st, en))

print("== 活跃段（人声/乐器密集）==")
for st, en in merged:
    print("[%7.2f - %7.2f] %5.1fs" % (st, en, en - st))

# 聚焦 125-160s 细看
print("== 125-160s 每 0.25s RMS ==")
row = []
for i in range(int(125/0.05), int(160/0.05), 5):
    r = rms[i]
    bar = "#" * int(r / thr * 30)
    row.append("[%6.2f] %5.3f %s" % (t[i], r, bar))
print("\n".join(row))
