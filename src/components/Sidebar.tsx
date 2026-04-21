import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { getAudioEngine } from "../audio/AudioEngine";
import { decodeAndAnalyze } from "../audio/waveform";
import { uid } from "../utils/id";
import type { AudioAsset } from "../types";
import { EFFECT_LABELS } from "../state/effects";
import type { EffectType } from "../types";

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
    <aside className="w-64 bg-bg-1 border-r border-bg-3 flex flex-col flex-shrink-0 overflow-hidden">
      <div
        className="p-3 border-b border-bg-3 flex-shrink-0"
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
        <div className="text-[10px] uppercase text-gray-500 tracking-widest mb-2 font-bold">Files</div>
        <button
          className="w-full py-2 rounded bg-bg-2 hover:bg-bg-3 text-xs transition-colors border border-bg-3"
          onClick={() => fileInputRef.current?.click()}
        >
          {loading ? "Decoding..." : "Import Audio"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <div className="text-[9px] text-gray-600 mt-2 text-center italic">Or drag files here</div>
      </div>

      <div className="overflow-y-auto flex-1 no-scrollbar">
        <div className="p-3">
          <div className="text-[10px] uppercase text-gray-500 tracking-widest mb-2 font-bold">Assets</div>
          <div className="flex flex-col gap-1">
            {Object.values(project.assets).length === 0 && (
              <div className="text-[10px] text-gray-600 italic p-2 bg-bg-0/50 rounded border border-dashed border-bg-3">
                No files loaded
              </div>
            )}
            {Object.values(project.assets).map((a) => (
              <div
                key={a.id}
                className="bg-bg-2 hover:bg-bg-3 rounded px-2 py-1.5 flex items-center justify-between gap-2 cursor-pointer transition-colors border border-transparent hover:border-bg-3"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-mini-daw-asset", a.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onDoubleClick={() => addClipFromAsset(a)}
                title="Double-click to add to selected track"
              >
                <span className="text-xs truncate flex-1">{a.name}</span>
                <span className="text-[9px] text-gray-500 tabular-nums">
                  {a.durationSec.toFixed(1)}s
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-bg-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase text-gray-500 tracking-widest font-bold">Tracks</div>
            <button
              className="text-[10px] w-5 h-5 flex items-center justify-center rounded bg-bg-2 hover:bg-bg-3 border border-bg-3 transition-colors"
              onClick={() => addTrack()}
              title="Add Track"
            >
              +
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {project.tracks.map((t) => (
              <button
                key={t.id}
                onClick={() =>
                  setSelected({ selectedTrackId: t.id, inspectorMode: "track", selectedClipId: null })
                }
                className={`text-left px-2 py-1.5 rounded flex items-center gap-2 transition-colors border ${
                  ui.selectedTrackId === t.id && ui.inspectorMode === "track"
                    ? "bg-bg-3 border-accent/30"
                    : "bg-bg-2 border-transparent hover:bg-bg-3"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: t.color }}
                />
                <span className="text-xs truncate">{t.name}</span>
              </button>
            ))}
          </div>
        </div>

        {selectedTrack && (
          <div className="p-3 border-t border-bg-3">
            <div className="text-[10px] uppercase text-gray-500 tracking-widest mb-2 font-bold">
              Add Effect
            </div>
            <div className="grid grid-cols-2 gap-1">
              {effectTypes.map((t) => (
                <button
                  key={t}
                  className="text-[10px] px-2 py-1.5 rounded bg-bg-2 hover:bg-bg-3 border border-bg-3 transition-colors text-left truncate"
                  onClick={() => addEffect(selectedTrack.id, t)}
                >
                  + {EFFECT_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
