import { useEffect } from "react";
import { Transport } from "./components/Transport";
import { Sidebar } from "./components/Sidebar";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { useAudioEngine } from "./audio/useAudioEngine";
import { useStore } from "./state/store";
import { autosave } from "./state/persist";

export default function App() {
  const { isPlaying, position, play, pause, stop, seek } = useAudioEngine();
  const project = useStore((s) => s.project);

  // Autosave to localStorage on a 2s debounce.
  useEffect(() => {
    const t = window.setTimeout(() => autosave(project), 2000);
    return () => window.clearTimeout(t);
  }, [project]);

  return (
    <div className="h-full w-full flex flex-col bg-bg-0 text-gray-200">
      <div className="h-10 bg-bg-1 border-b border-bg-3 flex items-center px-3 gap-3">
        <div className="font-mono text-sm text-accent">mini-daw</div>
        <div className="text-xs text-gray-500">
          v1.1 · React · Web Audio · Zustand · Tailwind
        </div>
      </div>
      <Transport
        isPlaying={isPlaying}
        position={position}
        play={play}
        pause={pause}
        stop={stop}
        seek={seek}
      />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <Timeline position={position} onSeek={seek} />
        <Inspector />
      </div>
    </div>
  );
}
