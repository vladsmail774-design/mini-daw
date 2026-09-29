import { useStore } from "../state/store";
import { formatTime } from "../utils/audio";
import { useI18n } from "../i18n";
import { MeterPanel } from "./MeterPanel";

interface Props { isPlaying: boolean; position: number; play: (pos?: number) => void; pause: () => void; stop: () => void; seek: (pos: number) => void; onOpenExport: () => void }
export function Transport({ isPlaying, position, play, pause, stop, seek, onOpenExport }: Props) {
  const { project, past, future, undo, redo, setLoop, setMasterVolumeDb } = useStore();
  const { locale, t } = useI18n();
  const text = (ru: string, en: string) => locale === "ru" ? ru : en;
  return <div className="transport-bar">
    <div className="transport-controls">
      <button onClick={stop} aria-label={t("transport.stop")} title={t("transport.stop")}>■</button>
      <button className="primary" onClick={() => isPlaying ? pause() : void play()} aria-label={isPlaying ? t("transport.pause") : t("transport.play")} title="Space">{isPlaying ? "Ⅱ" : "▶"}</button>
      <button onClick={() => seek(0)} title={t("transport.rewind")}>|◀</button>
      <output className="transport-time">{formatTime(position)}</output>
    </div>
    <label className="loop-toggle"><input type="checkbox" checked={project.loop.enabled} onChange={e => setLoop({ enabled: e.target.checked })} />{t("transport.loop")}</label>
    <div className="loop-fields">
      <input aria-label={t("transport.loop.start")} type="number" step="0.1" min="0" value={Number(project.loop.start.toFixed(3))} onChange={e => setLoop({ start: Number(e.target.value) })} />
      <span>–</span><input aria-label={t("transport.loop.end")} type="number" step="0.1" min="0.01" value={Number(project.loop.end.toFixed(3))} onChange={e => setLoop({ end: Number(e.target.value) })} />
    </div>
    <button onClick={undo} disabled={!past.length} title={`${t("transport.undo")} ${past.at(-1)?.description ?? ""} (Ctrl+Z)`}>↶</button>
    <button onClick={redo} disabled={!future.length} title={`${t("transport.redo")} ${future[0]?.description ?? ""} (Ctrl+Shift+Z)`}>↷</button>
    <label className="master-slider"><span>{text("Мастер", "Master")}</span><input aria-label={text("Громкость мастера", "Master volume")} type="range" min="-60" max="6" step="0.5" value={project.masterVolumeDb} onChange={e => setMasterVolumeDb(Number(e.target.value))} /><output>{project.masterVolumeDb.toFixed(1)} dB</output></label>
    <div className="transport-meter"><MeterPanel compact /></div>
    <button className="export-button" onClick={onOpenExport}>{text("Экспорт", "Export")}</button>
  </div>;
}
