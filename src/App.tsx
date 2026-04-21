import { Transport } from "./components/Transport";
import { Sidebar } from "./components/Sidebar";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { useAudioEngine } from "./audio/useAudioEngine";

export default function App() {
  const { isPlaying, position, play, pause, stop, seek } = useAudioEngine();

  return (
    <div className="h-full w-full flex flex-col bg-bg-0 text-gray-200">
      <div className="h-10 bg-bg-1 border-b border-bg-3 flex items-center px-3 gap-3">
        <div className="font-mono text-sm text-accent">mini-daw</div>
        <div className="text-xs text-gray-500">
          React · Web Audio · Zustand · Tailwind
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
