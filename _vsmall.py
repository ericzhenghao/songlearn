# -*- coding: utf-8 -*-
"""人声轨 138-176s 小窗逐段识别（干净人声 + 小窗 = 最佳组合）"""
import subprocess, wave, numpy as np
from faster_whisper import WhisperModel

FF = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\backend\.venv\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
SRC = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_sep\htdemucs\wakawaka\vocals.wav"
TMP = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_vw.wav"
model = WhisperModel(r"C:\Users\ericz\.cache\huggingface\hub\models--Systran--faster-whisper-small\snapshots\536b0662742c02347bc0e980a01041f333bce120", device="cpu", compute_type="int8")

out = []
t = 137.5
while t < 177.0:
    start, end = t, min(t + 4.5, 210.6)
    subprocess.run([FF, "-y", "-loglevel", "error", "-ss", str(start), "-to", str(end), "-i", SRC, "-ac", "1", "-ar", "16000", TMP], check=True)
    segs, info = model.transcribe(TMP, beam_size=5, vad_filter=True, condition_on_previous_text=False, word_timestamps=True)
    parts = []
    for seg in segs:
        ws = " | ".join("%s %.2f" % (w.word.strip(), start + w.start) for w in (seg.words or []))
        parts.append("[%.2f] %s" % (start + seg.start, seg.text.strip() + ("  <" + ws + ">" if ws else "")))
    joined = " / ".join(parts) if parts else "(无)"
    out.append("[%.1f-%.1f] %s" % (start, end, joined))
    t += 2.8

txt = "\n".join(out)
print(txt)
open(r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_vsmall_out.txt", "w", encoding="utf-8").write(txt)
