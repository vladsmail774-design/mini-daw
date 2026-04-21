import { Transport } from "./components/Transport";
import { Sidebar } from "./components/Sidebar";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { useAudioEngine } from "./audio/useAudioEngine";

export default function App() {
  const { isPlaying, position, play, pause, stop, seek } = useAudioEngine();

  return (
    <div className="h-screen w-screen flex flex-col bg-bg-0 text-gray-200 overflow-hidden">
      {/* Header */}
      <div className="h-10 bg-bg-1 border-b border-bg-3 flex items-center px-3 gap-3 flex-shrink-0">
        <div className="font-mono text-sm text-accent font-bold">mini-daw</div>
        <div className="text-[10px] text-gray-500 uppercase tracking-widest">
          React · Web Audio · Zustand · Tailwind
        </div>
      </div>

      {/* Transport Bar */}
      <Transport
        isPlaying={isPlaying}
        position={position}
        play={play}
        pause={pause}
        stop={stop}
        seek={seek}
      />

      {/* Main Workspace */}
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
