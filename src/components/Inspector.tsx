import { useStore } from "../state/store";
import type { Effect, Track } from "../types";
import { EFFECT_LABELS } from "../state/effects";

export function Inspector() {
  const project = useStore((s) => s.project);
  const ui = useStore((s) => s.ui);
  const resizeClip = useStore((s) => s.resizeClip);
  const deleteClip = useStore((s) => s.deleteClip);

  if (ui.inspectorMode === "clip" && ui.selectedClipId) {
    const clip = project.clips.find((c) => c.id === ui.selectedClipId);
    if (!clip) return <EmptyInspector />;
    const asset = project.assets[clip.assetId];
    return (
      <div className="w-80 bg-bg-1 border-l border-bg-3 p-3 overflow-auto no-scrollbar">
        <div className="text-xs uppercase text-gray-500 tracking-wider mb-2">Clip</div>
        <div className="text-sm mb-1">{asset?.name ?? "—"}</div>
        <Field label="Start (s)">
          <NumberInput
            value={clip.start}
            step={0.01}
            onChange={(v) => resizeClip(clip.id, v, clip.duration, clip.offset)}
          />
        </Field>
        <Field label="Duration (s)">
          <NumberInput
            value={clip.duration}
            step={0.01}
            onChange={(v) => resizeClip(clip.id, clip.start, Math.max(0.05, v), clip.offset)}
          />
        </Field>
        <Field label="Asset offset (s)">
          <NumberInput
            value={clip.offset}
            step={0.01}
            onChange={(v) =>
              resizeClip(clip.id, clip.start, clip.duration, Math.max(0, v))
            }
          />
        </Field>
        <button
          className="mt-3 w-full py-1.5 rounded bg-red-900/30 hover:bg-red-900/60 text-red-300 text-sm"
          onClick={() => deleteClip(clip.id)}
        >
          Delete clip
        </button>
      </div>
    );
  }

  const track = project.tracks.find((t) => t.id === ui.selectedTrackId);
  if (!track) return <EmptyInspector />;
  return <TrackInspector track={track} />;
}

function EmptyInspector() {
  return (
    <div className="w-80 bg-bg-1 border-l border-bg-3 p-3 text-xs text-gray-500">
      Select a track or clip.
    </div>
  );
}

function TrackInspector({ track }: { track: Track }) {
  const updateEffect = useStore((s) => s.updateEffect);
  const removeEffect = useStore((s) => s.removeEffect);
  const reorderEffect = useStore((s) => s.reorderEffect);

  return (
    <div className="w-80 bg-bg-1 border-l border-bg-3 p-3 overflow-auto no-scrollbar">
      <div className="text-xs uppercase text-gray-500 tracking-wider mb-2">Track</div>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-4 rounded-sm" style={{ background: track.color }} />
        <div className="text-sm flex-1">{track.name}</div>
      </div>

      <div className="text-xs uppercase text-gray-500 tracking-wider mb-2 flex items-center justify-between">
        <span>Effects chain</span>
        <span className="text-[10px] normal-case text-gray-600">drag to reorder</span>
      </div>
      {track.effects.length === 0 && (
        <div className="text-xs text-gray-600">No effects. Add from the sidebar.</div>
      )}
      <div className="flex flex-col gap-2">
        {track.effects.map((e, i) => (
          <div
            key={e.id}
            className="bg-bg-2 rounded p-2"
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
              if (Number.isFinite(from) && from !== i) reorderEffect(track.id, from, i);
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm flex items-center gap-2">
                <span className="text-gray-500 text-[10px]">#{i + 1}</span>
                {EFFECT_LABELS[e.type]}
              </div>
              <div className="flex items-center gap-1">
                <button
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    e.bypass ? "bg-red-500/70 text-black" : "bg-bg-3 text-gray-300"
                  }`}
                  onClick={() => updateEffect(track.id, e.id, { bypass: !e.bypass })}
                  title="Bypass"
                >
                  BYP
                </button>
                <button
                  className="text-[10px] px-1.5 py-0.5 rounded bg-bg-3 text-gray-400 hover:text-red-400"
                  onClick={() => removeEffect(track.id, e.id)}
                >
                  ✕
                </button>
              </div>
            </div>
            <EffectControls effect={e} onChange={(patch) => updateEffect(track.id, e.id, patch)} />
            <Field label="Dry / Wet" compact>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={e.wet}
                onChange={(ev) => updateEffect(track.id, e.id, { wet: Number(ev.target.value) })}
                className="w-full"
              />
            </Field>
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
  switch (effect.type) {
    case "gain":
      return (
        <Field label="Gain (dB)" compact>
          <SliderWithValue
            min={-60}
            max={12}
            step={0.5}
            value={effect.gainDb}
            onChange={(v) => onChange({ gainDb: v })}
            format={(v) => `${v.toFixed(1)}dB`}
          />
        </Field>
      );
    case "eq3":
      return (
        <div>
          <Field label={`Low ${effect.lowGainDb.toFixed(1)}dB @ ${effect.lowFreqHz}Hz`} compact>
            <div className="flex gap-2">
              <input
                type="range"
                min={-18}
                max={18}
                step={0.5}
                value={effect.lowGainDb}
                onChange={(e) => onChange({ lowGainDb: Number(e.target.value) })}
                className="flex-1"
              />
              <input
                type="number"
                value={effect.lowFreqHz}
                onChange={(e) => onChange({ lowFreqHz: Math.max(20, Number(e.target.value)) })}
                className="w-16 bg-bg-3 px-1 rounded text-xs"
              />
            </div>
          </Field>
          <Field label={`Mid ${effect.midGainDb.toFixed(1)}dB @ ${effect.midFreqHz}Hz`} compact>
            <div className="flex gap-2">
              <input
                type="range"
                min={-18}
                max={18}
                step={0.5}
                value={effect.midGainDb}
                onChange={(e) => onChange({ midGainDb: Number(e.target.value) })}
                className="flex-1"
              />
              <input
                type="number"
                value={effect.midFreqHz}
                onChange={(e) => onChange({ midFreqHz: Math.max(50, Number(e.target.value)) })}
                className="w-16 bg-bg-3 px-1 rounded text-xs"
              />
            </div>
          </Field>
          <Field label={`High ${effect.highGainDb.toFixed(1)}dB @ ${effect.highFreqHz}Hz`} compact>
            <div className="flex gap-2">
              <input
                type="range"
                min={-18}
                max={18}
                step={0.5}
                value={effect.highGainDb}
                onChange={(e) => onChange({ highGainDb: Number(e.target.value) })}
                className="flex-1"
              />
              <input
                type="number"
                value={effect.highFreqHz}
                onChange={(e) => onChange({ highFreqHz: Math.max(500, Number(e.target.value)) })}
                className="w-16 bg-bg-3 px-1 rounded text-xs"
              />
            </div>
          </Field>
        </div>
      );
    case "reverb":
      return (
        <>
          <Field label={`Decay ${effect.decaySec.toFixed(2)}s`} compact>
            <input
              type="range"
              min={0.1}
              max={6}
              step={0.1}
              value={effect.decaySec}
              onChange={(e) => onChange({ decaySec: Number(e.target.value) })}
              className="w-full"
            />
          </Field>
          <Field label={`Pre-delay ${effect.preDelayMs.toFixed(0)}ms`} compact>
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={effect.preDelayMs}
              onChange={(e) => onChange({ preDelayMs: Number(e.target.value) })}
              className="w-full"
            />
          </Field>
        </>
      );
    case "delay":
      return (
        <>
          <Field label={`Time ${(effect.timeSec * 1000).toFixed(0)}ms`} compact>
            <input
              type="range"
              min={0.01}
              max={2}
              step={0.01}
              value={effect.timeSec}
              onChange={(e) => onChange({ timeSec: Number(e.target.value) })}
              className="w-full"
            />
          </Field>
          <Field label={`Feedback ${(effect.feedback * 100).toFixed(0)}%`} compact>
            <input
              type="range"
              min={0}
              max={0.95}
              step={0.01}
              value={effect.feedback}
              onChange={(e) => onChange({ feedback: Number(e.target.value) })}
              className="w-full"
            />
          </Field>
        </>
      );
    case "speed":
      return (
        <Field label={`Rate ${effect.rate.toFixed(2)}x`} compact>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.01}
            value={effect.rate}
            onChange={(e) => onChange({ rate: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
      );
    case "pitch":
      return (
        <Field label={`${effect.semitones > 0 ? "+" : ""}${effect.semitones} semitones`} compact>
          <input
            type="range"
            min={-12}
            max={12}
            step={1}
            value={effect.semitones}
            onChange={(e) => onChange({ semitones: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
      );
  }
}

function Field({
  label,
  compact,
  children,
}: {
  label: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={compact ? "mb-1" : "mb-2"}>
      <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  step = 0.1,
  onChange,
}: {
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full bg-bg-2 px-2 py-1 rounded text-sm"
    />
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
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="tabular-nums text-[10px] text-gray-400 w-14 text-right">
        {format(value)}
      </span>
    </div>
  );
}
