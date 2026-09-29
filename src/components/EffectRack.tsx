import { useState, type ReactNode } from "react";
import type {
  DynamicEqBand,
  Effect,
  EffectType,
  Eq10Effect,
  MultibandCompressorBand,
} from "../types";
import { EFFECT_LABELS, EFFECT_MENU } from "../state/effects";
import { useI18n } from "../i18n";
import { EQPanel } from "./EQPanel";
import { useControlLabel } from "../i18n/controls";

interface EffectRackProps {
  title: string;
  subtitle?: string;
  effects: Effect[];
  clipboardAvailable: boolean;
  onAdd: (type: EffectType) => void;
  onUpdate: (effectId: string, patch: Partial<Effect>) => void;
  onRemove: (effectId: string) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onCopy: () => void;
  onPaste: () => void;
  onClear: () => void;
  onSetBypassAll: (bypass: boolean) => void;
  bypassed?: boolean;
  master?: boolean;
}

export function EffectRack({
  title,
  subtitle,
  effects,
  clipboardAvailable,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
  onCopy,
  onPaste,
  onClear,
  onSetBypassAll,
  bypassed = false,
  master = false,
}: EffectRackProps) {
  const { t, locale } = useI18n();
  const text = (ru: string, en: string) => locale === "ru" ? ru : en;
  const [addType, setAddType] = useState<EffectType>("eq10");

  const toggleCompare = () => {
    onSetBypassAll(!bypassed);
  };

  const labelText = useControlLabel();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3">
        <div className="panel-section-title mb-1">{title}</div>
        {subtitle && <div className="text-[10px] leading-relaxed text-gray-500">{subtitle}</div>}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <button className="rack-button" onClick={onCopy} disabled={effects.length === 0}>
          {text("Копировать", "Copy")}
        </button>
        <button className="rack-button" onClick={onPaste} disabled={!clipboardAvailable}>
          {text("Вставить", "Paste")}
        </button>
        <button className="rack-button" onClick={toggleCompare} disabled={effects.length === 0}>
          {bypassed ? text("Включить эффекты", "Enable effects") : text("Обойти эффекты", "Bypass effects")}
        </button>
        <button className="rack-button danger-soft" onClick={onClear} disabled={effects.length === 0}>
          {text("Очистить", "Clear")}
        </button>
      </div>

      <div className="mb-3 rounded-md border border-bg-3/80 bg-bg-0/45 p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="panel-section-title">{text("Добавить эффект", "Add effect")}</span>
        </div>
        <div className="flex gap-1.5">
          <select
            className="min-w-0 flex-1 rounded-md border border-bg-3 bg-bg-2 px-2 py-1.5 text-[10px] text-gray-200 outline-none"
            value={addType}
            onChange={(e) => setAddType(e.target.value as EffectType)}
          >
            {EFFECT_MENU.map((group) => (
              <optgroup key={group.title} label={labelText(group.title)}>
                {group.types.filter(type => !master || !["speed", "pitch"].includes(type)).map((type) => (
                  <option key={type} value={type}>
                    {t(EFFECT_LABELS[type])}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="w-16 rounded-md bg-accent text-[10px] font-bold text-black" onClick={() => onAdd(addType)}>
            +
          </button>
        </div>
      </div>

      {effects.length === 0 && (
        <div className="rounded-md border border-dashed border-bg-3/90 bg-bg-0/55 p-4 text-center text-[10px] leading-relaxed text-gray-600">
          {text("Добавьте эффект или цепочку из библиотеки.", "Add an effect or a chain from the library.")}
        </div>
      )}

      <div className="flex flex-col gap-2 pb-4">
        {effects.map((effect, i) => (
          <div
            key={effect.id}
            className="rounded-md border border-bg-3/90 bg-bg-2 p-2 shadow-sm"
            draggable
            onDragStart={(ev) => {
              ev.dataTransfer.setData("text/plain", String(i));
              ev.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(ev) => {
              ev.preventDefault();
              ev.dataTransfer.dropEffect = "move";
            }}
            onDrop={(ev) => {
              ev.preventDefault();
              const from = Number(ev.dataTransfer.getData("text/plain"));
              if (Number.isFinite(from) && from !== i) onReorder(from, i);
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-bg-3/50 pb-1">
              <div className="min-w-0 text-[10px] font-bold">
                <span className="mr-2 text-gray-600">#{i + 1}</span>
                <span className="truncate">{t(EFFECT_LABELS[effect.type])}</span>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
                    effect.bypass ? "bg-red-500 text-black" : "bg-bg-3 text-gray-400 hover:bg-bg-3/80"
                  }`}
                  onClick={() => onUpdate(effect.id, { bypass: !effect.bypass })}
                  title={t("inspector.effects.bypass")}
                >
                  BYP
                </button>
                <button
                  className="rounded bg-bg-3 px-1.5 py-0.5 text-[9px] text-gray-500 transition-colors hover:text-red-400"
                  onClick={() => onRemove(effect.id)}
                  aria-label="Remove effect"
                >
                  x
                </button>
              </div>
            </div>

            <EffectControls effect={effect} onChange={(patch) => onUpdate(effect.id, patch)} />

            {!['speed', 'pitch'].includes(effect.type) && <div className="mt-2 border-t border-bg-3/30 pt-2">
              <Field label={t("inspector.effects.dryWet")} compact>
                <SliderWithValue
                  min={0}
                  max={1}
                  step={0.01}
                  value={effect.wet}
                  onChange={(wet) => onUpdate(effect.id, { wet })}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </Field>
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function EffectControls({
  effect,
  onChange,
}: {
  effect: Effect;
  onChange: (patch: Partial<Effect>) => void;
}) {
  const { t } = useI18n();
  switch (effect.type) {
    case "gain":
      return (
        <Field label={t("effectParam.gainDb")} compact>
          <SliderWithValue min={-60} max={12} step={0.5} value={effect.gainDb} onChange={(gainDb) => onChange({ gainDb } as Partial<Effect>)} format={(v) => `${v.toFixed(1)}dB`} />
        </Field>
      );
    case "eq3":
      return (
        <div className="flex flex-col gap-2">
          <Eq3Band label={t("effectParam.eq.low")} gain={effect.lowGainDb} freq={effect.lowFreqHz} minFreq={20} onGain={(lowGainDb) => onChange({ lowGainDb } as Partial<Effect>)} onFreq={(lowFreqHz) => onChange({ lowFreqHz } as Partial<Effect>)} />
          <Eq3Band label={t("effectParam.eq.mid")} gain={effect.midGainDb} freq={effect.midFreqHz} minFreq={50} onGain={(midGainDb) => onChange({ midGainDb } as Partial<Effect>)} onFreq={(midFreqHz) => onChange({ midFreqHz } as Partial<Effect>)} />
          <Eq3Band label={t("effectParam.eq.high")} gain={effect.highGainDb} freq={effect.highFreqHz} minFreq={500} onGain={(highGainDb) => onChange({ highGainDb } as Partial<Effect>)} onFreq={(highFreqHz) => onChange({ highFreqHz } as Partial<Effect>)} />
        </div>
      );
    case "eq10":
      return <EQPanel effect={effect as Eq10Effect} onChange={(patch) => onChange(patch as Partial<Effect>)} />;
    case "dynamicEq":
      return (
        <div className="flex flex-col gap-2">
          {effect.bands.map((band, idx) => (
            <DynamicBand
              key={band.id}
              index={idx}
              band={band}
              onChange={(patch) => {
                const bands = effect.bands.map((b, i) => (i === idx ? { ...b, ...patch } : b));
                onChange({ bands } as Partial<Effect>);
              }}
            />
          ))}
        </div>
      );
    case "compressor":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label="Thresh" min={-60} max={0} step={0.5} value={effect.thresholdDb} onChange={(thresholdDb) => onChange({ thresholdDb } as Partial<Effect>)} suffix="dB" />
          <MiniSlider label="Ratio" min={1} max={20} step={0.1} value={effect.ratio} onChange={(ratio) => onChange({ ratio } as Partial<Effect>)} suffix=":1" />
          <MiniSlider label="Attack" min={0.001} max={0.12} step={0.001} value={effect.attackSec} onChange={(attackSec) => onChange({ attackSec } as Partial<Effect>)} suffix="s" decimals={3} />
          <MiniSlider label="Release" min={0.02} max={0.8} step={0.01} value={effect.releaseSec} onChange={(releaseSec) => onChange({ releaseSec } as Partial<Effect>)} suffix="s" decimals={2} />
          <MiniSlider label="Knee" min={0} max={40} step={0.5} value={effect.kneeDb} onChange={(kneeDb) => onChange({ kneeDb } as Partial<Effect>)} suffix="dB" />
          <MiniSlider label="Makeup" min={0} max={18} step={0.5} value={effect.makeupDb} onChange={(makeupDb) => onChange({ makeupDb } as Partial<Effect>)} suffix="dB" />
        </div>
      );
    case "multibandCompressor":
      return (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <MiniSlider label="X low" min={60} max={600} step={5} value={effect.crossoversHz[0]} onChange={(v) => onChange({ crossoversHz: [v, effect.crossoversHz[1]] } as Partial<Effect>)} suffix="Hz" decimals={0} />
            <MiniSlider label="X high" min={900} max={9000} step={20} value={effect.crossoversHz[1]} onChange={(v) => onChange({ crossoversHz: [effect.crossoversHz[0], v] } as Partial<Effect>)} suffix="Hz" decimals={0} />
          </div>
          {effect.bands.map((band, idx) => (
            <MultibandBand
              key={band.id}
              band={band}
              onChange={(patch) => {
                const bands = effect.bands.map((b, i) => (i === idx ? { ...b, ...patch } : b)) as typeof effect.bands;
                onChange({ bands } as Partial<Effect>);
              }}
            />
          ))}
        </div>
      );
    case "deEsser":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label="Focus" min={3000} max={12000} step={50} value={effect.focusFreqHz} onChange={(focusFreqHz) => onChange({ focusFreqHz } as Partial<Effect>)} suffix="Hz" decimals={0} />
          <MiniSlider label="Thresh" min={-60} max={-6} step={0.5} value={effect.thresholdDb} onChange={(thresholdDb) => onChange({ thresholdDb } as Partial<Effect>)} suffix="dB" />
          <MiniSlider label="Range" min={1} max={18} step={0.5} value={effect.rangeDb} onChange={(rangeDb) => onChange({ rangeDb } as Partial<Effect>)} suffix="dB" />
          <MiniSlider label="HF trim" min={-12} max={6} step={0.5} value={effect.highFrequencyDb} onChange={(highFrequencyDb) => onChange({ highFrequencyDb } as Partial<Effect>)} suffix="dB" />
        </div>
      );
    case "limiter":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label="Ceiling" min={-6} max={0} step={0.1} value={effect.ceilingDb} onChange={(ceilingDb) => onChange({ ceilingDb } as Partial<Effect>)} suffix="dB" />
          <MiniSlider label="Release" min={0.005} max={0.5} step={0.005} value={effect.releaseSec} onChange={(releaseSec) => onChange({ releaseSec } as Partial<Effect>)} suffix="s" decimals={3} />
        </div>
      );
    case "softClipper":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label="Drive" min={0} max={18} step={0.2} value={effect.driveDb} onChange={(driveDb) => onChange({ driveDb } as Partial<Effect>)} suffix="dB" />
          <MiniSlider label="Ceiling" min={-6} max={0} step={0.1} value={effect.ceilingDb} onChange={(ceilingDb) => onChange({ ceilingDb } as Partial<Effect>)} suffix="dB" />
          <SelectField label="Mode" value={effect.mode} values={["soft", "hard", "warm"]} onChange={(mode) => onChange({ mode } as Partial<Effect>)} />
          <SelectField label="OS" value={effect.oversampling} values={["none", "2x", "4x"]} onChange={(oversampling) => onChange({ oversampling } as Partial<Effect>)} />
        </div>
      );
    case "saturation":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label="Drive" min={0} max={30} step={0.5} value={effect.driveDb} onChange={(driveDb) => onChange({ driveDb } as Partial<Effect>)} suffix="dB" />
          <SelectField label="Mode" value={effect.mode} values={["tanh", "soft", "hard", "tube", "tape"]} onChange={(mode) => onChange({ mode } as Partial<Effect>)} />
        </div>
      );
    case "exciter":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label="Drive" min={0} max={18} step={0.2} value={effect.driveDb} onChange={(driveDb) => onChange({ driveDb } as Partial<Effect>)} suffix="dB" />
          <MiniSlider label="Freq" min={1500} max={12000} step={50} value={effect.frequencyHz} onChange={(frequencyHz) => onChange({ frequencyHz } as Partial<Effect>)} suffix="Hz" decimals={0} />
          <SelectField label="Mode" value={effect.mode === "harmonic" ? "tube" : effect.mode} values={["tube", "tape", "softClip"]} onChange={(mode) => onChange({ mode } as Partial<Effect>)} />
          <SelectField label="Tone" value={effect.tone} values={["warm", "bright", "gritty"]} onChange={(tone) => onChange({ tone } as Partial<Effect>)} />
        </div>
      );
    case "widener":
      return <MiniSlider label="Width" min={0} max={2} step={0.01} value={effect.width} onChange={(width) => onChange({ width } as Partial<Effect>)} suffix="x" decimals={2} />;
    case "stereoImager":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider disabled={effect.monoCheck} label="Width" min={0} max={1.8} step={0.01} value={effect.width} onChange={(width) => onChange({ width } as Partial<Effect>)} suffix="x" decimals={2} />
          <MiniSlider disabled={effect.monoCheck || !effect.safeBassMono} label="Bass mono" min={60} max={300} step={5} value={effect.bassMonoFreqHz} onChange={(bassMonoFreqHz) => onChange({ bassMonoFreqHz } as Partial<Effect>)} suffix="Hz" decimals={0} />
          <Toggle label="Mono check" checked={effect.monoCheck} onChange={(monoCheck) => onChange({ monoCheck } as Partial<Effect>)} />
          <Toggle disabled={effect.monoCheck} label="Safe bass" checked={effect.safeBassMono} onChange={(safeBassMono) => onChange({ safeBassMono } as Partial<Effect>)} />
        </div>
      );
    case "transientShaper":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label="High band" min={-1} max={1} step={0.01} value={effect.attack} onChange={(attack) => onChange({ attack } as Partial<Effect>)} suffix="" decimals={2} />
          <MiniSlider label="Body band" min={-1} max={1} step={0.01} value={effect.sustain} onChange={(sustain) => onChange({ sustain } as Partial<Effect>)} suffix="" decimals={2} />
          <SelectField label="Mode" value={effect.mode} values={["soft", "hard"]} onChange={(mode) => onChange({ mode } as Partial<Effect>)} />
        </div>
      );
    case "noiseGate":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label="Thresh" min={-80} max={-12} step={0.5} value={effect.thresholdDb} onChange={(thresholdDb) => onChange({ thresholdDb } as Partial<Effect>)} suffix="dB" />
          <MiniSlider label="Range" min={0} max={80} step={1} value={effect.rangeDb} onChange={(rangeDb) => onChange({ rangeDb } as Partial<Effect>)} suffix="dB" decimals={0} />
        </div>
      );
    case "repair":
      return (
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Mode" value={effect.mode} values={["noise", "hum", "harshness"]} onChange={(mode) => onChange({ mode } as Partial<Effect>)} />
          <MiniSlider label="Amount" min={0} max={1} step={0.01} value={effect.amount} onChange={(amount) => onChange({ amount } as Partial<Effect>)} suffix="" decimals={2} />
          {effect.mode === "hum" && <MiniSlider label="Hum" min={50} max={60} step={10} value={effect.humFreqHz} onChange={(humFreqHz) => onChange({ humFreqHz } as Partial<Effect>)} suffix="Hz" decimals={0} />}
        </div>
      );
    case "utility":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label="Trim" min={-24} max={24} step={0.1} value={effect.trimDb} onChange={(trimDb) => onChange({ trimDb } as Partial<Effect>)} suffix="dB" />
          <MiniSlider label="HPF" min={20} max={1000} step={5} value={effect.highPassHz} onChange={(highPassHz) => onChange({ highPassHz } as Partial<Effect>)} suffix="Hz" decimals={0} />
          <MiniSlider label="LPF" min={1000} max={20000} step={100} value={effect.lowPassHz} onChange={(lowPassHz) => onChange({ lowPassHz } as Partial<Effect>)} suffix="Hz" decimals={0} />
          <SelectField disabled={effect.mono} label="Channel" value={effect.channelMode} values={["stereo", "mono", "left", "right"]} onChange={(channelMode) => onChange({ channelMode } as Partial<Effect>)} />
          <Toggle label="Phase invert" checked={effect.phaseInvert} onChange={(phaseInvert) => onChange({ phaseInvert } as Partial<Effect>)} />
          <Toggle label="Mono" checked={effect.mono} onChange={(mono) => onChange({ mono } as Partial<Effect>)} />
        </div>
      );
    case "reverb":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label={t("effectParam.reverb.decay")} min={0.1} max={6} step={0.1} value={effect.decaySec} onChange={(decaySec) => onChange({ decaySec } as Partial<Effect>)} suffix="s" decimals={1} />
          <MiniSlider label={t("effectParam.reverb.predelay")} min={0} max={200} step={1} value={effect.preDelayMs} onChange={(preDelayMs) => onChange({ preDelayMs } as Partial<Effect>)} suffix="ms" decimals={0} />
        </div>
      );
    case "delay":
      return (
        <div className="grid grid-cols-2 gap-2">
          <MiniSlider label={t("effectParam.delay.time")} min={0.01} max={2} step={0.01} value={effect.timeSec} onChange={(timeSec) => onChange({ timeSec } as Partial<Effect>)} suffix="s" decimals={2} />
          <MiniSlider label={t("effectParam.delay.feedback")} min={0} max={0.95} step={0.01} value={effect.feedback} onChange={(feedback) => onChange({ feedback } as Partial<Effect>)} suffix="" decimals={2} />
        </div>
      );
    case "speed":
      return <MiniSlider label={t("effectParam.speed.rate")} min={0.25} max={4} step={0.01} value={effect.rate} onChange={(rate) => onChange({ rate } as Partial<Effect>)} suffix="x" decimals={2} />;
    case "pitch":
      return <MiniSlider label={t("effectParam.pitch.semitones")} min={-12} max={12} step={1} value={effect.semitones} onChange={(semitones) => onChange({ semitones } as Partial<Effect>)} suffix="st" decimals={0} />;
  }
}

function Eq3Band({
  label,
  gain,
  freq,
  minFreq,
  onGain,
  onFreq,
}: {
  label: string;
  gain: number;
  freq: number;
  minFreq: number;
  onGain: (v: number) => void;
  onFreq: (v: number) => void;
}) {
  return (
    <Field label={`${label} ${gain.toFixed(1)}dB @ ${freq}Hz`} compact>
      <div className="flex gap-2">
        <input type="range" min={-18} max={18} step={0.5} value={gain} onChange={(e) => onGain(Number(e.target.value))} className="h-1 flex-1" />
        <input type="number" value={freq} onChange={(e) => onFreq(Math.max(minFreq, Number(e.target.value)))} className="w-14 rounded bg-bg-3 px-1 text-[9px] outline-none" />
      </div>
    </Field>
  );
}

function DynamicBand({
  index,
  band,
  onChange,
}: {
  index: number;
  band: DynamicEqBand;
  onChange: (patch: Partial<DynamicEqBand>) => void;
}) {
  const { locale } = useI18n();
  return (
    <div className="rounded border border-bg-3/70 bg-bg-0/35 p-2">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-gray-500">{locale === "ru" ? "Полоса" : "Band"} {index + 1}</div>
      <div className="grid grid-cols-2 gap-2">
        <MiniSlider label="Freq" min={40} max={18000} step={10} value={band.freqHz} onChange={(freqHz) => onChange({ freqHz })} suffix="Hz" decimals={0} />
        <MiniSlider label="Gain" min={-18} max={18} step={0.5} value={band.gainDb} onChange={(gainDb) => onChange({ gainDb })} suffix="dB" />
      </div>
    </div>
  );
}

function MultibandBand({
  band,
  onChange,
}: {
  band: MultibandCompressorBand;
  onChange: (patch: Partial<MultibandCompressorBand>) => void;
}) {
  const labelText = useControlLabel();
  return (
    <div className="rounded border border-bg-3/70 bg-bg-0/35 p-2">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-gray-500">{labelText(band.name)}</div>
      <div className="grid grid-cols-2 gap-2">
        <MiniSlider label="Thresh" min={-60} max={0} step={0.5} value={band.thresholdDb} onChange={(thresholdDb) => onChange({ thresholdDb })} suffix="dB" />
        <MiniSlider label="Ratio" min={1} max={12} step={0.1} value={band.ratio} onChange={(ratio) => onChange({ ratio })} suffix=":1" decimals={1} />
        <MiniSlider label="Attack" min={0.001} max={0.12} step={0.001} value={band.attackSec} onChange={(attackSec) => onChange({ attackSec })} suffix="s" decimals={3} />
        <MiniSlider label="Makeup" min={-6} max={12} step={0.5} value={band.makeupDb} onChange={(makeupDb) => onChange({ makeupDb })} suffix="dB" />
      </div>
    </div>
  );
}

function MiniSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix,
  decimals = 1,
  disabled = false,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
  decimals?: number;
  disabled?: boolean;
}) {
  const labelText = useControlLabel();
  return (
    <Field label={`${label} ${value.toFixed(decimals)}${suffix}`} compact>
      <input disabled={disabled} aria-label={labelText(label)} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-full disabled:opacity-40" />
    </Field>
  );
}

function Field({
  label,
  compact,
  children,
}: {
  label: string;
  compact?: boolean;
  children: ReactNode;
}) {
  const labelText = useControlLabel();
  return (
    <div className={compact ? "mb-1" : "mb-3"}>
      <div className="mb-1 truncate text-[9px] font-bold uppercase tracking-normal text-gray-500">{labelText(label)}</div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const labelText = useControlLabel();
  return (
    <label className="flex min-h-8 items-center justify-between gap-2 rounded border border-bg-3/60 bg-bg-0/35 px-2 text-[10px] text-gray-300">
      <span className="truncate">{labelText(label)}</span>
      <input disabled={disabled} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  values,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  values: T[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const labelText = useControlLabel();
  return (
    <Field label={label} compact>
      <select disabled={disabled} aria-label={labelText(label)} className="w-full rounded border border-bg-3 bg-bg-0 px-2 py-1 text-[10px] outline-none disabled:opacity-40" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {values.map((item) => (
          <option key={item} value={item}>
            {labelText(item)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function SliderWithValue({
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 min-w-0 flex-1" />
      <span className="w-12 text-right font-mono text-[9px] tabular-nums text-gray-400">{format(value)}</span>
    </div>
  );
}
