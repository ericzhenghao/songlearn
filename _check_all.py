# -*- coding: utf-8 -*-
"""全曲对齐检查：demucs 人声分离 → whisper small 人声轨 → 输出每句 vs 识别对照"""
import os, json, subprocess, wave, numpy as np
from faster_whisper import WhisperModel

ROOT = r"C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2"
PY = os.path.join(ROOT, "backend", ".venv", "Scripts", "python.exe")
FF = os.path.join(ROOT, "backend", ".venv", "Lib", "site-packages", "imageio_ffmpeg", "binaries", "ffmpeg-win-x86_64-v7.1.exe")
SMALL = r"C:\Users\ericz\.cache\huggingface\hub\models--Systran--faster-whisper-small\snapshots\536b0662742c02347bc0e980a01041f333bce120"
TMP = os.path.join(ROOT, "_tmp_voc.wav")

lib = json.load(open(os.path.join(ROOT, "src", "data", "library.json"), encoding="utf-8"))
model = WhisperModel(SMALL, device="cpu", compute_type="int8")

def parse_lrc(lrc):
    rows = []
    for ln in lrc.splitlines():
        m = __import__("re").findall(r"\[(\d+):(\d+\.\d+)\]", ln)
        if len(m) >= 1:
            start = int(m[0][0]) * 60 + float(m[0][1])
            idx = ln.rfind("]")
            rows.append((start, ln[idx + 1:].strip()))
    return rows

def sep_and_check(song):
    title, mp3 = song["title"], song.get("audioInRepo") or song.get("audio")
    src = os.path.join(ROOT, "public", mp3)
    base = os.path.basename(mp3)
    sep_dir = os.path.join(ROOT, "_sep", "htdemucs", os.path.splitext(base)[0])
    vocals = os.path.join(sep_dir, "vocals.wav")
    if not os.path.exists(vocals):
        print("[%s] 开始 demucs 分离..." % title)
        flat = os.path.join(ROOT, "_sep", base)
        os.makedirs(os.path.dirname(flat), exist_ok=True)
        if not os.path.exists(flat):
            import shutil; shutil.copy2(src, flat)
        r = subprocess.run([PY, "-m", "demucs", "--two-stems", "vocals", "-o", os.path.join(ROOT, "_sep"), flat], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError("demucs: " + (r.stderr[-500:] or r.stdout[-500:]))
    print("[%s] vocals 就绪 %dKB" % (title, os.path.getsize(vocals) // 1024))
    # whisper 全曲
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", vocals, "-ac", "1", "-ar", "16000", TMP], check=True)
    segs, info = model.transcribe(TMP, beam_size=5, vad_filter=True, condition_on_previous_text=False)
    asr = [(s.start, s.end, s.text.strip()) for s in segs]
    # LRC 对照
    rows = parse_lrc(song["lrc"])
    out = ["=== %s (时长 %.0fs, ASR %d 段) ===" % (title, info.duration, len(asr))]
    out.append("-- ASR 段 --")
    for s, e, t in asr:
        out.append("[%7.2f-%7.2f] %s" % (s, e, t))
    out.append("-- LRC 每行 (start 最近的 ASR 段起点差) --")
    ai = 0
    for start, text in rows:
        # 找最近的 ASR 段起点
        best, bd = None, 1e9
        for s, e, t in asr:
            d = abs(s - start)
            if d < bd:
                bd, best = d, (s, e, t)
        flag = "OK" if bd < 1.0 else ("~" if bd < 2.5 else "!!")
        out.append("%s [%7.2f] %-40s  vs ASR %.2f %s" % (flag, start, text[:40], best[0], best[2][:30]))
    txt = "\n".join(out)
    print(txt)
    fn = os.path.join(ROOT, "_check_%s.txt" % os.path.splitext(os.path.basename(mp3))[0])
    open(fn, "w", encoding="utf-8").write(txt)
    print("→ %s" % fn)

for song in lib:
    mp3 = song.get("audioInRepo") or song.get("audio")
    if mp3 and os.path.exists(os.path.join(ROOT, "public", mp3)):
        print("======== 处理 %s ========" % song["title"])
        try:
            sep_and_check(song)
        except Exception as e:
            print("ERR %s: %s" % (song["title"], e))
