/**
 * 发音学习数据 —— 按歌曲语言提供基础音标 + 示例词 + 中文说明。
 * 音标为国际音标（IPA）；示例词点击可朗读。
 */
export type PronItem = {
  ipa: string;
  word: string;
  zh: string;
};

export type PronGroup = {
  title: string;
  items: PronItem[];
};

export type PronLang = {
  code: string;
  name: string;
  intro: string;
  groups: PronGroup[];
};

export const PRON_DATA: Record<string, PronLang> = {
  en: {
    code: "en",
    name: "英语发音",
    intro: "英语重音节奏明显，元音分长短、双元音要滑动到位，th/r/l 是难点。",
    groups: [
      {
        title: "元音 · 短元音",
        items: [
          { ipa: "/ɪ/", word: "big", zh: "短 i，嘴放松，类似「衣」但更短促" },
          { ipa: "/e/", word: "bed", zh: "嘴半开，类似「埃」，但更扁" },
          { ipa: "/æ/", word: "cat", zh: "咧嘴开口，介于「哎」和「安」之间" },
          { ipa: "/ʌ/", word: "love", zh: "短促放松的「啊」，口腔中部发音" },
          { ipa: "/ʊ/", word: "good", zh: "短 u，唇微圆但不突" },
          { ipa: "/ə/", word: "about", zh: "弱央元音，任何非重读元音常读它" },
        ],
      },
      {
        title: "元音 · 长元音",
        items: [
          { ipa: "/iː/", word: "see", zh: "长 i，微笑拉长，比 /ɪ/ 更紧" },
          { ipa: "/ɑː/", word: "father", zh: "长「啊」，嘴张大" },
          { ipa: "/uː/", word: "food", zh: "长 u，唇圆突，拉长" },
          { ipa: "/ɜː/", word: "bird", zh: "卷舌长元音，舌中部抬、舌尖微卷" },
        ],
      },
      {
        title: "元音 · 双元音",
        items: [
          { ipa: "/eɪ/", word: "day", zh: "「诶」滑向「衣」，嘴型滑动" },
          { ipa: "/aɪ/", word: "time", zh: "「啊」滑向「衣」" },
          { ipa: "/ɔɪ/", word: "boy", zh: "「奥」滑向「衣」" },
          { ipa: "/aʊ/", word: "now", zh: "「啊」滑向「乌」，嘴先大后圆" },
          { ipa: "/oʊ/", word: "go", zh: "「哦」滑向「乌」" },
        ],
      },
      {
        title: "辅音 · 难点",
        items: [
          { ipa: "/θ/", word: "think", zh: "舌尖轻抵上齿，送气摩擦（清）" },
          { ipa: "/ð/", word: "this", zh: "同位置但声带振动（浊）" },
          { ipa: "/ʃ/", word: "she", zh: "「嘘」的音，唇圆" },
          { ipa: "/ʒ/", word: "vision", zh: "/ʃ/ 的浊音，类似「日」但唇不突出" },
          { ipa: "/tʃ/", word: "chair", zh: "先堵再破，类似「吃」但更短" },
          { ipa: "/dʒ/", word: "jump", zh: "/tʃ/ 的浊音，类似「知」" },
          { ipa: "/ŋ/", word: "sing", zh: "舌根抵软腭发「嗯」" },
          { ipa: "/r/", word: "red", zh: "卷舌但舌尖不接触上颚" },
          { ipa: "/l/", word: "love", zh: "舌尖抵上齿龈" },
          { ipa: "/v/", word: "very", zh: "上齿轻咬下唇发声" },
          { ipa: "/w/", word: "we", zh: "双唇收圆送气" },
          { ipa: "/j/", word: "yes", zh: "类似「呀」的起音" },
        ],
      },
    ],
  },

  es: {
    code: "es",
    name: "西班牙语发音",
    intro: "西语拼读非常规则：见词就能读。5 个元音固定不变，辅音 b/v 同音，h 不发音。",
    groups: [
      {
        title: "元音 · 5 个固定音",
        items: [
          { ipa: "/a/", word: "casa", zh: "响亮清晰的「啊」，永远不变" },
          { ipa: "/e/", word: "mesa", zh: "短促的「诶」" },
          { ipa: "/i/", word: "sí", zh: "短「衣」" },
          { ipa: "/o/", word: "sol", zh: "短「哦」" },
          { ipa: "/u/", word: "luna", zh: "短「乌」" },
        ],
      },
      {
        title: "辅音 · 特殊字母",
        items: [
          { ipa: "/ɲ/", word: "niño", zh: "ñ：舌面贴硬腭发「尼」，如「ny」" },
          { ipa: "/ʝ/", word: "llamar", zh: "ll/y：浊音，类似「呀」，阿根廷读 /ʃ/" },
          { ipa: "/r/", word: "pero", zh: "r 单击：舌尖快速弹一下" },
          { ipa: "/r/", word: "perro", zh: "rr 多击：舌尖连续弹颤，俗称「弹舌」" },
          { ipa: "/x/", word: "jamón", zh: "j（及 ge/gi）：喉部摩擦音，类似咳嗽" },
          { ipa: "/β/", word: "vivir", zh: "b/v：双唇轻合送气，介于 b 和 v 之间" },
          { ipa: "/θ/", word: "gracias", zh: "c(e,i)/z：舌尖抵齿缝送气（西班牙）或 /s/（拉美）" },
          { ipa: "/k/", word: "queso", zh: "c(a,o,u) 与 qu 都读「k」" },
          { ipa: "/g/", word: "gato", zh: "g(a,o,u) 读「g」" },
          { ipa: "—", word: "hola", zh: "h 永远不发音" },
        ],
      },
      {
        title: "重音规则",
        items: [
          { ipa: "◌á", word: "adiós", zh: "带重音符号 á/é/í/ó/ú 的音节重读" },
          { ipa: "◌´", word: "casa", zh: "以元音/n/s 结尾：重音在倒数第二音节" },
          { ipa: "◌´", word: "cantar", zh: "以其他辅音结尾：重音在最后一个音节" },
        ],
      },
    ],
  },

  fr: {
    code: "fr",
    name: "法语发音",
    intro: "法语鼻元音与 r 是小舌音是特色；词尾辅音多不发音，靠连音衔接。",
    groups: [
      {
        title: "元音 · 鼻元音",
        items: [
          { ipa: "/ɑ̃/", word: "sans", zh: "an/am/en：口鼻同时出气的「昂」" },
          { ipa: "/ɔ̃/", word: "bon", zh: "on：鼻化的「翁」" },
          { ipa: "/ɛ̃/", word: "pain", zh: "in/im/ain：鼻化的「安」" },
        ],
      },
      {
        title: "元音 · 特色",
        items: [
          { ipa: "/y/", word: "tu", zh: "u：圆唇发「衣」" },
          { ipa: "/ø/", word: "deux", zh: "eu：圆唇发「诶」" },
          { ipa: "/œ/", word: "soeur", zh: "eu 开口版" },
        ],
      },
      {
        title: "辅音",
        items: [
          { ipa: "/ʁ/", word: "rouge", zh: "r：小舌颤动，喉咙摩擦" },
          { ipa: "/ʃ/", word: "chat", zh: "ch 读「嘘」" },
          { ipa: "/ʒ/", word: "je", zh: "j 读浊「日」" },
          { ipa: "/ɲ/", word: "montagne", zh: "gn 读「ny」" },
        ],
      },
    ],
  },

  de: {
    code: "de",
    name: "德语发音",
    intro: "德语拼读规则严格；变元音 ä/ö/ü 与 ch/r 是发音难点。",
    groups: [
      {
        title: "变元音",
        items: [
          { ipa: "/yː/", word: "über", zh: "ü：圆唇发长「衣」" },
          { ipa: "/øː/", word: "schön", zh: "ö：圆唇发长「诶」" },
          { ipa: "/ɛː/", word: "Mädchen", zh: "ä：接近长「埃」" },
        ],
      },
      {
        title: "辅音",
        items: [
          { ipa: "/ç/", word: "ich", zh: "ch 在 i/e 后：轻「希」音" },
          { ipa: "/x/", word: "acht", zh: "ch 在 a/o/u 后：喉部「哈」" },
          { ipa: "/ʁ/", word: "rot", zh: "r：小舌颤音或喉摩擦" },
          { ipa: "/ʃ/", word: "schön", zh: "sch 读「嘘」" },
          { ipa: "/ts/", word: "Zeit", zh: "z 读「次」" },
          { ipa: "/ŋ/", word: "singen", zh: "ng 读「嗯」" },
        ],
      },
    ],
  },

  ja: {
    code: "ja",
    name: "日语发音",
    intro: "日语基本是「辅音+元音」的音节结构，节奏均匀；长音、促音、拨音要拖够时长。",
    groups: [
      {
        title: "元音",
        items: [
          { ipa: "/a/", word: "あさ", zh: "あ：清晰「啊」" },
          { ipa: "/i/", word: "いえ", zh: "い：短「衣」" },
          { ipa: "/u/", word: "うみ", zh: "う：唇不圆突的「乌」" },
          { ipa: "/e/", word: "えき", zh: "え：短「诶」" },
          { ipa: "/o/", word: "おか", zh: "お：短「哦」" },
        ],
      },
      {
        title: "特殊音节",
        items: [
          { ipa: "/N/", word: "ほん", zh: "拨音 ん：鼻音收尾" },
          { ipa: "/Q/", word: "きって", zh: "促音 っ：顿挫一拍再发下一音" },
          { ipa: "/ː/", word: "おかあさん", zh: "长音：元音拖长一拍" },
          { ipa: "/kja/", word: "きゃ", zh: "拗音：辅音+や行小字，一拍内完成" },
        ],
      },
      {
        title: "清浊辅音",
        items: [
          { ipa: "/k/", word: "かき", zh: "か行：清音「k」" },
          { ipa: "/g/", word: "がっこう", zh: "が行：浊音「g」" },
          { ipa: "/s/", word: "さくら", zh: "さ行：清音「s」" },
          { ipa: "/dz/", word: "ざぶとん", zh: "ざ行：浊音「z/dz」" },
        ],
      },
    ],
  },

  ko: {
    code: "ko",
    name: "韩语发音",
    intro: "韩语为音素文字，一个方块字 = 声母+韵母+（收音）。松紧送气是韩语辅音特色。",
    groups: [
      {
        title: "元音",
        items: [
          { ipa: "/a/", word: "아", zh: "ㅏ：开口「啊」" },
          { ipa: "/ʌ/", word: "어", zh: "ㅓ：短促放松「啊」" },
          { ipa: "/o/", word: "오", zh: "ㅗ：圆唇「哦」" },
          { ipa: "/u/", word: "우", zh: "ㅜ：圆唇「乌」" },
          { ipa: "/ɯ/", word: "으", zh: "ㅡ：不圆唇「乌」" },
          { ipa: "/i/", word: "이", zh: "ㅣ：短「衣」" },
        ],
      },
      {
        title: "辅音 · 松/紧/送气",
        items: [
          { ipa: "/k/", word: "가", zh: "ㄱ：轻「k/g」" },
          { ipa: "/k͈/", word: "까", zh: "ㄲ：紧音，喉部绷紧发「k」" },
          { ipa: "/kʰ/", word: "카", zh: "ㅋ：送气强「k」" },
          { ipa: "/t/", word: "다", zh: "ㄷ：轻「t/d」" },
          { ipa: "/p/", word: "바", zh: "ㅂ：轻「p/b」" },
          { ipa: "/s/", word: "사", zh: "ㅅ：清「s」" },
        ],
      },
      {
        title: "收音（韵尾）",
        items: [
          { ipa: "/k̚/", word: "국", zh: "ㄱ 收音：短促收尾" },
          { ipa: "/n/", word: "산", zh: "ㄴ 收音：鼻音" },
          { ipa: "/ŋ/", word: "강", zh: "ㅇ 收音：「嗯」" },
          { ipa: "/m/", word: "밤", zh: "ㅁ 收音：闭唇" },
        ],
      },
    ],
  },

  pt: {
    code: "pt",
    name: "葡萄牙语发音",
    intro: "葡语鼻元音多（类似法语），r 在词首发喉音，s 在词尾常变 /ʃ/。",
    groups: [
      {
        title: "鼻元音",
        items: [
          { ipa: "/ɐ̃/", word: "canção", zh: "ão/ã：鼻化的「昂」" },
          { ipa: "/ẽ/", word: "tem", zh: "em：鼻化「嗯」" },
          { ipa: "/õ/", word: "não", zh: "õ：鼻化「翁」" },
        ],
      },
      {
        title: "辅音",
        items: [
          { ipa: "/ʎ/", word: "filha", zh: "lh：读「ly」，类似「里亚」" },
          { ipa: "/ɲ/", word: "ninho", zh: "nh：读「ny」" },
          { ipa: "/ʃ/", word: "você", zh: "词尾 s/ç：常读「嘘」" },
          { ipa: "/ʁ/", word: "rio", zh: "词首 r：小舌颤音" },
          { ipa: "/ɾ/", word: "caro", zh: "词中 r：舌尖弹一下" },
        ],
      },
    ],
  },

  it: {
    code: "it",
    name: "意大利语发音",
    intro: "意大利语拼读规则，5 元音固定；ci/gi 变音、双辅音要拖长。",
    groups: [
      {
        title: "元音",
        items: [
          { ipa: "/a/", word: "amore", zh: "a：响亮「啊」" },
          { ipa: "/e/", word: "bene", zh: "e：短「诶」" },
          { ipa: "/i/", word: "vino", zh: "i：短「衣」" },
          { ipa: "/o/", word: "sole", zh: "o：短「哦」" },
          { ipa: "/u/", word: "luna", zh: "u：短「乌」" },
        ],
      },
      {
        title: "辅音 · 变音",
        items: [
          { ipa: "/tʃ/", word: "ciao", zh: "ci/ce：读「吃/切」" },
          { ipa: "/dʒ/", word: "gelato", zh: "gi/ge：读「知/杰」" },
          { ipa: "/ʎ/", word: "figli", zh: "gli：读「ly」" },
          { ipa: "/ɲ/", word: "bagno", zh: "gn：读「ny」" },
          { ipa: "/k/", word: "che", zh: "ch：读「k」" },
          { ipa: "/kk/", word: "notte", zh: "双辅音 tt：拖长一拍" },
        ],
      },
    ],
  },

  zh: {
    code: "zh",
    name: "中文发音（拼音）",
    intro: "中文是声调语言：同一个音节，四个声调意思完全不同；先练准声调再谈流畅。",
    groups: [
      {
        title: "声调",
        items: [
          { ipa: "˥", word: "妈 mā", zh: "第一声：高平调，音高保持" },
          { ipa: "˧˥", word: "麻 má", zh: "第二声：上扬调，从低到高" },
          { ipa: "˨˩˦", word: "马 mǎ", zh: "第三声：先降后升" },
          { ipa: "˥˩", word: "骂 mà", zh: "第四声：急降调" },
        ],
      },
      {
        title: "声母（辅音）",
        items: [
          { ipa: "/pʰ/", word: "怕 pà", zh: "p：送气清音" },
          { ipa: "/p/", word: "爸 bà", zh: "b：不送气清音" },
          { ipa: "/ʂ/", word: "是 shì", zh: "sh：卷舌「是」" },
          { ipa: "/tɕ/", word: "家 jiā", zh: "j：舌面音" },
          { ipa: "/tɕʰ/", word: "去 qù", zh: "q：舌面送气" },
        ],
      },
      {
        title: "韵母（元音）",
        items: [
          { ipa: "/a/", word: "啊 ā", zh: "a：开口元音" },
          { ipa: "/o/", word: "喔 ō", zh: "o：圆唇" },
          { ipa: "/ɤ/", word: "鹅 é", zh: "e：不圆唇" },
          { ipa: "/i/", word: "衣 yī", zh: "i：前高元音" },
          { ipa: "/u/", word: "乌 wū", zh: "u：圆唇后元音" },
          { ipa: "/y/", word: "鱼 yú", zh: "ü：圆唇前元音" },
        ],
      },
    ],
  },
};

/** 语言 code → 显示名（用于标题） */
export const LANG_NAMES: Record<string, string> = {
  en: "英语",
  es: "西班牙语",
  fr: "法语",
  de: "德语",
  ja: "日语",
  ko: "韩语",
  pt: "葡萄牙语",
  it: "意大利语",
  zh: "中文",
};
