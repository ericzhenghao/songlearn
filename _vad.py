# -*- coding: utf-8 -*-
"""small 全曲 VAD 段边界检测（不强制语言、无上下文），输出 100-210s 所有人声段"""
from faster_whisper import WhisperModel

model = WhisperModel(r"C:\Users\ericz\.cache\huggingface\hub\models--Systran--faster-whisper-small\snapshots\536b0662742c02347bc0e980a01041f333bce120", device="cpu", compute_type="int8")
AUDIO = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\public\songs\wakawaka.mp3"

segments, info = model.transcribe(
    AUDIO, beam_size=5,
    vad_filter=True,
    condition_on_previous_text=False,
    word_timestamps=True,
)
out = []
for seg in segments:
    if seg.end < 100:
        continue
    ws = []
    for w in (seg.words or []):
        if w.end < 100 or w.start > 212:
            continue
        ws.append("%s %.2f-%.2f" % (w.word.strip(), w.start, w.end))
    out.append("[%.2f-%.2f] %s" % (seg.start, seg.end, seg.text.strip()))
    out.append("    " + " | ".join(ws))
with open(r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_vad_out.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print("done", len(out), "lang=", info.language)
