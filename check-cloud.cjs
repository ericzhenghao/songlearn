const https = require("https");
const URL = "https://bgdhsntgvsbgedxaebdg.supabase.co";
const KEY = "sb_publishable_bJ8XjE80w4yn0LRLePWXeg_V2DSGz6N";
function get(path) {
  return new Promise((res, rej) => {
    https.get(URL + path, { headers: { apikey: KEY, Authorization: "Bearer " + KEY, Accept: "application/json" } }, (r) => {
      let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res({ status: r.statusCode, body: d }));
    }).on("error", rej);
  });
}
(async () => {
  const rows = await get("/rest/v1/songlearn_shared?select=id,bin_id,title,artist,added_at&order=added_at.desc&limit=20");
  console.log("status:", rows.status);
  try { console.log("云端歌曲:", rows.body); } catch { console.log(rows.body.slice(0,500)); }
})();
