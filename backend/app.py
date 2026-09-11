# -*- coding: utf-8 -*-
"""SongLearn 本地对齐后端：词级强制对齐服务。

链路：音频 → faster-whisper 词级时间戳（时间证据）→ 与官方歌词文本做带约束 DTW
→ 音节/乐句点精修 → 每个词 [start,end]。前端探不到 /api/health 就退回浏览器端启发式。

只在本地 127.0.0.1 监听，无外部密钥、无上传。
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS

import aligner

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / "cache"
MAGIC = "songlearn-align"          # 前端靠它区分「真后端」和 SPA rewrite 吐回来的 HTML
VERSION = "1.14.0"                 # 参与缓存 key：算法一变，旧结果必须失效
MAX_AUDIO = 80 * 1024 * 1024
MATCH_FLOOR = 0.55                 # 低于此值且用的是 base → 自动换 small 重跑
SR = 16000

HF_HUB = Path(os.environ.get("HF_HOME") or (Path.home() / ".cache" / "huggingface" / "hub"))

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_AUDIO
CORS(app)                          # 本地开发：前端跑在 vite :3000，跨端口需要放开

_MODELS: dict[str, object] = {}
_MODEL_LOCK = threading.Lock()
_WORK_LOCK = threading.Lock()      # CPU 密集：一次只跑一个任务，避免互相拖慢
_JOBS: dict[str, dict] = {}
_JOB_LOCK = threading.Lock()


# ---------------------------------------------------------------- 模型 / 环境

def cached_models() -> list[str]:
    """HF 缓存里已下载的 faster-whisper 模型（离线可用）"""
    if not HF_HUB.exists():
        return []
    out = set()
    for p in HF_HUB.glob("models--Systran--faster-whisper-*"):
        out.add(p.name.split("faster-whisper-", 1)[-1])
    return sorted(out)


def get_model(size: str):
    with _MODEL_LOCK:
        m = _MODELS.get(size)
        if m is None:
            from faster_whisper import WhisperModel
            m = WhisperModel(size, device="cpu", compute_type="int8", local_files_only=True)
            _MODELS[size] = m
        return m


def ffmpeg_info() -> str:
    try:
        import av
        return f"pyav {av.__version__}"
    except Exception:                                    # noqa: BLE001
        pass
    try:
        import imageio_ffmpeg
        return f"imageio-ffmpeg {imageio_ffmpeg.get_ffmpeg_version()}"
    except Exception:                                    # noqa: BLE001
        return "none"


@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "magic": MAGIC,
        "version": VERSION,
        "models": cached_models(),
        "ffmpeg": ffmpeg_info(),
        "cuda": False,
    })


# ---------------------------------------------------------------- 音频解码

def decode_16k(data: bytes) -> tuple[np.ndarray, float]:
    """任意容器 → 16k 单声道 float32。PyAV（faster-whisper 自带 FFmpeg 库）优先，
    异形容器/视频再用 imageio-ffmpeg 兜底转一遍。"""
    from faster_whisper.audio import decode_audio
    try:
        wav = np.asarray(decode_audio(io.BytesIO(data), sampling_rate=SR), dtype=np.float32)
        if wav.size:
            return wav, wav.size / SR
    except Exception:                                    # noqa: BLE001
        pass
    import imageio_ffmpeg
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [exe, "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
           "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "pipe:1"]
    proc = subprocess.run(cmd, input=data, capture_output=True, timeout=600)
    if proc.returncode != 0 or not proc.stdout:
        raise ValueError(f"音频解码失败：{proc.stderr.decode('utf-8', 'ignore')[:200]}")
    wav = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    return wav, wav.size / SR


# ---------------------------------------------------------------- ASR

def asr_pass(wav: np.ndarray, model: str, language: str | None,
             vad: bool = False, on_seg=None) -> dict:
    """单趟识别。默认关 VAD：本项目实测 vad_filter 会把带伴奏的歌声当静音滤掉，
    幻觉改由 aligner.clean_asr 的 logprob/compression_ratio 过滤负责。"""
    m = get_model(model)
    segments, info = m.transcribe(
        wav,
        language=language,
        task="transcribe",
        word_timestamps=True,
        condition_on_previous_text=False,
        temperature=0,
        beam_size=5,
        vad_filter=vad,
    )
    dur = float(info.duration or 0.0)
    segs = []
    for seg in segments:
        segs.append({
            "id": seg.id,
            "start": float(seg.start),
            "end": float(seg.end),
            "text": seg.text,
            "avg_logprob": float(seg.avg_logprob or 0.0),
            "compression_ratio": float(seg.compression_ratio or 0.0),
            "no_speech_prob": float(getattr(seg, "no_speech_prob", 0.0) or 0.0),
            "words": [{"word": w.word, "start": float(w.start), "end": float(w.end),
                       "probability": float(getattr(w, "probability", 0.0) or 0.0)}
                      for w in (seg.words or [])],
        })
        if on_seg:
            on_seg(seg.end, dur)
    return {
        "model": model,
        "forced": language,
        "vad": vad,
        "language": info.language,
        "language_probability": float(info.language_probability or 0.0),
        "duration": dur,
        "segments": segs,
    }


def sung_seconds(asr: dict) -> float:
    """通过幻觉过滤的词总时长：判断这一趟到底认出了多少歌声（口径与对齐一致）"""
    words, _, _ = aligner.clean_asr(asr)
    return sum(max(0.0, w["e"] - w["s"]) for w in words)


def asr_with_retries(wav: np.ndarray, model: str, language: str | None,
                     duration: float, on_seg=None) -> dict:
    """覆盖率异常低（<15% 时长）时开 VAD 重跑一次，取唱得更满的那版"""
    best = asr_pass(wav, model, language, vad=False, on_seg=on_seg)
    if duration > 5 and sung_seconds(best) < duration * 0.15:
        alt = asr_pass(wav, model, language, vad=True, on_seg=on_seg)
        if sung_seconds(alt) > sung_seconds(best):
            return alt
    return best


@app.post("/api/asr")
def api_asr():
    """调试端点：只识别不对齐（curl 用来看词级时间戳和语种）"""
    data = request.get_data()
    if not data:
        return jsonify({"error": "空音频"}), 400
    model = request.args.get("model") or "base"
    lang = request.args.get("lang") or None
    try:
        wav, duration = decode_16k(data)
    except Exception as e:                               # noqa: BLE001
        return jsonify({"error": str(e)}), 400
    t0 = time.time()
    asr = asr_with_retries(wav, model, lang, duration)
    words = [{"w": w["word"], "s": round(w["start"], 3), "e": round(w["end"], 3)}
             for seg in asr["segments"] for w in seg["words"]]
    return jsonify({
        "language": asr["language"],
        "language_probability": round(asr["language_probability"], 3),
        "model": model,
        "forced": lang,
        "duration": round(duration, 2),
        "seconds": round(time.time() - t0, 1),
        "sungSeconds": round(sung_seconds(asr), 2),
        "segments": asr["segments"],
        "words": words,
    })


# ---------------------------------------------------------------- 歌词

LRC_TIME = re.compile(r"^((?:\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$")
LRC_TAG = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")


def parse_lrc(text: str) -> list[dict]:
    out: list[dict] = []
    for raw in (text or "").splitlines():
        m = LRC_TIME.match(raw.strip())
        if not m:
            continue
        body = m.group(2).strip()
        if not body:
            continue
        for mm, ss, frac in LRC_TAG.findall(m.group(1)):
            t = int(mm) * 60 + int(ss) + (int(frac.ljust(3, "0")) / 1000.0 if frac else 0.0)
            out.append({"time": round(t, 3), "text": body})
    out.sort(key=lambda l: l["time"])
    return out


def read_meta() -> dict:
    """歌词与选项：X-Songlearn-Meta 头（base64url JSON，避免 URL 长度限制）或 ?meta="""
    raw = request.headers.get("X-Songlearn-Meta") or request.args.get("meta") or ""
    if not raw:
        return {}
    try:
        if raw.lstrip().startswith(("{", "[")):
            return json.loads(raw)
        pad = "=" * (-len(raw) % 4)
        return json.loads(base64.urlsafe_b64decode(raw + pad).decode("utf-8"))
    except Exception:                                    # noqa: BLE001
        return {}


def meta_lines(meta: dict) -> list[dict]:
    lines = meta.get("lines")
    if isinstance(lines, list) and lines:
        norm = []
        for i, l in enumerate(lines):
            if isinstance(l, dict):
                norm.append({"time": float(l.get("time") or 0.0),
                             "text": str(l.get("text") or "")})
            elif isinstance(l, str):
                norm.append({"time": 0.0, "text": l})
        return [l for l in norm if l["text"].strip()]
    if meta.get("lrc"):
        return parse_lrc(str(meta["lrc"]))
    return []


def plan_second_lang(lines: list[dict], first_lang: str) -> str | None:
    """混语歌补一趟 ASR 的语种：whisper 一趟只认一种语种，另一种语种的歌词行
    永远匹配不上。取歌词里占比 ≥20% 且不是首趟语种的第二语种（最多两趟）。"""
    weights: dict[str, int] = {}
    total = 0
    for l in lines:
        text = l.get("text") or ""
        n = max(1, len(text.split()))
        total += n
        g = aligner.guess_lang(text)
        if g:
            weights[g] = weights.get(g, 0) + n
    if total <= 0:
        return None
    ranked = sorted(weights.items(), key=lambda kv: -kv[1])
    for lang, w in ranked:
        if lang != first_lang and w / total >= 0.2:
            return lang
    return None


# ---------------------------------------------------------------- Job

def _job(jid: str) -> dict:
    with _JOB_LOCK:
        return _JOBS[jid]


def _update(jid: str, **kw):
    with _JOB_LOCK:
        _JOBS[jid].update(kw)


def _cache_path(key: str) -> Path:
    CACHE_DIR.mkdir(exist_ok=True)
    return CACHE_DIR / f"{key}.json"


def cache_key(data: bytes, meta: dict) -> str:
    lines = meta_lines(meta)
    opts = json.dumps({"v": VERSION, "lines": lines, "model": meta.get("model"),
                       "escalate": meta.get("escalate", True), "lang": meta.get("lang")},
                      ensure_ascii=False, sort_keys=True)
    h1 = hashlib.sha1(data).hexdigest()[:20]
    h2 = hashlib.sha1(opts.encode("utf-8")).hexdigest()[:20]
    return f"{h1}-{h2}"


def run_align(jid: str, data: bytes, meta: dict, key: str):
    try:
        with _WORK_LOCK:
            _update(jid, status="running", stage="解码音频", progress=0.02)
            wav, duration = decode_16k(data)
            if meta.get("duration"):
                duration = float(meta["duration"]) or duration
            lines = meta_lines(meta)
            model = (meta.get("model") or "base").strip()
            if model not in ("tiny", "base", "small", "medium", "large-v3"):
                model = "base"

            def seg_cb(end: float, dur: float):
                if dur > 0:
                    frac = min(1.0, end / dur)
                    _update(jid, stage=f"{model} 识别中", progress=round(0.05 + 0.40 * frac, 3))

            passes = []
            first = asr_with_retries(wav, model, meta.get("lang") or None, duration, seg_cb)
            passes.append({"lang": first["language"], "asr": first})

            second_lang = plan_second_lang(lines, first["language"] or "")
            if second_lang:
                _update(jid, stage=f"混语歌：补一趟 {second_lang} 识别", progress=0.5)
                second = asr_with_retries(wav, model, second_lang, duration,
                                          lambda e, d: _update(jid, progress=round(0.5 + 0.15 * min(1.0, e / max(d, 1e-6)), 3)))
                passes.append({"lang": second_lang, "asr": second})

            _update(jid, stage="词级对齐中", progress=0.7)
            result = aligner.align_multi(passes, lines, wav, model, duration)

            # matchRatio 低有两种成因：模型听错（换 small 有用），或 whisper 在副歌上
            # 幻觉成循环、被 clean_asr 截断（证据本来就不存在，换模型只是白等）。
            # 实测 166s 测试曲：截断 8 个循环段后 ratio=0.355，small 重跑 50s 仍然输。
            if (meta.get("escalate", True) and model == "base"
                    and not result.get("loops")
                    and result["matchRatio"] < MATCH_FLOOR):
                _update(jid, stage="精度不足，用 small 重跑", progress=0.6)
                p2 = [{"lang": p["lang"],
                       "asr": asr_with_retries(wav, "small", p["lang"] or None, duration)}
                      for p in passes]
                r2 = aligner.align_multi(p2, lines, wav, "small", duration)
                if r2["matchRatio"] > result["matchRatio"]:
                    result = r2

            _update(jid, stage="完成", progress=1.0, status="done", result=result)
            try:
                _cache_path(key).write_text(json.dumps(result, ensure_ascii=False), "utf-8")
            except Exception:                            # noqa: BLE001
                pass
    except Exception as e:                               # noqa: BLE001
        _update(jid, status="error", stage="失败", progress=1.0,
                error=f"{type(e).__name__}: {e}")


@app.post("/api/wordalign")
def api_wordalign():
    data = request.get_data()
    if not data:
        return jsonify({"error": "空音频"}), 400
    meta = read_meta()
    if not meta_lines(meta):
        return jsonify({"error": "缺少歌词（X-Songlearn-Meta 里要有 lines 或 lrc）"}), 400

    key = cache_key(data, meta)
    jid = uuid.uuid4().hex[:16]
    cached = _cache_path(key)
    if cached.exists():
        try:
            result = json.loads(cached.read_text("utf-8"))
            with _JOB_LOCK:
                _JOBS[jid] = {"status": "done", "stage": "命中缓存", "progress": 1.0,
                              "result": result, "error": None, "cached": True,
                              "createdAt": time.time()}
            return jsonify({"jobId": jid, "cached": True})
        except Exception:                                # noqa: BLE001
            pass

    with _JOB_LOCK:
        _JOBS[jid] = {"status": "queued", "stage": "排队中", "progress": 0.0,
                      "result": None, "error": None, "cached": False, "createdAt": time.time()}
        if len(_JOBS) > 40:                              # 内存兜底：只留最近的
            for old in sorted(_JOBS, key=lambda k: _JOBS[k]["createdAt"])[:-40]:
                _JOBS.pop(old, None)
    threading.Thread(target=run_align, args=(jid, data, meta, key), daemon=True).start()
    return jsonify({"jobId": jid, "cached": False})


@app.get("/api/job/<jid>")
def api_job(jid: str):
    with _JOB_LOCK:
        j = _JOBS.get(jid)
        if not j:
            return jsonify({"status": "error", "error": "任务不存在"}), 404
        out = {k: j[k] for k in ("status", "stage", "progress", "error", "cached") if k in j}
        if j.get("status") == "done":
            out["result"] = j.get("result")
    return jsonify(out)


def main():
    port = 8787
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--port" and i + 1 < len(argv):
            port = int(argv[i + 1])
        elif a.startswith("--port="):
            port = int(a.split("=", 1)[1])
    if os.environ.get("PORT"):
        port = int(os.environ["PORT"])
    print(f"[songlearn-align] v{VERSION} http://127.0.0.1:{port}  models={cached_models()}")
    app.run(host="127.0.0.1", port=port, threaded=True, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
