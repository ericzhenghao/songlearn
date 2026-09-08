import { esToIpa } from "./src/lib/phonetics";
const words = [
  "hola", "adiós", "gracias", "despacito", "belleza", "corazón",
  "niño", "cantar", "bailar", "suave", "muchacho", "llorar",
  "qué", "quién", "guerra", "güero", "mujer", "casa", "zapato",
  "radio", "perro", "pero", "España", "mano", "verde", "dame",
];
for (const w of words) {
  console.log(w.padEnd(12), "→", esToIpa(w));
}
