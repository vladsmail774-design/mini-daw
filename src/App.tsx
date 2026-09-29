import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Transport } from "./components/Transport";
import { Sidebar } from "./components/Sidebar";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { ExportModal } from "./components/ExportModal";
import { Dialog } from "./components/Dialog";
import { useAudioEngine } from "./audio/useAudioEngine";
import { useI18n } from "./i18n";
import { useStore } from "./state/store";
import { projectFingerprint } from "./state/persist";
import { unregisterMedia } from "./state/mediaRegistry";
import { getAudioEngine } from "./audio/AudioEngine";
import { bootProject, newProject, openProjectFile, recoverPrevious, reportError, saveProjectFile, saveRecovery, useSession } from "./state/session";

type Panels = { library: boolean; inspector: boolean; leftWidth: number; rightWidth: number };
const StableSidebar = memo(Sidebar);
const StableInspector = memo(Inspector);
function initialPanels(): Panels {
  const defaults = { library: true, inspector: window.innerWidth > 1100, leftWidth: 240, rightWidth: 290 };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem("mini-daw:panels") || "{}") }; } catch { return defaults; }
}
export default function App() {
  const { isPlaying, position, play, pause, stop, seek } = useAudioEngine();
  const { locale, setLocale } = useI18n();
  const text = (ru: string, en: string) => locale === "ru" ? ru : en;
  const project = useStore(s => s.project);
  const transaction = useStore(s => s.transaction);
  const modelError = useStore(s => s.lastError);
  const session = useSession();
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pending, setPending] = useState<"new" | "open" | null>(null);
  const [panels, setPanels] = useState<Panels>(initialPanels);
  const fileInput = useRef<HTMLInputElement>(null);
  const inputTransaction = useRef(false);
  const fingerprint = useMemo(() => projectFingerprint(project), [project]);
  const dirty = session.recovered || fingerprint !== session.savedFingerprint;
  useEffect(() => { void bootProject(); }, []);
  useEffect(() => useStore.subscribe((state, previous) => {
    if (state.project !== previous.project && useSession.getState().ready && projectFingerprint(state.project) !== projectFingerprint(previous.project)) useSession.setState({ autosaveStatus: "pending" });
    if (state.project.assets !== previous.project.assets) {
      for (const id of Object.keys(previous.project.assets)) if (!Object.hasOwn(state.project.assets, id)) { unregisterMedia(id); getAudioEngine().unregisterBuffer(id); }
    }
  }), []);
  useEffect(() => {
    if (!session.ready || session.recoveryBlocked || session.busy || transaction) return;
    const timer = window.setTimeout(() => { if (!useStore.getState().transaction) void saveRecovery(); }, 750);
    return () => clearTimeout(timer);
  }, [fingerprint, transaction, session.ready, session.recoveryBlocked, session.busy]);
  useEffect(() => {
    try { localStorage.setItem("mini-daw:panels", JSON.stringify(panels)); } catch (error) { reportError(error); }
  }, [panels]);
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportError(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportError(event.reason);
    const onUp = () => { if (document.activeElement instanceof HTMLInputElement && document.activeElement.type === "range") { useStore.getState().commitTransaction(); inputTransaction.current = false; } };
    const onCancel = (event: PointerEvent) => { if (event.target instanceof HTMLInputElement && event.target.type === "range") useStore.getState().cancelTransaction(); };
    const onWindowBlur = () => { window.dispatchEvent(new CustomEvent("mini-daw:cancel-gesture")); useStore.getState().commitTransaction(); inputTransaction.current = false; };
    const onHide = () => { if (document.hidden) { onWindowBlur(); void saveRecovery(); } };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = useSession.getState();
      if (current.autosaveStatus !== "saved" && (current.recovered || projectFingerprint(useStore.getState().project) !== current.savedFingerprint)) event.preventDefault();
    };
    window.addEventListener("error", onError); window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onCancel); window.addEventListener("blur", onWindowBlur); document.addEventListener("visibilitychange", onHide); window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel); window.removeEventListener("blur", onWindowBlur); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("beforeunload", beforeUnload); };
  }, []);
  const runFileAction = (action: "new" | "open") => {
    setPending(null);
    if (action === "new") void newProject();
    else if (window.miniDaw) void openProjectFile();
    else fileInput.current?.click();
  };
  const requestFileAction = (action: "new" | "open") => { if (dirty) setPending(action); else runFileAction(action); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]") || session.busy || !session.ready) return;
      const target = event.target as HTMLElement;
      const editing = target?.closest("input,textarea,select,[contenteditable=true]");
      const command = event.ctrlKey || event.metaKey;
      const key = event.code;
      if (command && key === "KeyS") { event.preventDefault(); void saveProjectFile(event.shiftKey); return; }
      if (key === "Escape") { useStore.getState().cancelTransaction(); window.dispatchEvent(new CustomEvent("mini-daw:cancel-gesture")); return; }
      if (editing) return;
      const state = useStore.getState();
      let handled = true;
      if (command && key === "KeyZ") { if (event.shiftKey) state.redo(); else state.undo(); }
      else if (command && key === "KeyY") state.redo();
      else if (command && key === "KeyC") state.copyClips();
      else if (command && key === "KeyV") state.pasteClips(position, state.ui.selectedTrackId ?? undefined);
      else if (command && key === "KeyD") state.duplicateClips();
      else if (command && key === "KeyA") state.selectClips(state.project.clips.map(clip => clip.id));
      else if (command && key === "KeyO") requestFileAction("open");
      else if (command && key === "KeyN") requestFileAction("new");
      else if (!command && key === "Space" && target?.tagName !== "BUTTON") { if (isPlaying) pause(); else void play().catch(reportError); }
      else if (!command && (key === "Delete" || key === "Backspace")) state.deleteClips();
      else if (!command && key === "KeyS") state.splitClips(state.ui.selectedClipIds, position);
      else if (!command && (key === "ArrowLeft" || key === "ArrowRight")) state.nudgeClips((key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.01));
      else if (!command && key === "Home") seek(0);
      else if (!command && key === "End") seek(Math.max(0, ...state.project.clips.map(clip => clip.start + clip.duration)));
      else if (!command && key === "KeyF") window.dispatchEvent(new CustomEvent("mini-daw:timeline-command", { detail: event.shiftKey ? "fit-selection" : "fit-project" }));
      else if (key === "F1") setHelpOpen(true);
      else handled = false;
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const beginInput = (target: EventTarget) => {
    if (!(target instanceof HTMLInputElement) || ["checkbox", "file", "search"].includes(target.type) || target.dataset.history === "off") return;
    if (!useStore.getState().transaction) inputTransaction.current = true;
    useStore.getState().beginTransaction(target.getAttribute("aria-label") || target.closest("label")?.textContent?.slice(0, 50) || text("Изменить значение", "Change value"));
  };
  const resizePanel = (side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = event.clientX; const width = side === "left" ? panels.leftWidth : panels.rightWidth;
    const element = event.currentTarget;
    const move = (ev: PointerEvent) => setPanels(p => ({ ...p, [side === "left" ? "leftWidth" : "rightWidth"]: Math.max(200, Math.min(420, width + (ev.clientX - start) * (side === "left" ? 1 : -1))) }));
    const end = () => { element.removeEventListener("pointermove", move); element.removeEventListener("lostpointercapture", end); };
    element.addEventListener("pointermove", move); element.addEventListener("lostpointercapture", end);
  };
  return <div className="app-shell" onFocusCapture={event => beginInput(event.target)} onPointerDownCapture={event => { if (!(event.target instanceof HTMLInputElement) && inputTransaction.current) { useStore.getState().commitTransaction(); inputTransaction.current = false; } beginInput(event.target); }} onInputCapture={event => beginInput(event.target)} onBlurCapture={event => { if (event.target instanceof HTMLInputElement && inputTransaction.current) { useStore.getState().commitTransaction(); inputTransaction.current = false; } }}>
    <header className="project-bar">
      <strong className="brand">Mini DAW <small>{__APP_VERSION__}</small></strong>
      <input className="project-name" disabled={session.busy || !session.ready} aria-label={text("Название проекта", "Project name")} value={project.name ?? "Untitled"} onChange={e => useStore.getState().updateProjectName(e.target.value)} />
      <span title={dirty ? text("Есть изменения", "Unsaved changes") : text("Сохранено", "Saved")}>{dirty ? "●" : "✓"}</span>
      <div className="project-actions">
        <button disabled={session.busy || !session.ready} onClick={() => requestFileAction("new")}>{text("Новый", "New")}</button>
        <button disabled={session.busy || !session.ready} onClick={() => requestFileAction("open")}>{text("Открыть", "Open")}</button>
        <button disabled={session.busy || !session.ready} onClick={() => void saveProjectFile()} title="Ctrl+S">{text("Сохранить", "Save")}</button>
        <button disabled={session.busy || !session.ready} onClick={() => void saveProjectFile(true)} title={text("Собрать вместе с аудио · Ctrl+Shift+S", "Collect with audio · Ctrl+Shift+S")}>{text("Как…", "As…")}</button>
      </div>
      <select aria-label="Language / Язык" value={locale} onChange={e => setLocale(e.target.value as "ru" | "en")}><option value="ru">RU</option><option value="en">EN</option></select>
      <button onClick={() => setHelpOpen(true)} title="F1">?</button>
    </header>
    <div inert={session.busy || !session.ready}><Transport isPlaying={isPlaying} position={position} play={() => { void play().catch(reportError); }} pause={pause} stop={stop} seek={seek} onOpenExport={() => { pause(); setExportOpen(true); }} /></div>
    <div className="workspace-bar"><button aria-pressed={panels.library} onClick={() => setPanels(p => ({ ...p, library: !p.library }))}>{text("Библиотека", "Library")}</button><span className="save-status" role="status">{session.busy ? text("Обработка…", "Working…") : session.recovered ? text("Проект восстановлен · сохраните файл", "Project recovered · save a file") : text("Автокопия: ", "Recovery: ") + ({ loading: text("загрузка", "loading"), pending: text("ожидает", "pending"), saving: text("запись…", "saving…"), saved: text("сохранена", "saved"), error: text("ошибка", "error") }[session.autosaveStatus])}</span><button aria-pressed={panels.inspector} onClick={() => setPanels(p => ({ ...p, inspector: !p.inspector }))}>{text("Инспектор", "Inspector")}</button></div>
    {session.error && <div className="error-banner" role="alert"><span>{session.error}</span><button onClick={() => void saveRecovery()}>{text("Повторить запись", "Retry recovery")}</button>{session.recoveryBlocked && <button onClick={() => void recoverPrevious()}>{text("Предыдущая копия", "Previous copy")}</button>}<button aria-label={text("Закрыть сообщение", "Dismiss message")} onClick={() => useSession.setState({ error: null })}>×</button></div>}
    {modelError && <div className="error-banner" role="alert"><span>{modelError}</span><button onClick={() => useStore.getState().clearError()}>{text("Закрыть", "Dismiss")}</button></div>}
    <div className="workspace" inert={session.busy || !session.ready}>
      {panels.library && <><div className="library-panel" style={{ width: panels.leftWidth }}><StableSidebar /></div><div role="separator" aria-label={text("Ширина библиотеки", "Library width")} className="panel-resizer" onPointerDown={e => resizePanel("left", e)} /></>}
      <main>{session.ready ? <Timeline position={position} onSeek={seek} isPlaying={isPlaying} /> : <div className="loading-project">{text("Восстановление проекта и аудио…", "Restoring project and audio…")}</div>}</main>
      {panels.inspector && <><div role="separator" aria-label={text("Ширина инспектора", "Inspector width")} className="panel-resizer" onPointerDown={e => resizePanel("right", e)} /><div className="inspector-panel" style={{ width: panels.rightWidth }}><StableInspector /></div></>}
    </div>
    <input ref={fileInput} hidden type="file" accept=".mdaw,.json" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void openProjectFile(file); }} />
    {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}
    {pending && <Dialog title={text("Сохранить изменения?", "Save changes?")} onClose={() => setPending(null)}><p>{text("Файл проекта включает весь монтаж и исходное аудио.", "The project file contains all edits and original audio.")}</p><div className="dialog-actions"><button onClick={() => setPending(null)}>{text("Отмена", "Cancel")}</button><button onClick={() => runFileAction(pending)}>{text("Продолжить без сохранения", "Continue without saving")}</button><button className="primary" onClick={async () => { if (await saveProjectFile()) runFileAction(pending); }}>{text("Сохранить", "Save")}</button></div></Dialog>}
    {helpOpen && <Dialog title={text("Навигация и команды", "Navigation and commands")} onClose={() => setHelpOpen(false)}><ul className="help-list"><li>Space — {text("воспроизведение / пауза", "play / pause")}</li><li>Ctrl+S / Ctrl+Shift+S — {text("сохранить / сохранить как с аудио", "save / save as with audio")}</li><li>Ctrl+Z / Ctrl+Shift+Z — Undo / Redo</li><li>Ctrl+A / C / V / D — {text("выделить всё / копировать / вставить / дублировать", "select all / copy / paste / duplicate")}</li><li>S / Delete / ← → — {text("разрезать / удалить / сдвиг 10 мс (Shift: 1 с)", "split / delete / nudge 10 ms (Shift: 1 s)")}</li><li>F / Shift+F — {text("весь проект / выделение", "fit project / selection")}</li><li>{text("Колесо: вертикаль; Shift: горизонталь; Ctrl: масштаб у указателя. Средняя кнопка: панорама.", "Wheel: vertical; Shift: horizontal; Ctrl: zoom at pointer. Middle button: pan.")}</li><li>{text("Alt отключает привязку. Esc отменяет жест. Пересечения клипов суммируются; фейды задаются в инспекторе.", "Alt disables snap. Esc cancels a gesture. Overlapping clips mix; set fades in the inspector.")}</li></ul></Dialog>}
  </div>;
}
