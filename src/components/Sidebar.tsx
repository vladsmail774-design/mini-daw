import { useRef, useState } from "react";
import { cloneEffect, useStore } from "../state/store";
import { importAudioFiles, type AudioImportProgress } from "../audio/importAudioFiles";
import { sourceRate } from "../audio/playback";
import { useI18n } from "../i18n";
import { EFFECT_LABELS, EFFECT_MENU } from "../state/effects";
import { QUICK_CHAINS, applyQuickChainToMaster, applyQuickChainToTrack } from "../state/quickChains";
import { getProjectEpoch, relinkMedia, reportError, useSession } from "../state/session";
import type { AudioAsset, Effect } from "../types";

interface UserPreset { name: string; effects: Effect[] }
function readPreference<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(`mini-daw:${key}`) ?? "null") ?? fallback; } catch { return fallback; } }
function writePreference(key: string, value: unknown) { try { localStorage.setItem(`mini-daw:${key}`, JSON.stringify(value)); } catch (error) { reportError(error); } }

export function Sidebar() {
  const { project, ui, addAsset, addClip, addTrack, setSelected, addEffect, addMasterEffect } = useStore();
  const { t, locale } = useI18n();
  const text = (ru: string, en: string) => locale === "ru" ? ru : en;
  const missingMedia = useSession(s => s.missingMedia);
  const [tab, setTab] = useState<"files" | "effects" | "presets">("files");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<AudioImportProgress | null>(null);
  const [failures, setFailures] = useState<{ file: File; reason: string }[]>([]);
  const [favorites, setFavorites] = useState<string[]>(() => readPreference("favorites", []));
  const [recent, setRecent] = useState<string[]>(() => readPreference("recent-presets", []));
  const [presets, setPresets] = useState<UserPreset[]>(() => readPreference("user-presets", []));
  const [presetName, setPresetName] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const relinkInput = useRef<HTMLInputElement>(null);
  const relinkId = useRef<string>("");
  const abort = useRef<AbortController | null>(null);
  const selectedTrack = project.tracks.find(track => track.id === ui.selectedTrackId);
  const master = ui.inspectorMode === "master";
  const matches = (name: string) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const handleFiles = async (files: FileList | File[]) => {
    if (loading || useSession.getState().busy) return;
    const epoch = getProjectEpoch();
    setLoading(true);
    const list = Array.from(files);
    setFailures(previous => previous.filter(failure => !list.includes(failure.file)));
    const controller = new AbortController(); abort.current = controller;
    try {
      const result = await importAudioFiles(list, setProgress, controller.signal);
      if (getProjectEpoch() !== epoch) return;
      for (const asset of result.assets) addAsset(asset);
      setFailures(previous => [...previous, ...result.failures.map(failure => ({ file: list.find(file => file.name === failure.fileName)!, reason: failure.reason }))]);
    } catch (error) { reportError(error); }
    finally { setLoading(false); setProgress(null); abort.current = null; }
  };
  const insert = (asset: AudioAsset) => {
    const state = useStore.getState();
    let track = state.project.tracks.find(item => item.id === state.ui.selectedTrackId) ?? state.project.tracks[0];
    if (!track) { addTrack(); track = useStore.getState().project.tracks[0]; }
    if (!track || missingMedia.includes(asset.id)) return;
    const start = Math.max(0, ...state.project.clips.filter(clip => clip.trackId === track.id).map(clip => clip.start + clip.duration));
    const id = addClip({ trackId: track.id, assetId: asset.id, start, offset: 0, duration: asset.durationSec / sourceRate(track) });
    setSelected({ selectedClipId: id, selectedTrackId: track.id, inspectorMode: "clip" });
  };
  const recordRecent = (name: string) => { const next = [name, ...recent.filter(item => item !== name)].slice(0, 8); setRecent(next); writePreference("recent-presets", next); };
  const toggleFavorite = (name: string) => { const next = favorites.includes(name) ? favorites.filter(item => item !== name) : [...favorites, name]; setFavorites(next); writePreference("favorites", next); };
  const savePreset = () => {
    const effects = master ? project.masterEffects : selectedTrack?.effects;
    if (!presetName.trim() || !effects?.length) return;
    const next = [...presets.filter(item => item.name !== presetName.trim()), { name: presetName.trim(), effects: structuredClone(effects) }];
    setPresets(next); writePreference("user-presets", next); setPresetName("");
  };
  return <aside className="flex flex-col min-h-0 bg-bg-1" onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void handleFiles(event.dataTransfer.files); } }}>
    <div className="library-tabs" role="tablist" aria-label={text("Библиотека", "Library")}>{(["files", "effects", "presets"] as const).map((item, index) => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{[text("Файлы", "Files"), text("Эффекты", "Effects"), text("Пресеты", "Presets")][index]}</button>)}</div>
    <div className="library-content custom-scrollbar">
      <input data-history="off" className="library-search" type="search" aria-label={text("Поиск файлов и дорожек", "Search files and tracks")} placeholder={text("Поиск…", "Search…")} value={query} onChange={e => setQuery(e.target.value)} />
      {tab === "files" && <>
        <button className="w-full" disabled={loading} onClick={() => input.current?.click()}>{loading ? text("Импорт…", "Importing…") : text("Импорт аудио", "Import audio")}</button>
        <input ref={input} hidden type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac,.aif,.aiff" multiple onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void handleFiles(files); }} />
        <input ref={relinkInput} hidden type="file" accept="audio/*" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void relinkMedia(relinkId.current, file); }} />
        {progress && <div className="import-progress" role="status">{progress.index}/{progress.total} · {progress.fileName}<button onClick={() => abort.current?.abort()}>{text("Отмена", "Cancel")}</button></div>}
        {failures.map((failure, index) => <div className="import-failure" role="alert" key={index}>{failure.file.name}: {failure.reason}<button disabled={loading} onClick={() => void handleFiles([failure.file])}>{text("Повторить", "Retry")}</button></div>)}
        <h3>{text("Аудиофайлы", "Audio files")}</h3>
        {!Object.keys(project.assets).length && <p className="text-gray-400">{text("Импортируйте файлы, затем перетащите их на дорожку или нажмите дважды.", "Import files, then drag them onto a track or double-click.")}</p>}
        {Object.values(project.assets).filter(asset => matches(asset.name)).map(asset => <div key={asset.id} className="asset" tabIndex={0} role="button" aria-label={asset.name} draggable={!missingMedia.includes(asset.id)} onKeyDown={e => { if (e.key === "Enter") insert(asset); }} onDoubleClick={() => insert(asset)} onDragStart={e => { e.dataTransfer.setData("application/x-mini-daw-asset", asset.id); e.dataTransfer.effectAllowed = "copy"; }}>
          <div className="asset-name">{asset.name}</div><small>{asset.durationSec.toFixed(2)} s · {asset.numChannels} ch · {asset.sampleRate} Hz</small>
          <button aria-label={text("Удалить файл из библиотеки", "Remove library file")} title={text("Удаление возможно, если файл не используется монтажом, буфером обмена и Undo", "Remove only when unused by clips, clipboard and Undo")} onClick={event => { event.stopPropagation(); useStore.getState().removeAsset(asset.id); }} onDoubleClick={event => event.stopPropagation()}>×</button>
          {missingMedia.includes(asset.id) && <button className="danger-soft" onClick={() => { relinkId.current = asset.id; relinkInput.current?.click(); }}>{text("Найти исходник…", "Relink source…")}</button>}
        </div>)}
        <h3>{text("Дорожки", "Tracks")} <button onClick={addTrack} aria-label={text("Добавить дорожку", "Add track")}>+</button></h3>
        <button className="track-search-result" onClick={() => setSelected({ selectedClipId: null, inspectorMode: "master" })}>{text("Мастер", "Master")}</button>
        {project.tracks.filter(track => matches(track.name)).map(track => <button className="track-search-result" key={track.id} style={{ borderLeft: `3px solid ${track.color}` }} onClick={() => setSelected({ selectedTrackId: track.id, selectedClipId: null, inspectorMode: "track" })}>{track.name}</button>)}
        <h3>{text("Уровень перед эффектами", "Gain before effects")}</h3>
        <label>{text("Общий вход", "Global input")} {project.audioSettings.inputGainDb.toFixed(1)} dB<input aria-label={text("Входной уровень", "Input gain")} className="w-full" type="range" min="-24" max="24" step="0.1" value={project.audioSettings.inputGainDb} onChange={e => useStore.getState().updateAudioSettings({ inputGainDb: Number(e.target.value) })} /></label>
      </>}
      {tab === "effects" && <><p className="mb-3 text-gray-400">{text("Добавить на: ", "Add to: ")}{master ? text("Мастер", "Master") : selectedTrack?.name ?? "—"}</p>{EFFECT_MENU.flatMap(group => group.types).filter(type => !master || !["speed", "pitch"].includes(type)).filter(type => matches(t(EFFECT_LABELS[type]))).map(type => <button className="track-search-result" key={type} disabled={!master && !selectedTrack} onClick={() => master ? addMasterEffect(type) : selectedTrack && addEffect(selectedTrack.id, type)}>+ {t(EFFECT_LABELS[type])}</button>)}</>}
      {tab === "presets" && <>
        <label><input type="checkbox" checked={favoritesOnly} onChange={e => setFavoritesOnly(e.target.checked)} /> {text("Избранное", "Favorites")}</label>
        {recent.length > 0 && <p className="my-2 text-gray-400">{text("Недавние: ", "Recent: ")}{recent.join(", ")}</p>}
        {QUICK_CHAINS.filter(chain => matches(chain.name) && (!favoritesOnly || favorites.includes(chain.name))).map(chain => <div className="preset-card" key={chain.name}><div><button aria-label={text("В избранное", "Favorite")} onClick={() => toggleFavorite(chain.name)}>{favorites.includes(chain.name) ? "★" : "☆"}</button><strong>{chain.name}</strong></div><p>{chain.steps.map(step => t(EFFECT_LABELS[step.type])).join(" → ")}</p><button disabled={chain.target !== "master" && !selectedTrack} onClick={() => { if (chain.target === "master") { applyQuickChainToMaster(chain); setSelected({ inspectorMode: "master" }); } else if (selectedTrack) applyQuickChainToTrack(selectedTrack.id, chain); recordRecent(chain.name); }}>{text("Применить цепочку", "Apply chain")}</button></div>)}
        <h3>{text("Мои пресеты", "My presets")}</h3>
        <input data-history="off" aria-label={text("Название пресета", "Preset name")} placeholder={text("Название цепочки", "Chain name")} value={presetName} onChange={e => setPresetName(e.target.value)} /><button onClick={savePreset} disabled={!presetName.trim()}>{text("Сохранить цепочку", "Save chain")}</button>
        {presets.filter(preset => matches(preset.name)).map(preset => <div className="preset-card" key={preset.name}><strong>{preset.name}</strong><p>{preset.effects.map(effect => t(EFFECT_LABELS[effect.type])).join(" → ")}</p><button onClick={() => { const effects = structuredClone(preset.effects).filter(effect => !master || !["speed", "pitch"].includes(effect.type)).map(cloneEffect); useStore.getState().commit(p => master ? { ...p, masterEffects: effects } : { ...p, tracks: p.tracks.map(track => track.id === selectedTrack?.id ? { ...track, effects } : track) }, `Preset: ${preset.name}`); recordRecent(preset.name); }}>{text("Применить", "Apply")}</button><button onClick={() => { const next = presets.filter(item => item !== preset); setPresets(next); writePreference("user-presets", next); }}>{text("Удалить", "Delete")}</button></div>)}
      </>}
    </div>
  </aside>;
}
