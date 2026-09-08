/**
 * 发音规则速查：按当前歌曲语言显示「怎么把这门语言唱得像」的核心规则。
 * 放在学唱页最底部，供跟唱时随时对照。
 */

type Rule = { say: string; hear: string; eg: string };
type Guide = { label: string; intro: string; rules: Rule[] };

const GUIDES: Record<string, Guide> = {
  es: {
    label: "Español 西班牙语",
    intro: "西语「怎么写就怎么读」，把下面几条记住，唱起来就八九不离十。",
    rules: [
      { say: "元音口型永远不变", hear: "a=阿 e=埃 i=依 o=欧 u=乌", eg: "no 永远读「诺」，不会读成「呐」" },
      { say: "h 完全不发音", hear: "h + 元音 = 直接读元音", eg: "hola 读「欧拉」" },
      { say: "ll / y 读「呀」", hear: "ll → [j]", eg: "llamar「呀马尔」、yo「哟」、ella「埃呀」" },
      { say: "ñ 读「尼亚」", hear: "ñ → [ɲ]", eg: "español「埃斯帕尼奥尔」、mañana「马尼亚纳」" },
      { say: "j / ge / gi 是喉音", hear: "像清嗓子「赫」，比中文 h 重", eg: "juntos「洪托斯」、gente「亨特」" },
      { say: "gue/gui、que/qui 里 u 不发音", hear: "gue=「给」 que=「凯」", eg: "guerra「盖拉」、aqui「阿基」" },
      { say: "z / ce / ci 读「斯」", hear: "z,c(e/i) → [s]", eg: "gracias「格拉西亚斯」、cinco「辛科」" },
      { say: "r 词首、rr 要弹舌", hear: "舌尖颤动，练不好先用「得-勒」快速连读代替", eg: "perro「佩罗(弹舌)」、real「雷亚尔(弹舌)」" },
      { say: "重音看符号/词尾", hear: "有´的重读；否则元音/n/s结尾重倒数第二音节", eg: "música 重「MU」、canción 重「ción」" },
    ],
  },
  en: {
    label: "English 英语",
    intro: "英语歌词的关键是弱读和连读——母语者唱歌时不会把每个词都读满。",
    rules: [
      { say: "弱读词一口气带过", hear: "a/of/to/and 读 [ə]/[əv]/[tə]/[ən]", eg: "want to 唱成 wanna" },
      { say: "th 咬舌尖", hear: "think / this 舌尖轻触上齿", eg: "three 不要读成「斯里」" },
      { say: "r 卷舌（美音）", hear: "词尾 r 卷舌延续", eg: "car、more、love(r)" },
      { say: "大量字母不发音", hear: "kn- 的 k、-mb 的 b、gh 常哑", eg: "knife「奈夫」、climb「克莱姆」" },
      { say: "连读 + 吞音", hear: "辅音结尾+元音开头连成一个音", eg: "not at all「no-ta-tall」" },
      { say: "-ed 三种读法", hear: "/t/ /d/ /ɪd/", eg: "walked「沃克t」、wanted「沃尼迪」" },
    ],
  },
  fr: {
    label: "Français 法语",
    intro: "法语歌词的关键：词尾辅音基本不发音，元音靠鼻子。",
    rules: [
      { say: "词尾辅音大多不发音", hear: "t/d/s/x/p 词尾哑", eg: "Paris「帕里」、petit「珀蒂」" },
      { say: "例外 CfR 常发音", hear: "词尾 c/r/f/l 要读", eg: "avec「阿维克」、hiver「伊韦尔」" },
      { say: "鼻化元音", hear: "on/en/in 气流走鼻子，嘴别张开收尾", eg: "bon「布翁」、chanson「香松」" },
      { say: "联诵 liaison", hear: "哑辅音接元音时复活读 [z]/[t]", eg: "les amis「雷扎米」" },
      { say: "u 与 ou 分清", hear: "u 圆唇「吁」，ou「乌」", eg: "-dessus「对 above」vs dessous" },
      { say: "r 是小舌音", hear: "喉咙深处轻擦，像含着水漱口", eg: "rouge、Paris 的 r" },
    ],
  },
  de: {
    label: "Deutsch 德语",
    intro: "德语拼读规则极其严格，学会对应关系就能照着歌词唱。",
    rules: [
      { say: "w 读 v，v 读 f", hear: "w=[v] v=[f]", eg: "Wasser「瓦瑟」、Vater「法特」" },
      { say: "ch 两种读音", hear: "ich 硬腭「希」；ach 喉音「阿赫」", eg: "ich「伊希」、Bach「巴赫」" },
      { say: "ä ö ü 圆唇前元音", hear: "嘴型撮圆舌头放前", eg: "für「夫于」、schön「舒恩」" },
      { say: "词首 st/sp 读「什」", hear: "st=[ʃt] sp=[ʃp]", eg: "Straße「施特拉塞」" },
      { say: "z 读「茨」", hear: "z=[ts]", eg: "Zeit「蔡特」" },
      { say: "-er 词尾读「阿」", hear: "弱化成 [ɐ]", eg: "Mutter「穆阿」" },
    ],
  },
  pt: {
    label: "Português 葡萄牙语",
    intro: "巴西葡语唱起来最常见：元音鼻化、词尾弱化。",
    rules: [
      { say: "ão 是鼻化「昂」", hear: "嘴收拢气流走鼻", eg: "nação「纳桑」" },
      { say: "词尾 e/o 弱读", hear: "非重读 e→i，o→u（巴西）", eg: "nome「诺米」、tudo「图杜」" },
      { say: "lh = 「利」，nh = 「尼」", hear: "lh=[ʎ] nh=[ɲ]", eg: "trabalho「特拉巴利乌」、senhor「辛约尔」" },
      { say: "r 词首 / rr 是喉音", hear: "巴西读「h」，像轻咳", eg: "Rio「希乌」、carro「卡霍」" },
      { say: "ti / di 腭化", hear: "巴西常读「奇/吉」", eg: "tudo 的 t 软化" },
      { say: "重音看符号和词尾", hear: "á/â/ê 符号定重音", eg: "você 重「cê」" },
    ],
  },
  it: {
    label: "Italiano 意大利语",
    intro: "意大利语是完全的「所见即所唱」，歌剧都拿它练声。",
    rules: [
      { say: "拼读完全一致", hear: "会读单词=会读歌词", eg: "没有哑字母" },
      { say: "c + e/i 读「恰/奇」", hear: "ciao「恰奥」；c+a/o/u 读 k", eg: "cosa「科萨」" },
      { say: "g + e/i 读「杰」", hear: "gelato「杰拉托」；g+a/o/u 读 g", eg: "gatto「加托」" },
      { say: "gn = 「尼」，gli = 「利」", hear: "gn=[ɲ] gli=[ʎ]", eg: "famiglia「法米利亚」" },
      { say: "双辅音要拖长一拍", hear: "pp/ll/rr 停顿感", eg: "palla（球）≠ pala（铲）" },
      { say: "词尾元音读满", hear: "o/a 不能吞掉", eg: "amore 的 e 要唱出来" },
    ],
  },
  ja: {
    label: "日本語 日语",
    intro: "日语歌词按假名逐拍唱，核心是「等拍」和「拍数不能错」。",
    rules: [
      { say: "五元音小口型", hear: "a i u e o 短促干脆", eg: "u 是「乌」嘴唇别突出" },
      { say: "长音占两拍", hear: "ー / おう 拖一整拍", eg: "そう「搜-哦」两拍" },
      { say: "促音 っ 停一拍", hear: "堵住气流空一拍再唱", eg: "きって「ki-停-te」" },
      { say: "拗音一拍完成", hear: "きゃ きゅ きょ 合成一拍", eg: "ちょっと「cho-t-to」" },
      { say: "ん 随后字变鼻音", hear: "接 b/p/m 前读 m", eg: "さんぽ 读「sambo」" },
      { say: "每拍等长", hear: "跟着鼓点，一字一拍不抢不拖", eg: "歌词时间轴基本按拍走" },
    ],
  },
  ko: {
    label: "한국어 韩语",
    intro: "韩语歌词的关键是连音——字与字之间要「粘」起来唱。",
    rules: [
      { say: "连音最常见", hear: "收音接到下一个元音开头", eg: "밥을 读「巴布尔」" },
      { say: "松音/紧音/送气三分", hear: "가/까/카 严格区分", eg: "紧音喉咙收紧" },
      { say: "ㅡ ㅓ 汉语没有", hear: "ㅡ=「呃」嘴唇平；ㅓ 张嘴「奥-呃之间」", eg: "먹다 的 ㅓ" },
      { say: "收音只有 7 个音", hear: "ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅇ", eg: "밖 收音读「ㄱ」" },
      { say: "ㄹ 是 r/l 之间", hear: "舌尖弹上齿龈一次", eg: "사랑「撒郎」的 ㄹ" },
      { say: "音高随句子起伏", hear: "不是重音语言，别突兀加重", eg: "平缓带过" },
    ],
  },
  zh: {
    label: "中文",
    intro: "中文歌词的难点在声调和前后鼻音，唱歌时声调会淡化但字要咬准。",
    rules: [
      { say: "声调辨义", hear: "mā má mǎ mà 四个意思", eg: "唱歌时声调随旋律，但字头字腹要清" },
      { say: "平翘舌分清", hear: "z c s ≠ zh ch sh", eg: "四 vs 是" },
      { say: "前后鼻音分清", hear: "an ≠ ang", eg: "班 vs 帮" },
      { say: "ü 圆唇", hear: "「吁」嘴唇撮圆", eg: "绿 lǜ ≠ 里" },
      { say: "轻声要轻", hear: "子/了/的 读半拍弱音", eg: "「朋友」的友带轻" },
    ],
  },
};

export default function PronunciationGuide({ lang }: { lang: string | null }) {
  const guide = lang ? GUIDES[lang] : undefined;
  if (!guide) return null;
  return (
    <details open className="group mt-6 rounded-lg border border-line bg-ink-900/70">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-5 py-4">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 6.5c-1.5-1.3-3.6-2-5.5-1.7v13c1.9-.3 4 .4 5.5 1.7 1.5-1.3 3.6-2 5.5-1.7v-13c-1.9-.3-4 .4-5.5 1.7Z" />
          <path d="M12 6.5v13" />
        </svg>
        <span className="font-display text-base text-paper">发音规则 · {guide.label}</span>
        <span className="font-mono text-[10px] text-faint">跟唱前先扫一眼，唱不准的音回来查</span>
        <svg viewBox="0 0 16 16" className="ml-auto h-4 w-4 text-faint transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-line-soft px-5 py-4">
        <p className="mb-4 text-xs leading-relaxed text-dim">{guide.intro}</p>
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {guide.rules.map((r, i) => (
            <div key={i} className="rounded-md border border-line-soft bg-ink-850/60 px-3.5 py-3">
              <p className="font-display text-sm text-paper">
                <span className="mr-1.5 font-mono text-[10px] text-amber">{String(i + 1).padStart(2, "0")}</span>
                {r.say}
              </p>
              <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-teal">{r.hear}</p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-faint">{r.eg}</p>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
