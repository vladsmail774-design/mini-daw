import { Transport } from "./components/Transport";
import { Sidebar } from "./components/Sidebar";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { useAudioEngine } from "./audio/useAudioEngine";

export default function App() {
  const { isPlaying, position, play, pause, stop, seek } = useAudioEngine();
  const stack = ["React 19", "Web Audio API", "Zustand", "Tailwind CSS"];

  return (
    <div className="flex min-h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.14),transparent_32%),radial-gradient(circle_at_85%_0%,rgba(96,165,250,0.16),transparent_26%),#05070a] text-slate-100">
      <header className="border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.32em] text-emerald-300">
                mini-daw
              </div>
              <div className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(74,222,128,0.95)]" />
                Arrange fast ideas without leaving the browser
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {stack.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium tracking-[0.18em] text-slate-300"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="max-w-xl text-sm leading-6 text-slate-400 lg:text-right">
            Import a file, drop it onto a track, sketch the loop, and keep the
            timeline front and center while you tweak effects.
          </div>
        </div>
      </header>

      <Transport
        isPlaying={isPlaying}
        position={position}
        play={play}
        pause={pause}
        stop={stop}
        seek={seek}
      />

      <main className="flex-1 overflow-auto lg:overflow-hidden">
        <div className="flex min-h-full flex-col gap-3 p-3 lg:h-full lg:flex-row lg:gap-4 lg:p-4">
          <div className="order-2 lg:order-1">
            <Sidebar />
          </div>
          <div className="order-1 min-w-0 flex-1 lg:order-2">
            <Timeline position={position} onSeek={seek} />
          </div>
          <div className="order-3 lg:order-3">
            <Inspector />
          </div>
        </div>
      </main>
    </div>
  );
}
