import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { getAudioEngine } from "../audio/AudioEngine";
import { decodeAndAnalyze } from "../audio/waveform";
import { uid } from "../utils/id";
import type { AudioAsset, EffectType } from "../types";
import { EFFECT_LABELS } from "../state/effects";

export function Sidebar() {
  const project = useStore((s) => s.project);
  const addAsset = useStore((s) => s.addAsset);
  const addClip = useStore((s) => s.addClip);
  const addTrack = useStore((s) => s.addTrack);
  const addEffect = useStore((s) => s.addEffect);
  const ui = useStore((s) => s.ui);
  const setSelected = useStore((s) => s.setSelected);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFiles = async (files: FileList | File[]) => {
    setLoading(true);
    const engine = getAudioEngine();
    await engine.resume();
    for (const f of Array.from(files)) {
      try {
        const arr = await f.arrayBuffer();
        const { buffer, peaks, peaksPerSecond } = await decodeAndAnalyze(engine.ctx, arr);
        const id = uid("asset");
        engine.registerBuffer(id, buffer);
        const asset: AudioAsset = {
          id,
          name: f.name,
          durationSec: buffer.duration,
          sampleRate: buffer.sampleRate,
          numChannels: buffer.numberOfChannels,
          peaks,
          peaksPerSecond,
        };
        addAsset(asset);
      } catch (err) {
        console.error("Failed to decode", f.name, err);
      }
    }
    setLoading(false);
  };

  const addClipFromAsset = (asset: AudioAsset) => {
    const trackId = ui.selectedTrackId ?? project.tracks[0]?.id;
    if (!trackId) return;
    const maxEnd = project.clips
      .filter((c) => c.trackId === trackId)
      .reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    addClip({
      trackId,
      assetId: asset.id,
      start: maxEnd,
      offset: 0,
      duration: asset.durationSec,
    });
  };

  const selectedTrack = project.tracks.find((t) => t.id === ui.selectedTrackId);
  const effectTypes: EffectType[] = ["gain", "eq3", "reverb", "delay", "speed", "pitch"];

  return (
    <aside className="panel-shell w-full shrink-0 overflow-hidden lg:w-72 xl:w-80">
      <div className="flex h-full min-h-[18rem] flex-col">
        <div
          className="border-b border-white/10 p-4"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
              void handleFiles(e.dataTransfer.files);
            }
          }}
        >
          <div className="section-label">Library</div>
          <button
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-[20px] border border-dashed border-emerald-400/25 bg-emerald-400/10 px-4 py-4 text-sm font-semibold text-emerald-50 hover:bg-emerald-400/15"
            onClick={() => fileInputRef.current?.click()}
          >
            {loading ? "Loading..." : "Import audio"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <div className="mt-2 text-xs leading-5 text-slate-400">
            Drag audio files straight into the browser or start with the import
            button.
          </div>
        </div>

        <div className="flex-1 overflow-auto no-scrollbar">
          <section className="p-4">
            <div className="section-label">Assets</div>
            <div className="mt-3 flex flex-col gap-2">
              {Object.values(project.assets).length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-slate-400">
                  No files loaded yet. Import a loop or vocal take to start
                  building the session.
                </div>
              )}
              {Object.values(project.assets).map((a) => (
                <button
                  key={a.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.08]"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-mini-daw-asset", a.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onDoubleClick={() => addClipFromAsset(a)}
                  title="Double-click to add to the selected track, or drag onto the timeline."
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-slate-100">
                      {a.name}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 font-mono text-[11px] tabular-nums text-slate-300">
                      {a.durationSec.toFixed(1)}s
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-400">
                    Drop onto a track or double-click to append it to the
                    selected track.
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="border-t border-white/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="section-label">Tracks</div>
                <div className="mt-1 text-xs text-slate-400">
                  Select a lane to tune routing and effects.
                </div>
              </div>
              <button
                className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.1]"
                onClick={() => addTrack()}
              >
                Add
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {project.tracks.map((t) => (
                <button
                  key={t.id}
                  onClick={() =>
                    setSelected({
                      selectedTrackId: t.id,
                      inspectorMode: "track",
                      selectedClipId: null,
                    })
                  }
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                    ui.selectedTrackId === t.id && ui.inspectorMode === "track"
                      ? "border-emerald-400/30 bg-emerald-400/10 shadow-[0_12px_30px_rgba(74,222,128,0.12)]"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.08]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-3 w-3 rounded-full shadow-[0_0_20px_currentColor]"
                      style={{ background: t.color, color: t.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-100">
                        {t.name}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {t.effects.length} effects in chain
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {selectedTrack && (
            <section className="border-t border-white/10 p-4">
              <div className="section-label">Add effect - {selectedTrack.name}</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {effectTypes.map((t) => (
                  <button
                    key={t}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-white/[0.09]"
                    onClick={() => addEffect(selectedTrack.id, t)}
                  >
                    Add {EFFECT_LABELS[t]}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </aside>
  );
}
