# -*- coding: utf-8 -*-
"""小窗词级确认：Toca 0-166 / Despacito 200-212 / Sofia 105-120"""
import subprocess, os
from faster_whisper import WhisperModel

ROOT = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2"
FF = os.path.join(ROOT, "backend", ".venv", "Lib", "site-packages", "imageio_ffmpeg", "binaries", "ffmpeg-win-x86_64-v7.1.exe")
SMALL = r"C:\Users\ericz\.cache\huggingface\hub\models--Systran--faster-whisper-small\snapshots\536b0662742c02347bc0e980a01041f333bce120"
TMP = os.path.join(ROOT, "_vw.wav")
model = WhisperModel(SMALL, device="cpu", compute_type="int8")

def run(src, start, end, label, step=2.0, win=4.5):
    out = []
    t = start
    while t < end:
        s, e = t, min(t + win, end)
        subprocess.run([FF, "-y", "-loglevel", "error", "-ss", str(s), "-to", str(e), "-i", src, "-ac", "1", "-ar", "16000", TMP], check=True)
        segs, _ = model.transcribe(TMP, beam_size=5, vad_filter=True, condition_on_previous_text=False, word_timestamps=True)
        parts = []
        for seg in segs:
            ws = " ".join("%s%.2f" % (w.word.strip(), s + w.start) for w in (seg.words or []))
            parts.append("[%6.2f] %s < %s >" % (s + seg.start, seg.text.strip(), ws))
        out.append("  " + (" / ".join(parts) if parts else "(无)"))
        t += step
    txt = "\n".join(out)
    print("== %s %s-%s ==" % (label, start, end))
    print(txt)
    return txt

all_out = []
all_out.append(run(os.path.join(ROOT, "_sep", "htdemucs", "tocatoca", "vocals.wav"), 0, 166, "TOCA 全曲", step=2.0, win=4.5))
all_out.append(run(os.path.join(ROOT, "_sep", "htdemucs", "despacito", "vocals.wav"), 199, 212, "DESPACITO 尾部", step=1.8, win=4.2))
all_out.append(run(os.path.join(ROOT, "_sep", "htdemucs", "sofia", "vocals.wav"), 104, 121, "SOFIA 副歌2", step=1.8, win=4.2))
open(os.path.join(ROOT, "_small_confirm.txt"), "w", encoding="utf-8").write("\n\n".join(all_out))
print("→ _small_confirm.txt")
