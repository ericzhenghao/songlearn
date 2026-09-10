/**
 * 逐词发音标注：按语言给每个歌词词生成中文音译。
 *
 * 设计思路：
 *  - 对拼读规则清晰的语言（西/葡/意/德/法），用字母到发音的映射表生成音译
 *  - 对英语这类不规则语言，用常见规则 + 兜底（辅音直接对应，元音给近似）
 *  - 音译用最接近的中文音节，目标是"唱的时候看到就能读对"
 */

type LangMap = {
  /** 单字符到中文发音的映射（按出现顺序匹配，前面优先） */
  rules: { pattern: RegExp; sound: string }[];
  /** 词尾常见哑音处理 */
  finalSilent?: RegExp;
  /** 默认元音发音 */
  vowels: Record<string, string>;
};

/* ========== 西班牙语 ========== */
const ES: LangMap = {
  vowels: { a: "阿", e: "埃", i: "伊", o: "欧", u: "乌" },
  rules: [
    /* 长组合优先 */
    { pattern: /ñ/g, sound: "尼亚" },
    { pattern: /ll/g, sound: "呀" },
    { pattern: /gue/g, sound: "给" },           // gue = 给（u不发音）
    { pattern: /gui/g, sound: "吉" },
    { pattern: /que/g, sound: "凯" },
    { pattern: /qui/g, sound: "基" },
    { pattern: /ch/g, sound: "切" },
    { pattern: /je/g, sound: "赫" },            // j/g 在 e/i 前 = 喉音
    { pattern: /ji/g, sound: "希" },
    { pattern: /ge/g, sound: "赫" },
    { pattern: /gi/g, sound: "希" },
    { pattern: /jo/g, sound: "霍" },            // j/g 在 a/o/u 前 = 软 g
    { pattern: /ja/g, sound: "哈" },
    { pattern: /ju/g, sound: "胡" },
    { pattern: /ca/g, sound: "卡" },            // c+a/o/u = 硬 k
    { pattern: /co/g, sound: "科" },
    { pattern: /cu/g, sound: "库" },
    { pattern: /ce/g, sound: "塞" },            // c+e/i = 读 s
    { pattern: /ci/g, sound: "西" },
    { pattern: /z/g, sound: "斯" },             // z = 读 s
    { pattern: /rr/g, sound: "拉" },            // rr 弹舌
    { pattern: /^r/g, sound: "拉" },             // 词首 r 弹舌
    { pattern: /\by/g, sound: "伊" },           // 词首 y = 伊
    { pattern: /[aeiou]y[aeiou]/g, sound: "呀" }, // 元音间 y = 呀
    { pattern: /[aeiou]y$/g, sound: "伊" },     // 词尾 y = 伊
    /* 单字母辅音 */
    { pattern: /h/g, sound: "" },                // h 哑
    { pattern: /v/g, sound: "贝" },              // v = 贝（像 b）
    { pattern: /b/g, sound: "贝" },
    { pattern: /p/g, sound: "佩" },
    { pattern: /m/g, sound: "梅" },
    { pattern: /n/g, sound: "内" },
    { pattern: /f/g, sound: "费" },
    { pattern: /d/g, sound: "德" },
    { pattern: /t/g, sound: "特" },
    { pattern: /l/g, sound: "勒" },
    { pattern: /s/g, sound: "斯" },
    { pattern: /c/g, sound: "克" },              // 兜底 c (在 ca/ce 等没匹配到时)
    { pattern: /g/g, sound: "格" },              // 兜底 g
    { pattern: /q/g, sound: "克" },
    { pattern: /r/g, sound: "勒" },
    /* 元音兜底 */
    { pattern: /á/g, sound: "阿" },
    { pattern: /é/g, sound: "埃" },
    { pattern: /í/g, sound: "伊" },
    { pattern: /ó/g, sound: "欧" },
    { pattern: /ú/g, sound: "乌" },
    { pattern: /u/g, sound: "乌" },
    { pattern: /i/g, sound: "伊" },
    { pattern: /o/g, sound: "欧" },
    { pattern: /e/g, sound: "埃" },
    { pattern: /a/g, sound: "阿" },
    { pattern: /y/g, sound: "伊" },               // 兜底 y
  ],
};

/* ========== 英语（简化版） ========== */
const EN: LangMap = {
  vowels: { a: "艾", e: "埃", i: "伊", o: "欧", u: "阿" },
  rules: [
    { pattern: /ough/g, sound: "奥" },        // though=叟, enough=那夫, thought=索特
    { pattern: /ough/g, sound: "乌" },        // through
    { pattern: /igh/g, sound: "爱" },          // high, light
    { pattern: /tion/g, sound: "申" },         // action = 阿克申
    { pattern: /sion/g, sound: "申" },
    { pattern: /che/g, sound: "奇" },          // machine
    { pattern: /che$/g, sound: "奇" },
    { pattern: /th/g, sound: "思" },           // think=辛克, this=西斯（简化为思）
    { pattern: /ph/g, sound: "夫" },           // phone=佛恩
    { pattern: /kn/g, sound: "尼" },           // knife=奈夫（k哑）
    { pattern: /wh/g, sound: "乌" },           // what=沃特（简化）
    { pattern: /ch/g, sound: "奇" },            // child=柴尔德
    { pattern: /sh/g, sound: "师" },            // she=西
    { pattern: /^[aeiou]/g, sound: "伊" },     // 词首元音前加 y
    { pattern: /[aeiou][a-z]*[aeiou]/g, sound: "" }, // 保留元音
    { pattern: /r/g, sound: "尔" },             // 美音卷舌
    { pattern: /d/g, sound: "德" },
    { pattern: /t/g, sound: "特" },
    { pattern: /s/g, sound: "斯" },
    { pattern: /m/g, sound: "姆" },
    { pattern: /n/g, sound: "恩" },
    { pattern: /l/g, sound: "勒" },
    { pattern: /p/g, sound: "普" },
    { pattern: /b/g, sound: "布" },
    { pattern: /f/g, sound: "夫" },
    { pattern: /g/g, sound: "格" },
    { pattern: /k/g, sound: "克" },
    { pattern: /v/g, sound: "屋" },
    { pattern: /w/g, sound: "乌" },
    { pattern: /y/g, sound: "伊" },
    { pattern: /z/g, sound: "兹" },
  ],
};

/* ========== 德语 ========== */
const DE: LangMap = {
  vowels: { a: "阿", e: "埃", i: "伊", o: "欧", u: "乌" },
  rules: [
    { pattern: /ä/g, sound: "埃" },
    { pattern: /ö/g, sound: "欧" },
    { pattern: /ü/g, sound: "于" },
    { pattern: /ß/g, sound: "斯" },
    { pattern: /sch/g, sound: "什" },
    { pattern: /tsch/g, sound: "奇" },
    { pattern: /ch/g, sound: "赫" },
    { pattern: /ei/g, sound: "爱" },
    { pattern: /ie/g, sound: "伊" },
    { pattern: /eu/g, sound: "奥伊" },
    { pattern: /au/g, sound: "奥" },
    { pattern: /st/g, sound: "什特" },
    { pattern: /sp/g, sound: "什普" },
    { pattern: /z/g, sound: "茨" },
    { pattern: /w/g, sound: "佛" },
    { pattern: /v/g, sound: "法" },
    { pattern: /r/g, sound: "勒" },
    { pattern: /l/g, sound: "勒" },
    { pattern: /s/g, sound: "斯" },
    { pattern: /d/g, sound: "德" },
    { pattern: /t/g, sound: "特" },
    { pattern: /m/g, sound: "姆" },
    { pattern: /n/g, sound: "恩" },
    { pattern: /p/g, sound: "普" },
    { pattern: /b/g, sound: "布" },
    { pattern: /f/g, sound: "夫" },
    { pattern: /g/g, sound: "格" },
    { pattern: /k/g, sound: "克" },
    { pattern: /h/g, sound: "赫" },
  ],
};

/* ========== 法语 ========== */
const FR: LangMap = {
  vowels: { a: "阿", e: "厄", i: "伊", o: "欧", u: "于" },
  rules: [
    { pattern: /é/g, sound: "埃" },
    { pattern: /è/g, sound: "埃" },
    { pattern: /ê/g, sound: "埃" },
    { pattern: /â/g, sound: "阿" },
    { pattern: /ô/g, sound: "欧" },
    { pattern: /î/g, sound: "伊" },
    { pattern: /û/g, sound: "乌" },
    { pattern: /ç/g, sound: "斯" },
    { pattern: /ch/g, sound: "什" },
    { pattern: /gn/g, sound: "尼" },
    { pattern: /ll/g, sound: "勒" },
    { pattern: /qu/g, sound: "克" },
    { pattern: /tion/g, sound: "斯永" },
    { pattern: /ent/g, sound: "昂" },
    { pattern: /e\b/g, sound: "厄" },
    { pattern: /r/g, sound: "勒" },
    { pattern: /l/g, sound: "勒" },
    { pattern: /s/g, sound: "斯" },
    { pattern: /d/g, sound: "德" },
    { pattern: /t/g, sound: "特" },
    { pattern: /m/g, sound: "姆" },
    { pattern: /n/g, sound: "恩" },
    { pattern: /p/g, sound: "普" },
    { pattern: /b/g, sound: "布" },
    { pattern: /f/g, sound: "夫" },
    { pattern: /g/g, sound: "格" },
    { pattern: /k/g, sound: "克" },
    { pattern: /v/g, sound: "屋" },
    { pattern: /j/g, sound: "吉" },
    { pattern: /h/g, sound: "" },
  ],
};

/* ========== 葡萄牙语 ========== */
const PT: LangMap = {
  vowels: { a: "阿", e: "埃", i: "伊", o: "欧", u: "乌" },
  rules: [
    { pattern: /ã/g, sound: "昂" },
    { pattern: /õ/g, sound: "欧" },
    { pattern: /â/g, sound: "阿" },
    { pattern: /ê/g, sound: "埃" },
    { pattern: /ô/g, sound: "欧" },
    { pattern: /ç/g, sound: "斯" },
    { pattern: /lh/g, sound: "利" },
    { pattern: /nh/g, sound: "尼" },
    { pattern: /ch/g, sound: "希" },
    { pattern: /rr/g, sound: "哈" },
    { pattern: /^r/g, sound: "哈" },
    { pattern: /z/g, sound: "斯" },
    { pattern: /s/g, sound: "斯" },
    { pattern: /d/g, sound: "德" },
    { pattern: /t/g, sound: "特" },
    { pattern: /m/g, sound: "姆" },
    { pattern: /n/g, sound: "恩" },
    { pattern: /p/g, sound: "普" },
    { pattern: /b/g, sound: "布" },
    { pattern: /f/g, sound: "夫" },
    { pattern: /g/g, sound: "格" },
    { pattern: /k/g, sound: "克" },
    { pattern: /v/g, sound: "屋" },
    { pattern: /h/g, sound: "" },
    { pattern: /l/g, sound: "勒" },
    { pattern: /r/g, sound: "勒" },
    { pattern: /j/g, sound: "热" },
  ],
};

/* ========== 意大利语 ========== */
const IT: LangMap = {
  vowels: { a: "阿", e: "埃", i: "伊", o: "欧", u: "乌" },
  rules: [
    { pattern: /è/g, sound: "埃" },
    { pattern: /é/g, sound: "埃" },
    { pattern: /à/g, sound: "阿" },
    { pattern: /ò/g, sound: "欧" },
    { pattern: /ì/g, sound: "伊" },
    { pattern: /ù/g, sound: "乌" },
    { pattern: /gn/g, sound: "尼" },
    { pattern: /gli/g, sound: "利" },
    { pattern: /ce/g, sound: "切" },
    { pattern: /ci/g, sound: "奇" },
    { pattern: /ge/g, sound: "杰" },
    { pattern: /gi/g, sound: "吉" },
    { pattern: /z/g, sound: "茨" },
    { pattern: /s/g, sound: "斯" },
    { pattern: /d/g, sound: "德" },
    { pattern: /t/g, sound: "特" },
    { pattern: /m/g, sound: "姆" },
    { pattern: /n/g, sound: "恩" },
    { pattern: /p/g, sound: "普" },
    { pattern: /b/g, sound: "布" },
    { pattern: /f/g, sound: "夫" },
    { pattern: /g/g, sound: "格" },
    { pattern: /c/g, sound: "克" },
    { pattern: /h/g, sound: "" },
    { pattern: /l/g, sound: "勒" },
    { pattern: /r/g, sound: "勒" },
    { pattern: /v/g, sound: "屋" },
  ],
};

const MAPS: Record<string, LangMap> = { es: ES, en: EN, de: DE, fr: FR, pt: PT, it: IT };

/** 给单个词生成中文音译 */
export function transliterate(word: string, lang: string | null | undefined): string {
  if (!word || !lang) return "";
  const map = MAPS[lang.toLowerCase()];
  if (!map) return "";

  let result = "";
  let i = 0;
  const lower = word.toLowerCase();

  while (i < lower.length) {
    let matched = false;
    /* 按规则表顺序匹配，优先长模式。用 exec() 而不是 match()：match() 带 g flag 时返回的数组没有 index 属性 */
    for (const rule of map.rules) {
      rule.pattern.lastIndex = 0;
      const m = rule.pattern.exec(lower.slice(i));
      if (m && m.index === 0 && m[0].length > 0) {
        result += rule.sound;
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      /* 没有匹配的规则 → 直接加原字符（标点、数字等） */
      result += lower[i];
      i += 1;
    }
  }

  /* 清理：去掉空结果，合并连续相同发音 */
  result = result.replace(/\+/g, "");
  /* 合并连续相同的中文音节（如"贝贝"→"贝"，避免 b-e-e 变成"贝埃"） */
  result = result.replace(/([\u4e00-\u9fff])\1+/g, "$1");
  return result;
}

/** 给一整行的词生成发音标注（每词一个中文音译） */
export function annotateLineWords(
  words: { t: string; s: number; e: number }[],
  lang: string | null | undefined
): { t: string; s: number; e: number; tip: string }[] {
  if (!lang) return words.map((w) => ({ ...w, tip: "" }));
  return words.map((w) => {
    const tip = transliterate(w.t.trim(), lang);
    return { ...w, tip };
  });
}

/* ========== 国际音标 (IPA) ========== */
type IpaMap = { rules: { pattern: RegExp; ipa: string }[] };

const IPA_ES: IpaMap = {
  rules: [
    { pattern: /ñ/g, ipa: "ɲ" },
    { pattern: /ll/g, ipa: "ʝ" },
    { pattern: /ch/g, ipa: "tʃ" },
    { pattern: /gue/g, ipa: "ɡe" },
    { pattern: /gui/g, ipa: "ɡi" },
    { pattern: /que/g, ipa: "ke" },
    { pattern: /qui/g, ipa: "ki" },
    { pattern: /ce/g, ipa: "θe" },
    { pattern: /ci/g, ipa: "θi" },
    { pattern: /ca/g, ipa: "ka" },
    { pattern: /co/g, ipa: "ko" },
    { pattern: /cu/g, ipa: "ku" },
    { pattern: /za/g, ipa: "θa" },
    { pattern: /ze/g, ipa: "θe" },
    { pattern: /zi/g, ipa: "θi" },
    { pattern: /zo/g, ipa: "θo" },
    { pattern: /zu/g, ipa: "θu" },
    { pattern: /ge/g, ipa: "xe" },
    { pattern: /gi/g, ipa: "xi" },
    { pattern: /je/g, ipa: "xe" },
    { pattern: /ji/g, ipa: "xi" },
    { pattern: /ja/g, ipa: "xa" },
    { pattern: /jo/g, ipa: "xo" },
    { pattern: /ju/g, ipa: "xu" },
    { pattern: /rr/g, ipa: "r" },
    { pattern: /^r/g, ipa: "r" },
    { pattern: /á/g, ipa: "a" },
    { pattern: /é/g, ipa: "e" },
    { pattern: /í/g, ipa: "i" },
    { pattern: /ó/g, ipa: "o" },
    { pattern: /ú/g, ipa: "u" },
    { pattern: /ü/g, ipa: "u" },
    { pattern: /a/g, ipa: "a" },
    { pattern: /e/g, ipa: "e" },
    { pattern: /i/g, ipa: "i" },
    { pattern: /o/g, ipa: "o" },
    { pattern: /u/g, ipa: "u" },
    { pattern: /h/g, ipa: "" },
    { pattern: /b/g, ipa: "β" },
    { pattern: /v/g, ipa: "β" },
    { pattern: /d/g, ipa: "d" },
    { pattern: /f/g, ipa: "f" },
    { pattern: /g/g, ipa: "ɡ" },
    { pattern: /k/g, ipa: "k" },
    { pattern: /l/g, ipa: "l" },
    { pattern: /m/g, ipa: "m" },
    { pattern: /n/g, ipa: "n" },
    { pattern: /p/g, ipa: "p" },
    { pattern: /r/g, ipa: "ɾ" },
    { pattern: /s/g, ipa: "s" },
    { pattern: /t/g, ipa: "t" },
    { pattern: /w/g, ipa: "w" },
    { pattern: /y/g, ipa: "i" },
    { pattern: /z/g, ipa: "θ" },
    { pattern: /c/g, ipa: "k" },
    { pattern: /j/g, ipa: "x" },
    { pattern: /q/g, ipa: "k" },
    { pattern: /x/g, ipa: "ks" },
  ],
};

const IPA_EN: IpaMap = {
  rules: [
    { pattern: /ough/g, ipa: "oʊ" },
    { pattern: /igh/g, ipa: "aɪ" },
    { pattern: /tion/g, ipa: "ʃən" },
    { pattern: /sion/g, ipa: "ʒən" },
    { pattern: /th/g, ipa: "θ" },
    { pattern: /sh/g, ipa: "ʃ" },
    { pattern: /ch/g, ipa: "tʃ" },
    { pattern: /ph/g, ipa: "f" },
    { pattern: /wh/g, ipa: "w" },
    { pattern: /kn/g, ipa: "n" },
    { pattern: /wr/g, ipa: "r" },
    { pattern: /mb$/g, ipa: "m" },
    { pattern: /a/g, ipa: "æ" },
    { pattern: /e/g, ipa: "ɛ" },
    { pattern: /i/g, ipa: "ɪ" },
    { pattern: /o/g, ipa: "oʊ" },
    { pattern: /u/g, ipa: "ʌ" },
    { pattern: /r/g, ipa: "ɹ" },
    { pattern: /s/g, ipa: "s" },
    { pattern: /t/g, ipa: "t" },
    { pattern: /d/g, ipa: "d" },
    { pattern: /k/g, ipa: "k" },
    { pattern: /g/g, ipa: "ɡ" },
    { pattern: /p/g, ipa: "p" },
    { pattern: /b/g, ipa: "b" },
    { pattern: /f/g, ipa: "f" },
    { pattern: /v/g, ipa: "v" },
    { pattern: /l/g, ipa: "l" },
    { pattern: /m/g, ipa: "m" },
    { pattern: /n/g, ipa: "n" },
    { pattern: /h/g, ipa: "h" },
    { pattern: /w/g, ipa: "w" },
    { pattern: /y/g, ipa: "j" },
    { pattern: /z/g, ipa: "z" },
    { pattern: /j/g, ipa: "dʒ" },
    { pattern: /c/g, ipa: "k" },
    { pattern: /x/g, ipa: "ks" },
    { pattern: /q/g, ipa: "k" },
  ],
};

const IPA_DE: IpaMap = {
  rules: [
    { pattern: /ä/g, ipa: "ɛ" },
    { pattern: /ö/g, ipa: "ø" },
    { pattern: /ü/g, ipa: "y" },
    { pattern: /ß/g, ipa: "s" },
    { pattern: /sch/g, ipa: "ʃ" },
    { pattern: /tsch/g, ipa: "tʃ" },
    { pattern: /ch/g, ipa: "ç" },
    { pattern: /ei/g, ipa: "aɪ" },
    { pattern: /ie/g, ipa: "iː" },
    { pattern: /eu/g, ipa: "ɔɪ" },
    { pattern: /au/g, ipa: "aʊ" },
    { pattern: /a/g, ipa: "a" },
    { pattern: /e/g, ipa: "ɛ" },
    { pattern: /i/g, ipa: "ɪ" },
    { pattern: /o/g, ipa: "ɔ" },
    { pattern: /u/g, ipa: "ʊ" },
    { pattern: /s/g, ipa: "z" },
    { pattern: /d/g, ipa: "d" },
    { pattern: /t/g, ipa: "t" },
    { pattern: /k/g, ipa: "k" },
    { pattern: /g/g, ipa: "ɡ" },
    { pattern: /p/g, ipa: "p" },
    { pattern: /b/g, ipa: "b" },
    { pattern: /f/g, ipa: "f" },
    { pattern: /v/g, ipa: "f" },
    { pattern: /w/g, ipa: "v" },
    { pattern: /l/g, ipa: "l" },
    { pattern: /m/g, ipa: "m" },
    { pattern: /n/g, ipa: "n" },
    { pattern: /r/g, ipa: "ʁ" },
    { pattern: /h/g, ipa: "h" },
    { pattern: /j/g, ipa: "j" },
    { pattern: /z/g, ipa: "ts" },
    { pattern: /x/g, ipa: "ks" },
  ],
};

const IPA_FR: IpaMap = {
  rules: [
    { pattern: /é/g, ipa: "e" },
    { pattern: /è/g, ipa: "ɛ" },
    { pattern: /ê/g, ipa: "ɛ" },
    { pattern: /â/g, ipa: "a" },
    { pattern: /ô/g, ipa: "o" },
    { pattern: /î/g, ipa: "i" },
    { pattern: /û/g, ipa: "y" },
    { pattern: /ç/g, ipa: "s" },
    { pattern: /ch/g, ipa: "ʃ" },
    { pattern: /gn/g, ipa: "ɲ" },
    { pattern: /ll/g, ipa: "l" },
    { pattern: /qu/g, ipa: "k" },
    { pattern: /tion/g, ipa: "sjɔ̃" },
    { pattern: /ent$/g, ipa: "" },
    { pattern: /a/g, ipa: "a" },
    { pattern: /e/g, ipa: "ə" },
    { pattern: /i/g, ipa: "i" },
    { pattern: /o/g, ipa: "o" },
    { pattern: /u/g, ipa: "y" },
    { pattern: /r/g, ipa: "ʁ" },
    { pattern: /s/g, ipa: "s" },
    { pattern: /d/g, ipa: "d" },
    { pattern: /t/g, ipa: "t" },
    { pattern: /k/g, ipa: "k" },
    { pattern: /g/g, ipa: "ɡ" },
    { pattern: /p/g, ipa: "p" },
    { pattern: /b/g, ipa: "b" },
    { pattern: /f/g, ipa: "f" },
    { pattern: /v/g, ipa: "v" },
    { pattern: /l/g, ipa: "l" },
    { pattern: /m/g, ipa: "m" },
    { pattern: /n/g, ipa: "n" },
    { pattern: /h/g, ipa: "" },
    { pattern: /j/g, ipa: "ʒ" },
    { pattern: /z/g, ipa: "z" },
    { pattern: /c/g, ipa: "s" },
    { pattern: /x/g, ipa: "ks" },
  ],
};

const IPA_PT: IpaMap = {
  rules: [
    { pattern: /ã/g, ipa: "ɐ̃" },
    { pattern: /õ/g, ipa: "õ" },
    { pattern: /â/g, ipa: "ɐ" },
    { pattern: /ê/g, ipa: "e" },
    { pattern: /ô/g, ipa: "o" },
    { pattern: /ç/g, ipa: "s" },
    { pattern: /lh/g, ipa: "ʎ" },
    { pattern: /nh/g, ipa: "ɲ" },
    { pattern: /ch/g, ipa: "ʃ" },
    { pattern: /rr/g, ipa: "ʁ" },
    { pattern: /^r/g, ipa: "ʁ" },
    { pattern: /a/g, ipa: "a" },
    { pattern: /e/g, ipa: "ɛ" },
    { pattern: /i/g, ipa: "i" },
    { pattern: /o/g, ipa: "ɔ" },
    { pattern: /u/g, ipa: "u" },
    { pattern: /s/g, ipa: "s" },
    { pattern: /r/g, ipa: "ɾ" },
    { pattern: /d/g, ipa: "d" },
    { pattern: /t/g, ipa: "t" },
    { pattern: /k/g, ipa: "k" },
    { pattern: /g/g, ipa: "ɡ" },
    { pattern: /p/g, ipa: "p" },
    { pattern: /b/g, ipa: "b" },
    { pattern: /f/g, ipa: "f" },
    { pattern: /v/g, ipa: "v" },
    { pattern: /l/g, ipa: "l" },
    { pattern: /m/g, ipa: "m" },
    { pattern: /n/g, ipa: "n" },
    { pattern: /h/g, ipa: "" },
    { pattern: /j/g, ipa: "ʒ" },
    { pattern: /z/g, ipa: "z" },
    { pattern: /c/g, ipa: "k" },
    { pattern: /x/g, ipa: "ʃ" },
  ],
};

const IPA_IT: IpaMap = {
  rules: [
    { pattern: /è/g, ipa: "ɛ" },
    { pattern: /é/g, ipa: "e" },
    { pattern: /à/g, ipa: "a" },
    { pattern: /ò/g, ipa: "ɔ" },
    { pattern: /ì/g, ipa: "i" },
    { pattern: /ù/g, ipa: "u" },
    { pattern: /gn/g, ipa: "ɲ" },
    { pattern: /gli/g, ipa: "ʎ" },
    { pattern: /ce/g, ipa: "tʃe" },
    { pattern: /ci/g, ipa: "tʃi" },
    { pattern: /ge/g, ipa: "dʒe" },
    { pattern: /gi/g, ipa: "dʒi" },
    { pattern: /a/g, ipa: "a" },
    { pattern: /e/g, ipa: "e" },
    { pattern: /i/g, ipa: "i" },
    { pattern: /o/g, ipa: "o" },
    { pattern: /u/g, ipa: "u" },
    { pattern: /s/g, ipa: "s" },
    { pattern: /r/g, ipa: "r" },
    { pattern: /d/g, ipa: "d" },
    { pattern: /t/g, ipa: "t" },
    { pattern: /k/g, ipa: "k" },
    { pattern: /g/g, ipa: "ɡ" },
    { pattern: /p/g, ipa: "p" },
    { pattern: /b/g, ipa: "b" },
    { pattern: /f/g, ipa: "f" },
    { pattern: /v/g, ipa: "v" },
    { pattern: /l/g, ipa: "l" },
    { pattern: /m/g, ipa: "m" },
    { pattern: /n/g, ipa: "n" },
    { pattern: /h/g, ipa: "" },
    { pattern: /z/g, ipa: "ts" },
    { pattern: /c/g, ipa: "k" },
    { pattern: /x/g, ipa: "ks" },
  ],
};

const IPA_MAPS: Record<string, IpaMap> = {
  es: IPA_ES, en: IPA_EN, de: IPA_DE, fr: IPA_FR, pt: IPA_PT, it: IPA_IT,
};

/** 给单个词生成国际音标 (IPA) */
export function toIPA(word: string, lang: string | null | undefined): string {
  if (!word || !lang) return "";
  const map = IPA_MAPS[lang.toLowerCase()];
  if (!map) return "";

  let result = "";
  let i = 0;
  const lower = word.toLowerCase();

  while (i < lower.length) {
    let matched = false;
    for (const rule of map.rules) {
      rule.pattern.lastIndex = 0;
      const m = rule.pattern.exec(lower.slice(i));
      if (m && m.index === 0 && m[0].length > 0) {
        result += rule.ipa;
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result += lower[i];
      i += 1;
    }
  }

  /* 清理：去掉空结果，合并连续相同音标 */
  result = result.replace(/\+/g, "");
  return result;
}

/** 简单分词：按空格切分，保留标点附着在词上 */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}
