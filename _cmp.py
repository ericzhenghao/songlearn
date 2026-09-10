# -*- coding: utf-8 -*-
import json, re
d = json.load(open(r'C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\_lrclib.json', encoding='utf-8'))
def stamp(ln):
    m = re.match(r'\[(\d+):(\d+(?:\.\d+)?)\]', ln)
    return (int(m.group(1))*60 + float(m.group(2))) if m else None
for idx in (2, 5):
    s = d[idx]
    lrc = s.get('syncedLyrics') or ''
    lines = lrc.splitlines()
    print('===== #%d %s dur=%s lines=%d =====' % (idx, s.get('trackName'), s.get('duration'), len(lines)))
    for j, ln in enumerate(lines):
        t = stamp(ln)
        if t is not None and (t < 40 or (125 < t < 155) or t > 190 or j < 2):
            print('%03d %s' % (j, ln))
    print('---')
