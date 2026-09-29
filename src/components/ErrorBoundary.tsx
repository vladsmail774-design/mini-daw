import { Component, type ErrorInfo, type ReactNode } from "react";
import { packProject } from "../state/persist";
import { useStore } from "../state/store";
import { downloadBlob } from "../audio/renderer";
import { getAudioEngine } from "../audio/AudioEngine";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; savingError: string }> {
  state = { error: null as Error | null, savingError: "" };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info); getAudioEngine().stop(); }
  rescue = async () => {
    try { downloadBlob(await packProject(useStore.getState().project), "recovered-project.mdaw"); }
    catch (error) { this.setState({ savingError: String(error) }); }
  };
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="error-screen" role="alert"><h1>Mini DAW — ошибка интерфейса / interface error</h1><p>{this.state.error.message}</p><p>Проект остаётся в памяти. Сохраните копию перед перезагрузкой.</p><button onClick={() => void this.rescue()}>Сохранить проект с аудио / Save project</button><button onClick={() => location.reload()}>Восстановить / Reload</button>{this.state.savingError && <p>{this.state.savingError}</p>}</div>;
  }
}
