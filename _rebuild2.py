# -*- coding: utf-8 -*-
"""Waka Waka LRC 最终重建 v2：
- 0-131.26s 保持已验证（whisper 全曲 + 人声轨双重确认）
- 131.26s 后按人声轨小窗 + 能量乐句 + 官方歌词重建"""
import json

p = r'C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\src\data\library.json'
lib = json.load(open(p, encoding='utf-8'))
song = next(s for s in lib if s['title'].startswith('Waka Waka'))
lrc = song['lrc']

# 找到 131.26 之后的部分（从 [02:11.26] 开始到结尾）
i = lrc.find('[02:11.26]')
assert i > 0
head = lrc[:i]

tail_lines = [
    # 祖鲁段（人声轨实证：Bathi 为 5.6s 长句，无 waka waka ma 两行）
    ('02:11.44', '02:13.22', 'Awela majoni biggie biggie mamma one A to zet'),
    ('02:13.46', '02:19.06', 'Bathi tsu zala majoni biggie biggie mamma from East to West'),
    ('02:19.06', '02:22.90', 'Zonke zizwe mazi buye'),
    ('02:23.10', '02:25.74', "'Cause this is Africa"),
    # 过渡 + 副歌3（人声轨小窗：Sambinamina×3 / Anawa / Tsamina...）
    ('02:26.20', '02:28.60', 'Tsamina mina, anawa ah ah'),
    ('02:28.80', '02:30.00', 'Tsamina mina'),
    ('02:30.20', '02:33.20', 'Tsamina mina, anawa ah ah'),
    ('02:34.30', '02:35.50', 'Tsamina mina zangalewa'),
    ('02:36.30', '02:37.30', 'Tsamina mina, eh eh'),
    ('02:38.08', '02:39.10', 'Waka waka, eh eh'),
    ('02:39.90', '02:44.20', 'Anawa ah ah'),
    ('02:45.50', '02:47.16', 'Tsamina mina zangalewa'),
    ('02:47.16', '02:48.72', 'Anawa ah ah'),
    ('02:48.72', '02:49.36', 'Tsamina mina'),
    ('02:49.08', '02:50.94', 'Tsamina mina, eh eh'),
    ('02:51.34', '02:52.22', 'Waka waka, eh eh'),
    ('02:53.16', '02:54.76', 'Tsamina mina zangalewa'),
    ('02:55.18', '02:56.06', 'Porque esto es África'),
    # 尾部（small 全曲实证）
    ('02:56.50', '02:58.42', 'Django, eh eh'),
    ('02:58.84', '03:00.34', 'Django, eh eh'),
    ('03:00.72', '03:02.60', 'Tsamina mina zangalewa'),
    ('03:02.60', '03:04.26', 'Anawa ah ah'),
    ('03:04.56', '03:05.96', 'Django, eh eh'),
    ('03:06.40', '03:07.94', 'Django, eh eh'),
    ('03:08.28', '03:10.16', 'Tsamina mina zangalewa'),
    ('03:10.16', '03:12.04', 'Anawa ah ah'),
    ('03:13.88', '03:15.44', 'Porque esto es África'),
    ('03:17.70', '03:19.46', 'This time for Africa'),
    ('03:21.36', '03:22.80', "We're all Africa"),
    ('03:25.40', '03:26.62', "We're all Africa"),
]
tail = "\n".join('[%s][%s]%s' % (s, e, t) for s, e, t in tail_lines)
song['lrc'] = head + tail
json.dump(lib, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# 统计
rows = song['lrc'].splitlines()
print('Waka LRC 重建 v2 完成：共 %d 行' % len(rows))
for r in rows:
    print(r)
