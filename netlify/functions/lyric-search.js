/**
 * 歌词内容搜索代理（Netlify Functions）。
 * 浏览器无法直连 QQ 音乐搜索接口（CORS 拦截），由本函数在服务端代搜：
 * 输入 ASR 识别出的歌词片段，返回可能的 { title, artist } 候选，
 * 前端再用 lrclib 取词 + ASR 文本相似度验证，选出真实歌词。
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchJSON(url, headers, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    const txt = await res.text();
    return { ok: res.ok, text: txt, status: res.status };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  const params = new URLSearchParams(event.rawQuery || "");
  const q = (params.get("q") || "").trim();
  if (!q) {
    return { statusCode: 400, body: JSON.stringify({ error: "missing q" }) };
  }

  const sources = [];
  const debug = [];

  // 1) QQ 音乐：w 参数支持按歌词内容匹配
  {
    const url =
      "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?" +
      new URLSearchParams({ w: q, format: "json", n: "10", p: "1" }).toString();
    const r = await fetchJSON(url, { "User-Agent": UA, Referer: "https://y.qq.com/" });
    if (r.ok) {
      try {
        const j = JSON.parse(r.text);
        const list = j?.data?.song?.list || [];
        debug.push(`qq:${list.length}`);
        for (const s of list) {
          sources.push({
            title: s.songname || "",
            artist: ((s.singer || []).map((x) => x.name || "").filter(Boolean) || []).join(", "),
          });
        }
      } catch {
        debug.push(`qq:badjson(${r.text.slice(0, 40)})`);
      }
    } else {
      debug.push(`qq:fail(${r.error || r.status})`);
    }
  }

  // 2) 网易云音乐搜索（也支持歌词片段）
  {
    const url =
      "https://music.163.com/api/search/get/web?" +
      new URLSearchParams({ s: q, type: "1", limit: "10", offset: "0" }).toString();
    const r = await fetchJSON(url, { "User-Agent": UA, Referer: "https://music.163.com/" });
    if (r.ok) {
      try {
        const j = JSON.parse(r.text);
        const list = j?.result?.songs || [];
        debug.push(`163:${list.length}`);
        for (const s of list) {
          sources.push({
            title: s.name || "",
            artist: ((s.artists || []).map((x) => x.name || "").filter(Boolean) || []).join(", "),
          });
        }
      } catch {
        debug.push(`163:badjson(${r.text.slice(0, 40)})`);
      }
    } else {
      debug.push(`163:fail(${r.error || r.status})`);
    }
  }

  // 3) Genius 歌词库（海外节点稳定；搜索结果可匹配歌词内容）
  {
    const url =
      "https://genius.com/api/search/multi?per_page=5&q=" +
      encodeURIComponent(q);
    const r = await fetchJSON(url, { "User-Agent": UA }, 8000);
    if (r.ok) {
      try {
        const j = JSON.parse(r.text);
        const secs = j?.response?.sections || [];
        let n = 0;
        for (const sec of secs) {
          for (const h of sec?.hits || []) {
            const res = h?.result;
            if (!res?.title) continue;
            n++;
            sources.push({
              title: res.title || "",
              artist: res.primary_artist?.name || "",
            });
          }
        }
        debug.push(`genius:${n}`);
      } catch {
        debug.push(`genius:badjson(${r.text.slice(0, 40)})`);
      }
    } else {
      debug.push(`genius:fail(${r.error || r.status})`);
    }
  }

  // 4) SongLyrics（WordPress 站内搜索，支持歌词全文；海外可访问）
  {
    const url = "https://www.songlyrics.com/?s=" + encodeURIComponent(q);
    const r = await fetchJSON(url, { "User-Agent": UA }, 8000);
    if (r.ok) {
      try {
        // 结果条目：<div class="search-item"><a href="...">歌词片段</a></div> 或 li 列表
        const titles = [...r.text.matchAll(/class="title"[^>]*>\s*<a[^>]*>([^<]+)</g)]
          .map((m) => m[1].trim())
          .filter((t) => t && t.length < 80);
        const alts = [...r.text.matchAll(/<a[^>]*href="https:\/\/www\.songlyrics\.com\/[a-z0-9-]+\/"[^>]*>([^<]{2,60})<\/a>/g)]
          .map((m) => m[1].trim())
          .filter((t) => t && t.length < 60 && !/^\/|^javascript/i.test(t));
        const names = [...new Set([...titles, ...alts])].slice(0, 10);
        debug.push(`songlyrics:${names.length}`);
        for (const t of names) {
          // "歌名 - 歌手 歌词" 或 "歌名 歌词"
          let title = t.replace(/\s*歌词\s*$/i, "").replace(/\s*lyrics?\s*$/i, "").trim();
          let artist = "";
          const dash = title.split(/\s+-\s+/);
          if (dash.length > 1) {
            artist = dash.slice(1).join(" - ").trim();
            title = dash[0].trim();
          }
          if (title) sources.push({ title, artist });
        }
      } catch {
        debug.push(`songlyrics:parsefail`);
      }
    } else {
      debug.push(`songlyrics:fail(${r.error || r.status})`);
    }
  }

  // 5) AzLyrics 搜索（海外可访问）
  {
    const url = "https://search.azlyrics.com/search.php?" + new URLSearchParams({ q }).toString();
    const r = await fetchJSON(url, { "User-Agent": UA }, 8000);
    if (r.ok) {
      try {
        const names = [...r.text.matchAll(/<a[^>]*href="https:\/\/www\.azlyrics\.com\/lyrics\/[^"]+"[^>]*>\s*([^<]{2,60})\s*<\/a>/g)]
          .map((m) => m[1].trim())
          .filter((t) => t && t.length < 60);
        const uniqNames = [...new Set(names)].slice(0, 10);
        debug.push(`azlyrics:${uniqNames.length}`);
        for (const t of uniqNames) {
          let title = t.replace(/\s*"LRC" LYRICS\s*$/i, "").replace(/\s*LYRICS\s*$/i, "").trim();
          let artist = "";
          const dash = title.split(/\s+-\s+/);
          if (dash.length > 1) {
            artist = dash.slice(1).join(" - ").trim();
            title = dash[0].trim();
          }
          if (title) sources.push({ title, artist });
        }
      } catch {
        debug.push(`azlyrics:parsefail`);
      }
    } else {
      debug.push(`azlyrics:fail(${r.error || r.status})`);
    }
  }

  // 去重（title+artist 同键）
  const seen = new Set();
  const uniq = sources.filter((s) => {
    if (!s.title) return false;
    const k = s.title.toLowerCase() + "||" + s.artist.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ candidates: uniq.slice(0, 10), debug }),
  };
};
