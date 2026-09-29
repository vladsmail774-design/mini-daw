import type { ReactNode } from "react";
import { useStore } from "../state/store";
import type { Clip, Track } from "../types";
import { useI18n } from "../i18n";
import { EffectRack } from "./EffectRack";
import { MeterPanel } from "./MeterPanel";

export function Inspector() {
  const project = useStore((s) => s.project);
  const ui = useStore((s) => s.ui);
  const { t } = useI18n();

  if (ui.inspectorMode === "clip" && ui.selectedClipId) {
    const clip = project.clips.find((c) => c.id === ui.selectedClipId);
    if (!clip) return <EmptyInspector />;
    return <ClipInspector clip={clip} assetName={project.assets[clip.assetId]?.name ?? "-"} />;
  }

  if (ui.inspectorMode === "master") {
    return <MasterInspector />;
  }

  const track = project.tracks.find((t) => t.id === ui.selectedTrackId);
  if (!track) return <EmptyInspector />;
  return <TrackInspector track={track} title={t("inspector.track.title")} />;
}

function ClipInspector({ clip, assetName }: { clip: Clip; assetName: string }) {
  const resizeClip = useStore((s) => s.resizeClip);
  const updateClip = useStore((s) => s.updateClip);
  const deleteClip = useStore((s) => s.deleteClip);
  const { t, locale } = useI18n();
  const text = (ru: string, en: string) => locale === "ru" ? ru : en;

  return (
    <Panel>
      <PanelHeader eyebrow={t("inspector.clip.title")} title={assetName} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        <Field label={text("Название клипа", "Clip name")}><input aria-label={text("Название клипа", "Clip name")} className="w-full" value={clip.name ?? assetName} onChange={event => updateClip(clip.id, { name: event.target.value })} /></Field>
        <Field label={t("inspector.clip.start")}>
          <NumberInput value={clip.start} step={0.01} onChange={(v) => resizeClip(clip.id, v, clip.duration, clip.offset)} />
        </Field>
        <Field label={t("inspector.clip.duration")}>
          <NumberInput value={clip.duration} step={0.01} onChange={(v) => resizeClip(clip.id, clip.start, Math.max(0.05, v), clip.offset)} />
        </Field>
        <Field label={t("inspector.clip.offset")}>
          <NumberInput value={clip.offset} step={0.01} onChange={(v) => resizeClip(clip.id, clip.start, clip.duration, Math.max(0, v))} />
        </Field>
        <Field label={text("Уровень клипа", "Clip gain")}>
          <NumberInput value={clip.gainDb ?? 0} step={0.1} onChange={(gainDb) => updateClip(clip.id, { gainDb })} suffix="dB" />
        </Field>
        <Field label={text("Нарастание, с", "Fade in, s")}><NumberInput value={clip.fadeInSec ?? 0} step={0.01} onChange={fadeInSec => updateClip(clip.id, { fadeInSec })} /></Field>
        <Field label={text("Затухание, с", "Fade out, s")}><NumberInput value={clip.fadeOutSec ?? 0} step={0.01} onChange={fadeOutSec => updateClip(clip.id, { fadeOutSec })} /></Field>
        <button onClick={() => useStore.getState().crossfadeSelected()}>{text("Кроссфейд выделенных пересечений", "Crossfade selected overlaps")}</button>
        <p className="mt-2 text-gray-400">{text("Пересекающиеся клипы суммируются. Кроссфейд создаёт взаимные линейные фейды.", "Overlapping clips mix. Crossfade creates complementary linear fades.")}</p>
        <button className="mt-4 w-full rounded-md border border-red-900/40 bg-red-950/40 py-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-red-300 transition-colors hover:bg-red-950/60" onClick={() => deleteClip(clip.id)}>
          {t("inspector.clip.delete")}
        </button>
      </div>
    </Panel>
  );
}

function TrackInspector({ track, title }: { track: Track; title: string }) {
  const updateTrack = useStore((s) => s.updateTrack);
  const updateEffect = useStore((s) => s.updateEffect);
  const removeEffect = useStore((s) => s.removeEffect);
  const reorderEffect = useStore((s) => s.reorderEffect);
  const addEffect = useStore((s) => s.addEffect);
  const clearTrackEffects = useStore((s) => s.clearTrackEffects);
  const copyTrackChain = useStore((s) => s.copyTrackChain);
  const pasteTrackChain = useStore((s) => s.pasteTrackChain);
  const clipboardAvailable = useStore((s) => Boolean(s.fxClipboard));
  const { locale } = useI18n();
  const text = (ru: string, en: string) => locale === "ru" ? ru : en;

  return (
    <Panel>
      <PanelHeader eyebrow={title} title={track.name} color={track.color} />
      <div className="border-b border-bg-3/80 p-3">
        <MeterPanel trackId={track.id} compact showSpectrum />
        <div className="mt-3 rounded-md border border-bg-3/70 bg-bg-0/40 p-2">
          <div className="mb-2 flex items-center gap-1.5">
            <button
              className={`h-7 w-7 rounded-md text-[10px] font-bold ${
                track.mute ? "bg-red-500 text-black" : "bg-bg-2 text-gray-400 hover:bg-bg-3"
              }`}
              onClick={() => updateTrack(track.id, { mute: !track.mute })}
            >
              M
            </button>
            <button
              className={`h-7 w-7 rounded-md text-[10px] font-bold ${
                track.solo ? "bg-yellow-400 text-black" : "bg-bg-2 text-gray-400 hover:bg-bg-3"
              }`}
              onClick={() => updateTrack(track.id, { solo: !track.solo })}
            >
              S
            </button>
            <input
              className="min-w-0 flex-1 rounded border border-bg-3 bg-bg-2 px-2 py-1 text-xs font-bold outline-none"
              value={track.name}
              onChange={(e) => updateTrack(track.id, { name: e.target.value })}
            />
          </div>
          <MiniTrackSlider
            label={text("Громкость", "Volume")}
            value={track.volumeDb}
            min={-60}
            max={6}
            step={0.5}
            suffix="dB"
            onChange={(volumeDb) => updateTrack(track.id, { volumeDb })}
          />
          <MiniTrackSlider
            label={text("Панорама", "Pan")}
            value={track.pan}
            min={-1}
            max={1}
            step={0.01}
            suffix=""
            onChange={(pan) => updateTrack(track.id, { pan })}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        <EffectRack
          title={text("Эффекты дорожки", "Track effects")}
          effects={track.effects}
          clipboardAvailable={clipboardAvailable}
          onAdd={(type) => addEffect(track.id, type)}
          onUpdate={(effectId, patch) => updateEffect(track.id, effectId, patch)}
          onRemove={(effectId) => removeEffect(track.id, effectId)}
          onReorder={(from, to) => reorderEffect(track.id, from, to)}
          onCopy={() => copyTrackChain(track.id)}
          onPaste={() => pasteTrackChain(track.id)}
          onClear={() => clearTrackEffects(track.id)}
          bypassed={track.effectsBypassed}
          onSetBypassAll={(bypass) => useStore.getState().setTrackEffectsBypassed(track.id, bypass)}
        />
      </div>
    </Panel>
  );
}

function MasterInspector() {
  const project = useStore((s) => s.project);
  const addMasterEffect = useStore((s) => s.addMasterEffect);
  const updateMasterEffect = useStore((s) => s.updateMasterEffect);
  const removeMasterEffect = useStore((s) => s.removeMasterEffect);
  const reorderMasterEffect = useStore((s) => s.reorderMasterEffect);
  const clearMasterEffects = useStore((s) => s.clearMasterEffects);
  const copyMasterChain = useStore((s) => s.copyMasterChain);
  const pasteMasterChain = useStore((s) => s.pasteMasterChain);
  const clipboardAvailable = useStore((s) => Boolean(s.fxClipboard));
  const { locale } = useI18n();
  const text = (ru: string, en: string) => locale === "ru" ? ru : en;

  return (
    <Panel>
      <PanelHeader eyebrow={text("Мастер", "Master")} title={text("Выход микса", "Mix output")} color="#4ade80" />
      <div className="border-b border-bg-3/80 p-3">
        <MeterPanel compact showSpectrum />

      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        <EffectRack
          title={text("Эффекты мастера", "Master effects")}
          master
          effects={project.masterEffects}
          clipboardAvailable={clipboardAvailable}
          onAdd={addMasterEffect}
          onUpdate={updateMasterEffect}
          onRemove={removeMasterEffect}
          onReorder={reorderMasterEffect}
          onCopy={copyMasterChain}
          onPaste={pasteMasterChain}
          onClear={clearMasterEffects}
          bypassed={project.masterEffectsBypassed}
          onSetBypassAll={(bypass) => useStore.getState().setMasterEffectsBypassed(bypass)}
        />
      </div>
    </Panel>
  );
}

function EmptyInspector() {
  const { t } = useI18n();
  return (
    <Panel>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
        <div className="h-11 w-11 rounded-full border-2 border-dashed border-bg-3/70 bg-bg-2/50" aria-hidden />
        <p className="max-w-[14rem] text-xs leading-relaxed text-gray-500">{t("inspector.empty")}</p>
      </div>
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="flex w-80 max-[1100px]:w-72 flex-shrink-0 flex-col overflow-hidden border-l border-bg-3 bg-bg-1">{children}</div>;
}

function PanelHeader({
  eyebrow,
  title,
  color,
}: {
  eyebrow: string;
  title: string;
  color?: string;
}) {
  return (
    <div className="flex-shrink-0 border-b border-bg-3 bg-bg-0/35 p-3">
      <div className="panel-section-title mb-1.5">{eyebrow}</div>
      <div className="flex min-w-0 items-center gap-2">
        {color && <span className="h-5 w-1.5 flex-shrink-0 rounded-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" style={{ background: color }} />}
        <div className="min-w-0 truncate text-xs font-semibold">{title}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 truncate text-[9px] font-bold uppercase tracking-normal text-gray-500">{label}</div>
      {children}
    </div>
  );
}

function MiniTrackSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-2 block">
      <div className="mb-1 flex items-center justify-between gap-2 text-[9px] uppercase text-gray-500">
        <span>{label}</span>
        <span className="font-mono tabular-nums">
          {value.toFixed(suffix ? 1 : 2)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full"
      />
    </label>
  );
}

function NumberInput({
  value,
  step = 0.1,
  suffix,
  onChange,
}: {
  value: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 rounded border border-bg-3 bg-bg-2 px-2 py-1.5 text-xs outline-none ring-accent/30 focus:ring-1"
      />
      {suffix && <span className="w-8 text-right text-[10px] text-gray-500">{suffix}</span>}
    </div>
  );
}
