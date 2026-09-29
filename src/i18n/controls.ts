import { useI18n } from "./context";
const RU: Record<string, string> = {
  Low: "Низкие", Mid: "Средние", High: "Высокие",
  Flat: "Ровный", "Vocal Clear": "Разборчивый вокал", "Clean Low End": "Чистые низкие частоты", Punch: "Плотный", Bright: "Яркий", "Warm Mix": "Тёплый микс", Dark: "Тёмный", "Bass Control": "Контроль баса",
  Gain: "Усиление", Thresh: "Порог", Ratio: "Степень", Attack: "Атака", Release: "Спад", Knee: "Колено", Makeup: "Компенсация",
  "X low": "Нижний раздел", "X high": "Верхний раздел", Focus: "Частота", Range: "Глубина", "HF trim": "Верхние частоты",
  Ceiling: "Порог", Drive: "Перегруз", Mode: "Режим", Tone: "Тембр", Freq: "Частота", Width: "Ширина", "Bass mono": "Моно НЧ",
  "Mono check": "Проверка моно", "Safe bass": "Моно низкие частоты", "High band": "Высокая полоса", "Body band": "Основная полоса",
  Amount: "Глубина", Hum: "Гул", Trim: "Уровень", Channel: "Канал", "Phase invert": "Инверсия фазы", Mono: "Моно",
  "Dynamics": "Динамика", "EQ / Tone": "Эквалайзеры", "Space / Time": "Пространство", "Utility": "Инструменты",
  stereo: "Стерео", mono: "Моно", left: "Левый", right: "Правый", noise: "Полосовые фильтры", hum: "Режекция гула", harshness: "Смягчение верха",
  soft: "Мягкий", hard: "Жёсткий", warm: "Тёплый", tube: "Ламповый", tape: "Лента", harmonic: "Гармоники", softClip: "Мягкое ограничение", bright: "Светлый", gritty: "Грубый", none: "Выкл."
};
export function useControlLabel() {
  const { locale } = useI18n();
  return (label: string) => {
    if (locale !== "ru") return label;
    if (RU[label]) return RU[label];
    for (const key of Object.keys(RU)) if (label.startsWith(`${key} `)) return `${RU[key]}${label.slice(key.length)}`;
    return label;
  };
}
