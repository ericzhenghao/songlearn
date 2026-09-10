# -*- coding: utf-8 -*-
"""按小窗实测证据修正 3 首歌 LRC：
- Despacito: 03:25.68 Pasito → 03:24.50
- Sofia: 删 [00:00.26]；39.69 → 37.20；02:24.26 → 02:20.20
- Toca Toca: 整体重建（小窗词级时间轴）"""
import json

p = r'C:\Users\ericz\Doubao\chats\2026-08-26\new-chat\songlearnV2\src\data\library.json'
lib = json.load(open(p, encoding='utf-8'))

# --- Despacito ---
for s in lib:
    if s['title'] == 'Despacito':
        old = '[03:25.68]Pasito a pasito, suave suavecito'
        new = '[03:24.50]Pasito a pasito, suave suavecito'
        assert old in s['lrc'], 'despacito line not found'
        s['lrc'] = s['lrc'].replace(old, new)
        print('Despacito: Pasito 03:25.68 → 03:24.50')

# --- Sofia ---
for s in lib:
    if s['title'] == 'Sofia':
        lrc = s['lrc']
        # 删前奏哼唱
        assert '[00:00.26](¡Eh!)' in lrc
        lrc = lrc.replace('[00:00.26](¡Eh!)\n', '')
        # 39.69 → 37.20
        assert '[00:39.69]Mira, Sofía (¡eh!)' in lrc
        lrc = lrc.replace('[00:39.69]Mira, Sofía (¡eh!)', '[00:37.20]Mira, Sofía (¡eh!)')
        # 02:24.26 → 02:20.20
        assert '[02:24.26]¿Y por qué no me dices la verdad?' in lrc
        lrc = lrc.replace('[02:24.26]¿Y por qué no me dices la verdad?', '[02:20.20]¿Y por qué no me dices la verdad?')
        s['lrc'] = lrc
        print('Sofia: 删前奏哼唱 / 39.69→37.20 / 144.26→140.20')

# --- Toca Toca 重建 ---
new_toca = """[ti:Toca Toca]
[ar:Fly Project]
[al:Toca Toca]
[00:07.10][00:10.30]Oh, you say: "No, no, no," I say: "No, no, no, no, no"
[00:11.21][00:13.89]You say: "Take me home," I say: "Dom Pérignon"
[00:14.02][00:18.12]You say: "No, no, no," I say: "No, no, no, no, no, no, no"
[00:19.45][00:21.00]No, no, no, no, no, no
[00:22.05][00:26.50]Hasta la vida loca, loca, loca, loca
[00:26.69][00:29.00]Te encanta la música, te toca, toca, toca
[00:29.92][00:33.00]Hasta la vida loca, loca, loca, loca
[00:34.00][00:36.41]Te encanta la música, te toca, toca, toca
[00:52.16][00:55.44]Oh, I wanna see rain on me forever
[00:55.71][00:59.10]Rivers of champagne, celebrate together
[01:01.26][01:03.76]Oh, I wanna see rain on me forever
[01:06.00][01:07.10]Rivers of champagne, celebrate together
[01:14.21][01:16.30]Te encanta la música, te toca, toca, toca
[01:22.00][01:25.94]Hasta la vida loca, loca, loca, loca
[01:31.90][01:35.66]Te encanta la música, te toca, toca, toca
[01:36.93][01:40.00]I see your eyes, every day and every night
[01:40.00][01:43.86]And I, I wanna hold you, till the end of time
[01:44.00][01:47.72]Stay overnight, 'cause I want you in my life
[01:48.00][01:51.48]And I, I wanna love you, I will never make you cry
[01:57.49][02:00.03]Te encanta la música, te toca, toca, toca
[02:01.93][02:04.00]Hasta la vida loca, loca, loca, loca
[02:05.78][02:07.90]Te encanta la música, te toca, toca, toca
[02:14.26][02:15.80]Hasta la vida loca, loca, loca, loca
[02:17.43][02:19.40]Toca, toca, toca"""
for s in lib:
    if s['title'] == 'Toca Toca':
        s['lrc'] = new_toca
        print('Toca Toca: 重建 %d 行' % len(new_toca.splitlines()))

json.dump(lib, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('全部写入完成')
