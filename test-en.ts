import { getIpa } from "./src/lib/phonetics";
const words = [
  ["love", "en"], ["never", "en"], ["enough", "en"], ["baby", "en"],
  ["heart", "en"], ["always", "en"], ["forever", "en"], ["tonight", "en"],
  ["despacito", "es"], ["suavecito", "es"], ["bailando", "es"], ["corazón", "es"],
];
(async () => {
  for (const [w, l] of words) {
    const ipa = await getIpa(w, l);
    console.log(w.padEnd(12), "[" + l + "]", "→", ipa);
  }
})();
