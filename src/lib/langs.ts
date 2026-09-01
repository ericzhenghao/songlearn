export type NativeLang = {
  code: string;
  short: string;
  label: string;
};

/** 母语（翻译目标）选项 */
export const NATIVE_LANGS: NativeLang[] = [
  { code: "zh-CN", short: "zh", label: "简体中文" },
  { code: "en-US", short: "en", label: "English" },
  { code: "ja-JP", short: "ja", label: "日本語" },
  { code: "ko-KR", short: "ko", label: "한국어" },
  { code: "es-ES", short: "es", label: "Español" },
  { code: "fr-FR", short: "fr", label: "Français" },
  { code: "de-DE", short: "de", label: "Deutsch" },
];

/** 歌曲语言选项（auto = 自动检测） */
export const SONG_LANGS: { code: string; label: string }[] = [
  { code: "auto", label: "自动检测" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
];

const LABELS: Record<string, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
  pt: "Português",
  it: "Italiano",
};

export function langLabel(code: string | null | undefined): string {
  if (!code) return "未知";
  return LABELS[code] ?? code.toUpperCase();
}
