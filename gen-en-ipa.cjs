// 英文歌词常用词音标内置表生成脚本（node 端抓有道，浏览器端免网络直接可用）
const https = require("https");
const fs = require("fs");

const WORDS = `the you i to and a in that it of me my your love heart never always night day time baby want need feel know say go come see think give take make way back mind eyes life world now just all can will would could should like one two three good bad right wrong home stay leave run walk talk hear look found lost found keep hold touch kiss real dream song music dance sing play soul true tell show call cry smile laugh sit stand wait start stop begin end again still even ever forever young old new long short high low deep fast slow far near warm cold hot free strong soft sweet bitter dark bright black white red blue green yellow small big great little much more most some any every other first last next same own such only very well really just almost maybe perhaps probably together alone tonight tomorrow yesterday today never always sometimes often ready easy hard happy sad angry afraid tired hungry thirsty sleep wake born die live dead`.split(/\s+/);

function get(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Referer": "https://dict.youdao.com/",
        "Accept": "application/json",
      },
    }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res(d));
    });
    req.on("error", rej);
    req.setTimeout(10000, () => { req.destroy(new Error("timeout")); });
  });
}

async function fetchIpa(w) {
  try {
    const raw = await get("https://dict.youdao.com/jsonapi?q=" + encodeURIComponent(w));
    const j = JSON.parse(raw);
    const s = j.simple?.word?.[0];
    const ipa = s?.usphone || s?.ukphone;
    return typeof ipa === "string" && ipa.trim() ? ipa.trim() : null;
  } catch {
    return null;
  }
}

(async () => {
  const out = {};
  const uniq = [...new Set(WORDS)];
  let done = 0, hit = 0;
  // 并发 6
  const pool = [];
  for (let i = 0; i < uniq.length; i += 6) {
    const batch = uniq.slice(i, i + 6);
    pool.push(Promise.all(batch.map(async (w) => {
      const ipa = await fetchIpa(w);
      done++;
      if (ipa) { out[w] = ipa; hit++; }
      process.stdout.write(`\r${done}/${uniq.length} hit=${hit}`);
    })));
  }
  await Promise.all(pool);
  console.log("");
  const json = JSON.stringify(out);
  fs.writeFileSync("src/data/en-ipa.json", json, "utf8");
  console.log("共", Object.keys(out).length, "词，写入 src/data/en-ipa.json，", (json.length / 1024).toFixed(1), "KB");
})().catch((e) => { console.error(e); process.exit(1); });
