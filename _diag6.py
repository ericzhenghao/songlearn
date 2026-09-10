# -*- coding: utf-8 -*-
"""切小窗逐段识别：131-150s，窗口2.8s步进1.4s，small模型，语言自动"""
import subprocess, os, json
from faster_whisper import WhisperModel

FF = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\backend\.venv\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
SRC = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\public\songs\wakawaka.mp3"
TMP = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_seg.wav"
model = WhisperModel(r"C:\Users\ericz\.cache\huggingface\hub\models--Systran--faster-whisper-small\snapshots\536b0662742c02347bc0e980a01041f333bce120", device="cpu", compute_type="int8")

out = []
t = 130.5
while t < 151.0:
    start, end = t, min(t + 2.8, 210.6)
    subprocess.run([FF, "-y", "-loglevel", "error", "-ss", str(start), "-to", str(end), "-i", SRC, "-ac", "1", "-ar", "16000", TMP], check=True)
    segs, info = model.transcribe(TMP, beam_size=5, vad_filter=True, condition_on_previous_text=False)
    texts = [s.text.strip() for s in segs if s.text and s.text.strip()]
    lang = info.language
    joined = " / ".join(texts) if texts else "(无唱词/纯音乐)"
    out.append(f"[{start:.1f}-{end:.1f}] lang={lang} {joined}")
    t += 1.4

with open(r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_diag6_out.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print("\n".join(out))
