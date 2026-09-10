# -*- coding: utf-8 -*-
"""small 模型对 118-180s 精确词级诊断（祖鲁段 + 副歌3）"""
import json, sys
from faster_whisper import WhisperModel

model = WhisperModel(r"C:\Users\ericz\.cache\huggingface\hub\models--Systran--faster-whisper-small\snapshots\536b0662742c02347bc0e980a01041f333bce120", device="cpu", compute_type="int8")

AUDIO = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\public\songs\wakawaka.mp3"
segments, info = model.transcribe(
    AUDIO, language="es", beam_size=5,
    vad_filter=True,
    word_timestamps=True,
    initial_prompt="",
    condition_on_previous_text=False,
)
out = []
for seg in segments:
    if seg.end < 112 or seg.start > 184:
        continue
    ws = []
    for w in (seg.words or []):
        if w.end < 112 or w.start > 184:
            continue
        ws.append(f"{w.word} {w.start:.2f}-{w.end:.2f}")
    out.append(f"[{seg.start:.2f}-{seg.end:.2f}] {seg.text}")
    out.append("    " + " | ".join(ws))
with open(r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_diag5_out.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print("done", len(out))
