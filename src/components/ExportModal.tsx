import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { getAudioEngine } from "../audio/AudioEngine";
import { analyzeAudioBufferAsync, audioBufferToMp3Blob, audioBufferToWavBlobAsync, downloadBlob, renderProject, type RenderAnalysis } from "../audio/renderer";
import type { ProjectState } from "../types";
import { useI18n } from "../i18n";
import { Dialog } from "./Dialog";
import { safeExportName } from "../utils/filenames";

type Format = "wav" | "mp3";
type ExportJob = { id: number; name: string; project: ProjectState; buffers: Map<string, AudioBuffer>; start: number; end: number; tail: number; rate: number; format: Format; bitDepth: 16 | 24; kbps: number; normalize: number | null; trackId?: string; includeMaster: boolean; respectMuteSolo: boolean; status: "queued" | "rendering" | "done" | "error" | "cancelled" };
export function ExportModal({ onClose }: { onClose: () => void }) {
  const project = useStore(s => s.project);
  const ui = useStore(s => s.ui);
  const { locale } = useI18n();
  const text = (ru: string, en: string) => locale === "ru" ? ru : en;
  const [format, setFormat] = useState<Format>("wav");
  const [exportId] = useState(() => crypto.randomUUID());
  const [bitDepth, setBitDepth] = useState<16 | 24>(24);
  const [kbps, setKbps] = useState(192);
  const [rate, setRate] = useState(44100);
  const [range, setRange] = useState<"project" | "loop" | "selection" | "custom">("project");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.max(1, ...project.clips.map(clip => clip.start + clip.duration)));
  const [tail, setTail] = useState(2);
  const [stems, setStems] = useState(false);
  const [includeMaster, setIncludeMaster] = useState(true);
  const [respectMuteSolo, setRespectMuteSolo] = useState(false);
  const [normalize, setNormalize] = useState(false);
  const [peakTarget, setPeakTarget] = useState(-1);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState<RenderAnalysis | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const selected = project.clips.filter(clip => ui.selectedClipIds.includes(clip.id));
  const rangeStart = range === "project" ? 0 : range === "loop" ? project.loop.start : range === "selection" ? Math.min(...selected.map(clip => clip.start)) : start;
  const rangeEnd = range === "project" ? Math.max(0, ...project.clips.map(clip => clip.start + clip.duration)) : range === "loop" ? project.loop.end : range === "selection" ? Math.max(...selected.map(clip => clip.start + clip.duration)) : end;
  const valid = Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && rangeStart >= 0 && rangeEnd > rangeStart && tail >= 0 && tail <= 60 && Number.isFinite(tail);
  const createJobs = () => {
    if (!valid) return [];
    const snapshot = { ...structuredClone({ ...project, assets: {} }), assets: project.assets };
    const buffers = new Map(getAudioEngine().buffers);
    const tracks = stems ? project.tracks.filter(track => !respectMuteSolo || (!track.mute && (!project.tracks.some(item => item.solo) || track.solo))) : [undefined];
    return tracks.map(track => {
      const id = ++sequence.current;
      return { id, name: `${safeExportName(project.name || "Project").slice(0, 48)}_${track ? `${safeExportName(track.name).slice(0, 48)}_` : "master_"}${exportId}_${String(id).padStart(3, "0")}`, project: snapshot, buffers, start: rangeStart, end: rangeEnd, tail, rate, format, bitDepth, kbps, normalize: normalize ? peakTarget : null, trackId: track?.id, includeMaster, respectMuteSolo: stems ? respectMuteSolo : true, status: "queued" as const };
    });
  };
  const run = async () => {
    const queue = jobs.some(job => job.status === "queued") ? jobs.filter(job => job.status === "queued") : createJobs();
    if (!queue.length) return;
    if (!jobs.some(job => job.status === "queued")) setJobs(previous => [...previous, ...queue]);
    setBusy(true); setError(""); setProgress(0);
    const abort = new AbortController(); controller.current = abort;
    const status = (id: number, value: ExportJob["status"]) => setJobs(previous => previous.map(job => job.id === id ? { ...job, status: value } : job));
    try {
      for (let index = 0; index < queue.length; index++) {
        const job = queue[index];
        abort.signal.throwIfAborted(); status(job.id, "rendering");
        const rendered = await renderProject(job.project, job.buffers, { sampleRate: job.rate, startSec: job.start, endSec: job.end, tailSec: job.tail, isolateTrackId: job.trackId, includeMaster: job.includeMaster, respectMuteSolo: job.respectMuteSolo, normalizePeakDb: job.normalize, signal: abort.signal, onProgress: value => setProgress((index + value * 0.8) / queue.length) });
        abort.signal.throwIfAborted();
        const result = await analyzeAudioBufferAsync(rendered, { signal: abort.signal }); setAnalysis(result);
        const encoding = { signal: abort.signal, onProgress: (value: number) => setProgress((index + 0.8 + value * 0.2) / queue.length) };
        const blob = job.format === "wav" ? await audioBufferToWavBlobAsync(rendered, job.bitDepth, encoding) : await audioBufferToMp3Blob(rendered, job.kbps, encoding);
        if (!blob) throw new Error(text("Не удалось кодировать MP3. Выберите WAV и повторите.", "MP3 encoding failed. Select WAV and retry."));
        abort.signal.throwIfAborted();
        downloadBlob(blob, `${job.name}.${job.format}`); status(job.id, "done"); setProgress((index + 1) / queue.length);
      }
    } catch (error) {
      setError(abort.signal.aborted ? text("Экспорт отменён; завершённые файлы сохранены.", "Export cancelled; completed files are retained.") : error instanceof Error ? error.message : String(error));
      setJobs(previous => previous.map(job => job.status === "rendering" || (abort.signal.aborted && job.status === "queued") ? { ...job, status: abort.signal.aborted ? "cancelled" : "error" } : job));
    } finally { controller.current = null; setBusy(false); }
  };
  return <Dialog title={text("Экспорт аудио", "Export audio")} busy={busy} onClose={onClose}>
    <fieldset disabled={busy}>
      <label><span>{text("Формат", "Format")}</span><select aria-label={text("Формат", "Format")} value={format} onChange={e => setFormat(e.target.value as Format)}><option value="wav">WAV PCM</option><option value="mp3">MP3</option></select>{format === "wav" ? <select aria-label="Bit depth" value={bitDepth} onChange={e => setBitDepth(Number(e.target.value) as 16 | 24)}><option value="16">16-bit</option><option value="24">24-bit</option></select> : <select aria-label="MP3 bitrate" value={kbps} onChange={e => setKbps(Number(e.target.value))}>{[128, 192, 256, 320].map(value => <option key={value}>{value}</option>)}</select>}</label>
      <label><span>{text("Частота", "Sample rate")}</span><select value={rate} onChange={e => setRate(Number(e.target.value))}><option value="44100">44 100 Hz</option><option value="48000">48 000 Hz</option></select></label>
      <label><span>{text("Диапазон", "Range")}</span><select value={range} onChange={e => setRange(e.target.value as typeof range)}><option value="project">{text("Весь материал", "All content")}</option><option value="selection" disabled={!selected.length}>{text("Выделенные клипы (диапазон микса)", "Selected clips (mix range)")}</option><option value="loop">{text("Петля", "Loop")}</option><option value="custom">{text("Задать время", "Custom time")}</option></select></label>
      {range === "custom" && <label><span>{text("Начало / конец, с", "Start / end, s")}</span><input aria-label="Export start" type="number" min="0" step="0.1" value={start} onChange={e => setStart(Number(e.target.value))} /><input aria-label="Export end" type="number" min="0" step="0.1" value={end} onChange={e => setEnd(Number(e.target.value))} /></label>}
      <label><span>{text("Хвост эффектов, с", "Effect tail, s")}</span><input type="number" min="0" max="60" step="0.5" value={tail} onChange={e => setTail(Number(e.target.value))} /></label>
      <label><input type="checkbox" checked={stems} onChange={e => setStems(e.target.checked)} />{text("Отдельный файл для каждой дорожки (stems)", "Separate file per track (stems)")}</label>
      {stems && <label><input type="checkbox" checked={respectMuteSolo} onChange={e => setRespectMuteSolo(e.target.checked)} />{text("Только слышимые дорожки: учитывать Mute / Solo", "Audible tracks only: respect Mute / Solo")}</label>}
      <label><input type="checkbox" checked={includeMaster} onChange={e => setIncludeMaster(e.target.checked)} />{text("Громкость и эффекты мастера", "Master gain and effects")}</label>
      <label><input type="checkbox" checked={normalize} onChange={e => setNormalize(e.target.checked)} />{text("Нормализация sample peak", "Sample peak normalization")}{normalize && <input aria-label="Peak target dBFS" type="number" min="-24" max="0" step="0.1" value={peakTarget} onChange={e => setPeakTarget(Math.max(-24, Math.min(0, Number(e.target.value))))} />}</label>
      <p className="text-gray-400">{valid ? `${rangeStart.toFixed(2)}–${rangeEnd.toFixed(2)} s + ${tail.toFixed(1)} s = ${(rangeEnd - rangeStart + tail).toFixed(2)} s` : text("Выберите непустой диапазон.", "Choose a non-empty range.")}</p>
      {stems && <p className="text-gray-400">{respectMuteSolo ? text("Mute/Solo применяется до изоляции дорожек.", "Mute/Solo applies before track isolation.") : text("Все дорожки: Mute/Solo игнорируется.", "All tracks: Mute/Solo is ignored.")}</p>}
      <p className="fx-note">{text("Измеряются RMS и sample peak. Без LUFS, true peak и dithering. Хвост обрезается по заданному времени.", "Measures RMS and sample peak. No LUFS, true peak or dithering. Tail ends at the specified time.")}</p>
      <button disabled={!valid} onClick={() => setJobs(previous => [...previous, ...createJobs()])}>{text("Добавить задание в очередь", "Add job to queue")}</button>
    </fieldset>
    {jobs.length > 0 && <ol className="export-queue">{jobs.map(job => <li key={job.id}>{job.name}.{job.format} · {job.start.toFixed(1)}–{job.end.toFixed(1)} s · {({ queued: text("в очереди", "queued"), rendering: text("обработка", "rendering"), done: text("готово", "done"), error: text("ошибка", "error"), cancelled: text("отменено", "cancelled") })[job.status]}{!busy && job.status !== "done" && <button aria-label={text("Удалить задание", "Remove job")} onClick={() => setJobs(previous => previous.filter(item => item.id !== job.id))}>×</button>}</li>)}</ol>}
    {busy && <progress aria-label={text("Прогресс экспорта", "Export progress")} max="1" value={progress} className="w-full" />}
    {analysis && <p className="font-mono mt-3">Peak {analysis.peakDb.toFixed(2)} dBFS · RMS {analysis.rmsDb.toFixed(2)} dBFS · {analysis.durationSec.toFixed(2)} s{analysis.clippingSamples > 0 && <span className="text-red-300"> · {text("Клиппинг: ", "Clipped samples: ")}{analysis.clippingSamples}</span>}</p>}
    {error && <p role="alert" className="text-red-300 mt-3">{error}</p>}
    <div className="dialog-actions">{busy ? <button onClick={() => controller.current?.abort()}>{text("Отменить экспорт", "Cancel export")}</button> : <><button onClick={onClose}>{text("Закрыть", "Close")}</button><button className="primary" disabled={!valid && !jobs.some(job => job.status === "queued")} onClick={() => void run()}>{text("Экспортировать", "Render")}</button></>}</div>
  </Dialog>;
}
