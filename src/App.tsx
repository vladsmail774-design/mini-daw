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

  useEffect(() => {
    const t = window.setTimeout(() => autosave(project), 2000);
    return () => window.clearTimeout(t);
  }, [project]);

  return (
    <div className="h-screen w-screen flex flex-col bg-bg-0 text-gray-200 overflow-hidden">
      <div className="h-10 bg-bg-1 border-b border-bg-3 flex items-center px-3 gap-3 flex-shrink-0">
        <div className="font-mono text-sm text-accent font-bold">mini-daw</div>
        <div className="text-[10px] text-gray-500 uppercase tracking-widest">
          v1.1 - React - Web Audio - Zustand - Tailwind
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

      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <Sidebar />
        <main className="flex-1 min-w-0 relative overflow-hidden flex flex-col">
          <Timeline position={position} onSeek={seek} />
        </main>
        <Inspector />
      </div>
    </div>
  );
}
