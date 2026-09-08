# -*- coding: utf-8 -*-
"""词级强制对齐：官方歌词文本（权威）× whisper 词级时间戳（时间证据）。

设计要点（对照旧 forced_aligner.py 的五个坑）：
- 跳过 ASR 词有惩罚（旧版为 0 → DTW 白吃噪声）
- 短词（≤3 字符）必须完全匹配（旧版子串给 0.7 → "la/no/a" 到处乱咬）
- 按 lrclib 句时间加约束带 + 先自估整体偏移（版本差异时带才不会框错）
- 未对齐的词按音节权重插值并吸附到真实乐句点（旧版硬编码 0.3s）
- 重叠只收缩前词 end，绝不把后句 start 顶推（旧版 _postprocess 造成累积滞后）
"""
from __future__ import annotations

import re
import unicodedata
from array import array
from collections import Counter
from difflib import SequenceMatcher

import numpy as np
from scipy.signal import stft

SKIP_ASR = 0.05      # 跳过一个 ASR 词的代价
SKIP_TOK = 0.60      # 跳过一个歌词 token 的代价（更贵：歌词是权威文本，应尽量对上）
MERGE_PEN = 0.10     # 一个 token 吃掉两个 ASR 词（"domperignon" → "Dom Pérignon"）
SPLIT_PEN = 0.15     # 两个 token 共享一个 ASR 词（"don't" → "do n't"）
SIM_MIN = 0.55       # 低于此相似度的匹配在回溯时丢弃
BAND_PAD = 3.0       # 句时间约束带的两侧余量（秒）
MIN_WORD = 0.08      # 词长下限
SNAP_WIN = 0.15      # 词界吸附到乐句点的最大距离
SYL_SEC = 0.35       # 每音节自然唱速：估未对齐词段该占多长（别摊满整段间奏）
MAX_WORD = 2.5       # 单词时长上限：拖腔也很少超过，更长说明是幻觉词的时间戳

WORD_RUN = re.compile(r"\S+")
CJK = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]")
VOWELS = re.compile(r"[aeiouy\u00e0-\u00ff\u0101-\u017f]{1,2}")
KEEP = re.compile(r"[^\W\d_]+", re.UNICODE)


# ---------------------------------------------------------------- 文本切分

def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def norm_word(w: str) -> str:
    """归一化：去重音、小写、只留字母（比对用）"""
    return _strip_accents((w or "").lower()).replace("\u2019", "'")


def _sub_spans(run: str, base: int) -> list[tuple[int, int]]:
    """把一个非空白串切成 token 区间：CJK 逐字，其余整串（含标点）"""
    if not CJK.search(run):
        return [(base, base + len(run))]
    out: list[tuple[int, int]] = []
    i = 0
    while i < len(run):
        if CJK.match(run, i):
            out.append((base + i, base + i + 1))
            i += 1
        else:
            j = i
            while j < len(run) and not CJK.match(run, j):
                j += 1
            out.append((base + i, base + j))
            i = j
    return out


def tokenize(lines: list[dict]) -> list[dict]:
    """歌词行 → token 列表。token['t'] 是原文的精确切片（含尾随空白），
    同一行所有 token 拼接后 === 行原文，渲染端因此无需重组空格。"""
    tokens: list[dict] = []
    for li, line in enumerate(lines):
        text = line.get("text") or ""
        spans: list[tuple[int, int]] = []
        for m in WORD_RUN.finditer(text):
            spans.extend(_sub_spans(m.group(0), m.start()))
        if not spans:
            continue
        # 尾随空白并入前一个 token，保证切片连续无缝
        for k, (a, b) in enumerate(spans):
            end = spans[k + 1][0] if k + 1 < len(spans) else len(text)
            core = text[a:b]
            norm = "".join(KEEP.findall(norm_word(core)))
            tokens.append({
                "t": text[a:end],
                "core": core,
                "norm": norm,
                "line": li,
                "syl": syllables(core),
            })
    return tokens


def syllables(word: str) -> int:
    """音节数：CJK 一字一音，拉丁语系按元音组（插值权重用，比字符数靠谱）"""
    w = norm_word(word)
    if CJK.search(w):
        return max(1, len(CJK.findall(w)))
    letters = "".join(KEEP.findall(w))
    if not letters:
        return 1
    n = len(VOWELS.findall(letters))
    return max(1, n)


# ---------------------------------------------------------------- 行语种猜测
# 混语歌（英文主歌 + 西语副歌）：whisper 只检测一次语种，另一语种的句子必然识别错。
# 这里按行猜语种，决定该行允许匹配哪一趟 ASR 的词。猜不出（None）= 不限语种。

LANG_STOP: dict[str, set[str]] = {
    "es": {"el", "la", "los", "las", "del", "hay", "muy", "pero", "esto", "esta", "eres", "soy",
           "vamos", "quiero", "siempre", "nunca", "puedo", "corazon", "contigo", "hasta", "cuando",
           "donde", "aqui", "como", "porque", "entre", "desde", "sobre", "todo", "toda", "una",
           "musica", "vida", "loca", "toca", "encanta", "noche", "amor", "fuego", "gente", "tierra",
           "miedo", "siente", "vuelve", "espera", "dale", "somos", "mujer", "correr", "bailar"},
    "en": {"the", "you", "your", "for", "and", "with", "but", "this", "that", "are", "was", "were",
           "have", "has", "dont", "cant", "every", "all", "not", "its", "im", "ive", "gonna",
           "wanna", "love", "heart", "night", "always", "never", "life", "come", "back", "feel",
           "time", "when", "where", "here", "there", "their", "they", "them", "from", "say", "see",
           "rain", "forever", "together", "celebrate", "hold", "want", "because", "nothing",
           "something", "everybody", "tonight", "dream", "know", "think", "give", "take"},
    "fr": {"le", "les", "des", "une", "dans", "pour", "avec", "mais", "nous", "vous", "je", "tu",
           "elle", "cest", "pas", "sur", "tout", "tous", "mon", "mes", "ton", "coeur", "toujours",
           "quand", "comment", "tres", "bien", "soir", "nuit", "vie", "jamais", "veux", "etre",
           "avoir", "leur", "sans", "sous", "chez", "moi", "toi", "amour", "lumiere"},
    "de": {"ich", "du", "wir", "ihr", "ist", "sind", "ein", "eine", "und", "aber", "nicht", "mit",
           "auf", "das", "die", "der", "den", "dem", "auch", "noch", "nur", "wenn", "weil", "immer",
           "nie", "herz", "liebe", "nacht", "leben", "zeit", "komm", "wieder", "feuer", "menschen",
           "mein", "dein", "sein", "kein", "zuruck", "uber", "unter"},
    "pt": {"nao", "voce", "muito", "muita", "mas", "tudo", "todas", "linda", "olha", "deixa",
           "samba", "coracao", "noite", "sempre", "nunca", "vida", "volta", "fogo", "terra", "gente",
           "sentir", "chegou", "onde", "quando", "aqui", "seu", "sua", "teu", "minha", "meu",
           "hoje", "amanha", "faz", "fica", "vem", "vai", "amor", "voce"},
    "it": {"che", "non", "sono", "sei", "siamo", "per", "perche", "come", "dove", "quando", "qui",
           "tutto", "tutti", "molto", "bene", "amore", "cuore", "notte", "sempre", "mai", "vita",
           "torna", "aspetta", "fuoco", "terra", "gente", "paura", "mio", "mia", "tuo", "sua",
           "nostro", "degli", "fai", "fare", "vai", "vieni"},
}


def guess_lang(text: str) -> str | None:
    """按行猜语种：CJK 看字符，拉丁语系数停用词。领先不足 2 分则判为不确定"""
    if not text:
        return None
    if re.search(r"[\u3040-\u30ff]", text):
        return "ja"
    if re.search(r"[\uac00-\ud7af]", text):
        return "ko"
    if CJK.search(text):
        return "zh"
    low = _strip_accents(text.lower())
    words = set(KEEP.findall(low))
    if len(words) < 2:
        return None
    scores = {lg: sum(2 for w in words if w in sw) for lg, sw in LANG_STOP.items()}
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    best, second = ranked[0], ranked[1]
    if best[1] < 4 or best[1] - second[1] < 2:
        return None
    return best[0]


# ---------------------------------------------------------------- 相似度

_sim_cache: dict[tuple[str, str], float] = {}


def word_sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    key = (a, b) if a <= b else (b, a)
    hit = _sim_cache.get(key)
    if hit is not None:
        return hit
    if a == b:
        v = 1.0
    elif min(len(a), len(b)) <= 3:
        v = 0.0        # 短词只认完全匹配，否则副歌里的 "no/la/oh" 会咬住任何地方
    elif a in b or b in a:
        v = 0.80
    else:
        v = SequenceMatcher(None, a, b).ratio()
    _sim_cache[key] = v
    return v


# ---------------------------------------------------------------- ASR 清洗

def _loop_cut(norms: list[str], keep: int = 3) -> int:
    """幻觉循环段的指纹：一个短 n-gram 无限重复（"no,"×109 / "toca a"×73 / "a lo que"×75）。
    连续同词坍塌抓不到周期 ≥2 的循环，这里按 n-gram 覆盖率判定，只留前 keep 个周期。
    循环段里的词时间戳是编的，留着当锚点比不留更糟（会把整句拽到错误位置）。
    返回该段应保留的词数；== len(norms) 表示不是循环段。"""
    n = len(norms)
    if n < 8:
        return n
    for p in range(1, 7):
        if n < p * 4:
            break
        grams = Counter(tuple(norms[i:i + p]) for i in range(n - p + 1))
        gram, reps = grams.most_common(1)[0]
        if reps < 4 or reps * p < n * 0.5:
            continue
        seen = 0
        for i in range(n - p + 1):
            if tuple(norms[i:i + p]) == gram:
                seen += 1
                if seen == keep:
                    return i + p
        return n
    return n


def clean_asr(asr: dict) -> tuple[list[dict], str, int]:
    """segment 级幻觉过滤 + 循环截断 + 词级重复坍塌 → (干净词序列, 语种, 被截断的循环段数)。

    实测教训：音乐里 compression_ratio 高的段通常是「真词 + 重复幻觉」混在一起
    （"You said no no no, I said no no no" 后面拖一百个 no），整段丢弃会连真实
    歌词的时间证据一起丢；而歌里本来就有真重复（"loca, loca, loca, loca"）。
    所以只有极低置信度才整段丢，循环段截到第 3 个周期，剩下交给 DTW 拒绝。

    第三个返回值是给「要不要换大模型重跑」用的：截断多 = 这些行本来就没有证据，
    matchRatio 低是音频的锅，不是模型听错，重跑只是白等一分钟。"""
    words: list[dict] = []
    loops = 0
    for seg in asr.get("segments") or []:
        if (seg.get("avg_logprob") or 0) < -1.0:
            continue
        seg_words = []
        for w in seg.get("words") or []:
            norm = "".join(KEEP.findall(norm_word(w.get("word") or "")))
            if not norm:
                continue
            seg_words.append({"norm": norm, "s": float(w.get("start") or 0.0),
                              "e": float(w.get("end") or 0.0)})
        cut = _loop_cut([x["norm"] for x in seg_words])
        if cut < len(seg_words):
            loops += 1
        limit = 2 if (seg.get("compression_ratio") or 0) > 2.4 else 4
        run = 0
        for w in seg_words[:cut]:
            if words and words[-1]["norm"] == w["norm"]:
                run += 1
                if run >= limit:
                    continue
            else:
                run = 0
            words.append(w)
    # 跨段边界的连续同词也要坍塌（上一段结尾和下一段开头常是同一句的重复幻觉）
    out: list[dict] = []
    run = 0
    for w in words:
        if out and out[-1]["norm"] == w["norm"]:
            run += 1
            if run >= 4:
                continue
        else:
            run = 0
        out.append(w)
    return out, (asr.get("language") or ""), loops


def text_sim(asr_words: list[dict], tokens: list[dict]) -> float:
    """识别文本 vs 官方歌词的实词重合度：低 = 版本/语言可能不符（一致性告警依据）"""
    a = {w["norm"] for w in asr_words if len(w["norm"]) > 2}
    b = {t["norm"] for t in tokens if len(t["norm"]) > 2}
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


# ---------------------------------------------------------------- 约束带

def _bands(tokens: list[dict], lines: list[dict], duration: float, offset: float) -> list[tuple[float, float]]:
    """每个 token 允许匹配的 ASR 词索引区间（lrclib 句时间 ± 余量）"""
    times = [float(l.get("time") or 0.0) for l in lines]
    has_time = any(t > 0.01 for t in times)
    if not has_time:
        return [(0.0, 1e9)] * len(tokens)
    out = []
    for tk in tokens:
        i = tk["line"]
        lo = times[i] + offset - BAND_PAD
        hi = (times[i + 1] if i + 1 < len(times) and times[i + 1] > times[i] else times[i] + 12.0)
        hi = hi + offset + BAND_PAD
        if duration > 0:
            hi = min(hi, duration + 1.0)
        out.append((max(0.0, lo), hi))
    return out


def _estimate_offset(tokens: list[dict], words: list[dict], lines: list[dict], duration: float) -> float:
    """自估整体偏移：歌词时间轴可能来自别的版本（前奏长短不同）。
    对每个 δ 数"有多少 token 能在平移后的带内找到完全同形的 ASR 词"，取最优。

    只用有辨识度的词投票：实测 "no/toca/loca" 这类高频重复词随便一个 δ 都能凑出
    大量命中，把真实 -3s 估成 -7s。平票时偏向 |δ| 更小的解。"""
    times = [float(l.get("time") or 0.0) for l in lines]
    if not any(t > 0.01 for t in times) or not words:
        return 0.0
    freq: dict[str, int] = {}
    for w in words:
        freq[w["norm"]] = freq.get(w["norm"], 0) + 1
    probe = [tk for tk in tokens if len(tk["norm"]) >= 5 and freq.get(tk["norm"], 0) <= 6]
    if len(probe) < 3:
        probe = tokens
    starts = np.array([w["s"] for w in words])
    norms = [w["norm"] for w in words]
    scores: list[tuple[float, int]] = []
    for d in np.arange(-30.0, 30.01, 0.5):
        hit = 0
        for tk in probe:
            i = tk["line"]
            lo = times[i] + d - BAND_PAD
            hi = (times[i + 1] if i + 1 < len(times) and times[i + 1] > times[i] else times[i] + 12.0) + d + BAND_PAD
            j0 = int(np.searchsorted(starts, lo))
            j1 = int(np.searchsorted(starts, hi))
            for j in range(j0, min(j1 + 1, len(norms))):
                if norms[j] == tk["norm"]:
                    hit += 1
                    break
        scores.append((float(d), hit))

    hit0 = next(h for d, h in scores if abs(d) < 1e-9)   # np.arange 累加出的 0 未必精确等于 0.0
    best, best_hit = 0.0, hit0
    for d, hit in scores:
        if hit > best_hit or (hit == best_hit and abs(d) < abs(best)):
            best_hit, best = hit, d

    # whisper 在 CPU 上不是逐位可复现的：同一段音频跑两次，词数一样但内容能差几十个，
    # 投票数跟着抖（实测同一首歌两次估出 -5 和 +0.5）。整体平移是个很强的断言，
    # 前端会拿它平移整份歌词时间轴，估错了就是歌词在两次上传之间跳好几秒。
    # 所以非零 δ 必须明显赢过「不平移」才采纳，差一点点交给约束带的 ±3s 余量兜。
    if best != 0.0 and best_hit < hit0 + max(2, int(hit0 * 0.15)):
        return 0.0
    return best if best_hit >= 3 else 0.0


# ---------------------------------------------------------------- DTW

def dtw_align(tokens: list[dict], words: list[dict], bands: list[tuple[float, float]],
              tok_lang: list[str | None] | None = None,
              word_lang: list[str] | None = None) -> list[dict | None]:
    """全局 DP：返回每个 token 的 {'s','e','how'} 或 None（未对齐，交给 refine 插值）。
    tok_lang/word_lang 同时给出时启用语种掩码：多趟 ASR 合并后，某语种的歌词行
    只允许咬同语种那一趟的词（英文主歌不该被西语识别结果带跑）。"""
    n, m = len(tokens), len(words)
    if n == 0 or m == 0:
        return [None] * n
    masked = bool(tok_lang and word_lang)
    wlang = word_lang if masked else [""] * m
    NEG = -1e9
    dp = [array("f", [NEG]) * (m + 1) for _ in range(n + 1)]
    op = [bytearray(m + 1) for _ in range(n + 1)]   # 1=match 2=merge 3=split 4=skipTok 0=skipASR
    dp[0][0] = 0.0
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] - SKIP_ASR
    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] - SKIP_TOK
        op[i][0] = 4

    starts = [w["s"] for w in words]
    ends = [w["e"] for w in words]
    wnorm = [w["norm"] for w in words]

    for i in range(1, n + 1):
        tk = tokens[i - 1]
        lo_t, hi_t = bands[i - 1]
        row, prow, orow = dp[i], dp[i - 1], op[i]
        pnorm = tokens[i - 2]["norm"] if i >= 2 else ""
        same_line = i >= 2 and tokens[i - 2]["line"] == tk["line"]
        tl = (tok_lang[i - 1] or "") if masked else ""
        pl = (tok_lang[i - 2] or "") if masked and i >= 2 else ""
        for j in range(1, m + 1):
            best = prow[j] - SKIP_TOK
            bop = 4
            v = row[j - 1] - SKIP_ASR
            if v > best:
                best, bop = v, 0
            if lo_t <= starts[j - 1] <= hi_t and (not tl or not wlang[j - 1] or tl == wlang[j - 1]):
                s = word_sim(tk["norm"], wnorm[j - 1])
                if s >= SIM_MIN:
                    v = prow[j - 1] + s
                    if v > best:
                        best, bop = v, 1
                    if j >= 2 and (not tl or not wlang[j - 2] or tl == wlang[j - 2]):
                        s2 = word_sim(tk["norm"], wnorm[j - 2])   # 一个 token 吃掉相邻两个 ASR 词
                        if max(s, s2) >= SIM_MIN:
                            v = dp[i - 1][j - 2] + max(s, s2) - MERGE_PEN
                            if v > best:
                                best, bop = v, 2
                if same_line and (not pl or not wlang[j - 1] or pl == wlang[j - 1]):
                    s3 = word_sim(pnorm, wnorm[j - 1])            # 两个 token 共享一个 ASR 词
                    if s3 >= SIM_MIN:
                        v = dp[i - 2][j - 1] + (s3 + s) / 2 - SPLIT_PEN
                        if v > best:
                            best, bop = v, 3
            row[j] = best
            orow[j] = bop

    # 回溯
    res: list[dict | None] = [None] * n
    i, j = n, m
    while i > 0 and j > 0:
        o = op[i][j]
        if o == 1:
            s = word_sim(tk["norm"], wnorm[j - 1]) if (tk := tokens[i - 1])["norm"] and wnorm[j - 1] else 0.0
            res[i - 1] = {"s": starts[j - 1], "e": ends[j - 1], "how": "asr", "sim": s}
            i, j = i - 1, j - 1
        elif o == 2:
            tk = tokens[i - 1]
            s = max(word_sim(tk["norm"], wnorm[j - 1]) if tk["norm"] and wnorm[j - 1] else 0.0,
                    word_sim(tk["norm"], wnorm[j - 2]) if tk["norm"] and wnorm[j - 2] else 0.0)
            res[i - 1] = {"s": starts[j - 2], "e": ends[j - 1], "how": "asr2", "sim": s}
            i, j = i - 1, j - 2
        elif o == 3:
            lo, hi = starts[j - 1], ends[j - 1]
            a, b = tokens[i - 2], tokens[i - 1]
            cut = lo + (hi - lo) * (a["syl"] / max(1, a["syl"] + b["syl"]))
            s_a = word_sim(a["norm"], wnorm[j - 1]) if a["norm"] and wnorm[j - 1] else 0.0
            s_b = word_sim(b["norm"], wnorm[j - 1]) if b["norm"] and wnorm[j - 1] else 0.0
            res[i - 2] = {"s": lo, "e": cut, "how": "split", "sim": s_a}
            res[i - 1] = {"s": cut, "e": hi, "how": "split", "sim": s_b}
            i, j = i - 2, j - 1
        elif o == 4:
            i -= 1
        else:
            j -= 1
    return res


# ---------------------------------------------------------------- 音频特征

def onsets(wav: np.ndarray, sr: int = 16000) -> tuple[np.ndarray, np.ndarray]:
    """谱通量乐句点 + 200-4000Hz 能量包络（帧移 10ms）"""
    hop = 160
    if wav.size < 2 * hop:
        return np.array([]), np.array([])
    _, _, Z = stft(wav, fs=sr, nperseg=512, noverlap=512 - hop, boundary="zeros")
    mag = np.abs(Z)
    freqs = np.fft.rfftfreq(512, 1.0 / sr)[: mag.shape[0]]
    band = (freqs >= 200) & (freqs <= 4000)
    env = mag[band].sum(axis=0)
    d = np.diff(mag, axis=1, prepend=mag[:, :1])
    flux = np.clip(d, 0, None).sum(axis=0)
    k = max(1, int(0.03 * sr / hop))
    ker = np.ones(k) / k
    env = np.convolve(env, ker, mode="same")
    flux = np.convolve(flux, ker, mode="same")
    return flux, env


def _peaks(flux: np.ndarray, hop_sec: float, lo: float, hi: float) -> list[float]:
    if flux.size < 3:
        return []
    i0, i1 = max(1, int(lo / hop_sec)), min(flux.size - 1, int(hi / hop_sec))
    out = []
    thr = float(np.median(flux[i0:i1])) * 1.3 if i1 > i0 else 0.0
    last = -1e9
    for i in range(i0, i1):
        if flux[i] > flux[i - 1] and flux[i] >= flux[i + 1] and flux[i] > thr:
            t = i * hop_sec
            if t - last >= MIN_WORD:
                out.append(t)
                last = t
    return out


# ---------------------------------------------------------------- 精修

def _line_windows(times: list[float], offset: float, duration: float,
                  n_lines: int, has_time: bool) -> list[tuple[float, float]]:
    """每句在**音频域**里的显示窗口 = lrclib 句时间 + 已估整体偏移。

    词时间是音频域的（这份录音真实的唱腔时刻），句时间戳是 lrclib 域的（常常来自
    另一个版本，整份差几秒很常见）。前端渲染时会把句时间按 offset 平移到音频域，
    所以插值和出口守卫都必须用这个窗口 —— 拿音频域的词时间去比 lrclib 域的句时间，
    域都对不上，守卫会宽松到形同虚设。"""
    wins: list[tuple[float, float]] = []
    for i in range(n_lines):
        if not has_time:
            wins.append((0.0, 1e9))
            continue
        t0 = max(0.0, times[i] + offset)
        t1 = times[i + 1] + offset if i + 1 < n_lines and times[i + 1] > times[i] else t0 + 12.0
        if duration > 0:
            # 不留余量：音频结束之后没有信号，把词排到那儿是在描述不存在的东西。
            # 前端播到 duration-0.04 就自动暂停，sungEnd 超过 duration 会让最后一句
            # 的进度条永远停在半路上
            t1 = min(t1, duration)
        wins.append((t0, max(t0 + MIN_WORD, t1)))
    return wins


def refine(tokens: list[dict], matches: list[dict | None], lines: list[dict],
           flux: np.ndarray, hop_sec: float, duration: float, offset: float = 0.0) -> list[dict]:
    """未对齐 token 按音节权重插值，词界吸附到真实乐句点；组装行级结果"""
    n = len(tokens)
    spans: list[dict] = [dict(m) if m else {} for m in matches]
    for sp in spans:                   # 幻觉词的时间戳可能跨十几秒，采信会把高亮卡死
        if sp.get("s") is not None and sp["e"] - sp["s"] > MAX_WORD:
            sp["e"] = sp["s"] + MAX_WORD

    times = [float(l.get("time") or 0.0) for l in lines]
    has_time = any(t > 0.01 for t in times)
    wins = _line_windows(times, offset, duration, len(lines), has_time)
    by_line: list[list[int]] = [[] for _ in lines]
    for k, tk in enumerate(tokens):
        by_line[tk["line"]].append(k)

    # 幻觉过滤：如果某句的匹配词时间跨度超过 5 秒，说明 ASR 在这段在幻觉
    # （听到重复节奏型就输出 "no no no" 或 "toca toca toca"，词对但时间错），
    # 或者 DTW 把词铺到了间奏里。丢掉后让 fill() 按音节权重在句窗口开头铺开。
    MAX_LINE_SPAN = 5.0  # 流行歌里单句很少超过 5 秒，更长说明时间戳是幻觉
    for li, idx in enumerate(by_line):
        matched_spans = [(sp["s"], sp["e"]) for k in idx if (sp := spans[k]).get("s") is not None]
        if len(matched_spans) < len(idx) * 0.5:
            continue  # 大部分词没匹配，不算幻觉
        wlo = min(s for s, e in matched_spans)
        whi = max(e for s, e in matched_spans)
        span_dur = whi - wlo
        if span_dur > MAX_LINE_SPAN:
            for k in idx:
                spans[k] = {}

    def fill(i: int, j: int, wlo: float, whi: float, force: bool = False) -> None:
        """把 [i,j) 这段连续未对齐的 token 铺进本句窗口，按音节权重分界并吸附乐句点。
        force=True 时无视句外证据、整段按本句窗口铺（证据互相打架时的兜底）"""
        cnt = j - i
        syl = [max(1, tokens[k]["syl"]) for k in range(i, j)]
        total = float(sum(syl))
        natural = max(0.3, SYL_SEC * total)

        prev_end = spans[i - 1]["e"] if i > 0 and spans[i - 1].get("e") is not None else None
        next_start = spans[j]["s"] if j < n and spans[j].get("s") is not None else None
        same_before = i > 0 and tokens[i - 1]["line"] == tokens[i]["line"]
        same_after = j < n and tokens[j]["line"] == tokens[j - 1]["line"]
        # 句间有大段间奏时不要把词摊满整段静音
        # 窗口超大（>10s，通常是间奏）时，把词集中在开头自然唱速内，
        # 而不是摊到整个窗口——否则词会飘到下一句开始前的静音区
        window_dur = whi - wlo
        if window_dur > 10.0:
            idle = (wlo, min(whi, wlo + natural * 1.3))
        else:
            idle = (wlo, min(whi, wlo + natural * 2))

        if force:
            lo, hi = idle
        elif prev_end is not None and next_start is not None:
            if next_start - prev_end <= natural * 1.5:
                lo, hi = prev_end, next_start            # 空隙≈自然唱速：铺满
            elif same_before:
                lo, hi = prev_end, prev_end + natural    # 接在同句已对齐词之后
            elif same_after:
                lo, hi = next_start - natural, next_start  # 句首掉词：贴着后面有证据的词
            else:
                lo, hi = idle                            # 跨句大空隙 = 间奏
        elif prev_end is not None:
            lo, hi = prev_end, prev_end + natural
        elif next_start is not None:
            if window_dur > 10.0 and next_start - wlo > natural * 2:
                lo, hi = wlo, wlo + natural
            else:
                lo, hi = next_start - natural, next_start
        else:
            lo, hi = idle

        # 本句的显示窗口是硬边界。词排到窗口外，前端渲染出来就是这句一进来全亮、
        # 或者永远不亮 —— 两种都比退回句级擦除更糟
        lo = min(max(lo, wlo), whi)
        hi = min(max(hi, lo + MIN_WORD * cnt), whi)
        if hi - lo < MIN_WORD * cnt:                     # 窗口被两侧证据挤没了
            lo = max(wlo, hi - MIN_WORD * cnt)

        pk = _peaks(flux, hop_sec, lo - SNAP_WIN, hi + SNAP_WIN) if flux.size else []
        bounds = [lo]
        acc = 0.0
        for k in range(i, j):
            acc += syl[k - i]
            raw = lo + (hi - lo) * (acc / total)
            if pk:                       # 吸附到最近的乐句点：词界落在真实起音上才像卡拉OK
                cand = min(pk, key=lambda p: abs(p - raw))
                if abs(cand - raw) <= SNAP_WIN and cand > bounds[-1] + MIN_WORD:
                    raw = cand
            bounds.append(max(raw, bounds[-1] + MIN_WORD))
        bounds[-1] = max(bounds[-1], hi)
        for k in range(i, j):
            spans[k] = {"s": round(bounds[k - i], 3), "e": round(bounds[k - i + 1], 3), "how": "est"}

    for li, idx in enumerate(by_line):
        if not idx:
            continue
        wlo, whi = wins[li]

        # 匹配上了但整段落在本句窗口外的词：这份证据不属于这一句（约束带允许 ±3s，
        # 咬到邻句很常见）。留着它，出口守卫会把它夹到窗口边界上，连带把相邻的词
        # 压成一串零长词 —— 高亮一闪就过，比按自然唱速插值出来更难用。
        # 当成未匹配丢掉，交给下面的插值重铺（词界照样吸附真实乐句点）。
        for k in idx:
            sp = spans[k]
            if sp.get("s") is not None and (sp["s"] >= whi or sp["e"] <= wlo):
                spans[k] = {}

        p = 0
        while p < len(idx):
            if spans[idx[p]].get("s") is not None:
                p += 1
                continue
            q = p
            while q < len(idx) and spans[idx[q]].get("s") is None:
                q += 1
            fill(idx[p], idx[q - 1] + 1, wlo, whi)
            p = q

        # 整句兜底：句内证据互相打架时（匹配到的词全挤在句首半秒里，剩下的无处可去），
        # 逐段插值会把整句压成一串零长词 —— 高亮一闪就过，比不给词级数据更难用。
        # 这时放弃句内证据，按音节权重把整句重铺进本句窗口，词界照样吸附真实乐句点。
        a, b = idx[0], idx[-1]
        span = spans[b]["e"] - spans[a]["s"]
        natural = max(0.3, SYL_SEC * sum(max(1, tokens[k]["syl"]) for k in idx))
        if span < max(MIN_WORD * len(idx), natural * 0.4):
            for k in idx:
                spans[k] = {}
            fill(a, b + 1, wlo, whi, force=True)

    # 时序契约（逐句）：s 单调不减、s_k <= e_k <= s_{k+1}（允许零长词）。
    # 起点只修正 ASR 给出的几十毫秒级倒序，不做旧代码那种整词顶推（那会累积滞后）。
    # 只在句内修：跨句强推会让本句刚按自然唱速铺好的词，被邻句那些落在窗口外、
    # 马上要被出口守卫丢掉的词挤成一坨零长词。句间先后由句时间戳保证，
    # 前端也是一句一句渲染的，词时间不需要跨句单调。
    def mono(idx: list[int]) -> None:
        for p in range(1, len(idx)):
            k, prev = idx[p], idx[p - 1]
            if spans[k]["s"] < spans[prev]["s"]:
                spans[k]["s"] = spans[prev]["s"]
            if spans[prev]["e"] > spans[k]["s"]:
                spans[prev]["e"] = spans[k]["s"]
        for k in idx:
            if spans[k]["e"] < spans[k]["s"]:
                spans[k]["e"] = spans[k]["s"]

    for idx in by_line:
        mono(idx)

    # 零长词重铺：DTW 把连续几个 token 咬到同一个瞬间（whisper 幻觉重复段常见），
    # 上面的单调修复就把它们全压成零长。契约上合法，但渲染出来是几个词同时亮起、
    # 不是一个接一个跟着唱 —— 卡拉OK效果就断在这儿。
    # 只重铺这段零长词是没用的：它左右邻词的时间戳正是把它挤扁的原因，缝里一点空间都没有
    # （实测 gap 0.00-0.26s，需要 0.08-0.32s）。所以把区间向外扩，连同造成挤压的邻词
    # 一起按音节权重重铺，直到每个词都放得下 MIN_WORD。
    for li, idx in enumerate(by_line):
        wlo, whi = wins[li]
        m = len(idx)

        def bounds(a: int, b: int) -> tuple[float, float]:
            lo = spans[idx[a - 1]]["e"] if a > 0 else wlo
            if b < m:
                hi = spans[idx[b]]["s"]
            else:
                # 扩到句尾就用这句自己的证据终点收口，别铺到显示窗口末尾 ——
                # 否则高亮会爬过真实唱腔、一直爬到下一句开口
                hi = min(whi, max((spans[k]["e"] for k in idx[a:b]), default=lo))
            return lo, hi

        p = 0
        while p < m:
            if spans[idx[p]]["e"] - spans[idx[p]]["s"] >= MIN_WORD:
                p += 1
                continue
            q = p
            while q < m and spans[idx[q]]["e"] - spans[idx[q]]["s"] < MIN_WORD:
                q += 1
            a, b = p, q
            while True:
                lo, hi = bounds(a, b)
                if hi - lo + 1e-9 >= MIN_WORD * (b - a):
                    break
                if b < m:
                    b += 1
                elif a > 0:
                    a -= 1
                else:
                    lo = hi = None            # 整句都铺不下：零长才是诚实的答案
                    break
            p = q
            if lo is None:
                continue
            for k in idx[a:b]:
                spans[k] = {}
            fill(idx[a], idx[b - 1] + 1, lo, hi)
            mono(idx)

    out: list[dict] = []
    for li, line in enumerate(lines):
        idx = by_line[li]
        text = line.get("text") or ""
        t_in = round(float(line.get("time") or 0.0), 3)
        if not idx:
            out.append({"i": li, "s": t_in, "se": None, "t": text, "w": []})
            continue
        # 前端 applyTimings 靠 s 判断「等结果的这段时间里歌词有没有被换掉」，
        # 所以 s 必须原样回传构建时的 lrclib 句时间；词时间是音频域的，
        # 两个域靠结果里的 offset 换算，前端渲染时把句时间平移到音频域
        out.append({"i": li, "s": t_in, "se": None, "t": text,
                    "w": [[spans[k]["s"], spans[k]["e"], tokens[k]["t"]] for k in idx]})

    # 出口守卫：词必须落在本句的音频域显示窗口里。落不进去说明这句基本没咬到证据、
    # 时间是插值硬凑的（DTW 带允许 ±3s，插值还可能更远），前端照着渲染就是
    # 这句一进来全亮、或者永远不亮 —— 比不给词级数据更糟，整句丢掉退回句级擦除。
    # 只裁也不行：token 拼接必须严格等于原句，少一个词前端整句作废。
    for k, row in enumerate(out):
        if not row["w"]:
            continue
        wlo, whi = wins[k]
        w0, wn = row["w"][0][0], row["w"][-1][1]
        overlap = min(wn, whi) - max(w0, wlo)
        if overlap < 0.5 * min(wn - w0, whi - wlo):
            row["w"] = []
            continue
        for cell in row["w"]:                 # 夹取是单调映射，时序契约不会被破坏
            cell[0] = round(min(max(cell[0], wlo), whi), 3)
            cell[1] = round(min(max(cell[1], cell[0]), whi), 3)
        row["se"] = round(max(c[1] for c in row["w"]), 3)
    return out


# ---------------------------------------------------------------- 主入口

def align_multi(passes: list[dict], lines: list[dict], wav: np.ndarray | None = None,
                model: str = "", duration: float = 0.0) -> dict:
    """多语种混合歌：passes = [{'lang': 'en'|'es'|…, 'asr': <ASR结果>}, …]，每趟一个语种。
    合并所有趟的词并打上语种标签，>1 趟时启用 DTW 语种掩码，
    使英文行只咬英文趟的词、西语行只咬西语趟的词（whisper 单趟只认一种语种）。"""
    tokens = tokenize(lines)
    if not tokens:
        raise ValueError("歌词为空")

    merged: list[dict] = []
    langs: list[str] = []
    loops = 0
    for p in passes:
        words, lang, seg_loops = clean_asr(p.get("asr") or {})
        loops += seg_loops
        pl = p.get("lang") or lang or ""
        if pl and pl not in langs:
            langs.append(pl)
        for w in words:
            w["plang"] = pl
        merged.extend(words)
    merged.sort(key=lambda w: w["s"])
    if not merged:
        raise ValueError("ASR 未识别出任何词")

    duration = duration or merged[-1]["e"]
    line_langs = [guess_lang(l.get("text") or "") for l in lines]
    tok_lang = [line_langs[t["line"]] for t in tokens]
    word_lang = [w["plang"] for w in merged]
    use_mask = len(passes) > 1

    offset = _estimate_offset(tokens, merged, lines, duration)
    bands = _bands(tokens, lines, duration, offset)
    matches = dtw_align(tokens, merged, bands,
                        tok_lang if use_mask else None,
                        word_lang if use_mask else None)
    matched = sum(1 for m in matches if m)

    hop_sec = 160 / 16000
    flux = np.array([])
    if wav is not None and wav.size:
        flux, _ = onsets(np.asarray(wav, dtype=np.float32))
    out_lines = refine(tokens, matches, lines, flux, hop_sec, duration, offset)

    return {
        "v": 1,
        "model": model,
        "lang": langs[0] if langs else "",
        "langs": langs,
        "lineLangs": line_langs,
        "matchRatio": round(matched / len(tokens), 3),
        "textSim": round(text_sim(merged, tokens), 3),
        "offset": round(offset, 2),
        "duration": round(duration, 3),
        "asrWords": len(merged),
        "loops": loops,
        "tokens": len(tokens),
        "lines": out_lines,
    }


def align(asr: dict, lines: list[dict], wav: np.ndarray | None = None,
          model: str = "", duration: float = 0.0) -> dict:
    """单趟便捷入口：lines = [{'text','time'}]（time 可为 0）→ 词级时间轴 + 一致性指标"""
    return align_multi([{"lang": None, "asr": asr}], lines, wav, model, duration)
