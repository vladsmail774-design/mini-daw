import { useEffect, useState } from "react";
import { getAudioEngine } from "./AudioEngine";
import { useStore } from "../state/store";

/**
 * React binding for the singleton AudioEngine. Syncs project state to
 * the engine's chains and exposes a transport control API.
 */
export function useAudioEngine() {
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const project = useStore((s) => s.project);

  useEffect(() => {
    const engine = getAudioEngine();
    engine.setOnTick((p) => setPosition(p));
    return () => engine.setOnTick(null);
  }, []);

  // Keep live chains in sync with state while playing — volume/pan/effects
  // update without tearing the transport.
  useEffect(() => {
    const engine = getAudioEngine();
    if (engine.isPlaying) {
      engine.syncWhilePlaying(project);
    } else {
      for (const t of project.tracks) engine.ensureTrackChain(t);
      engine.setMasterVolumeDb(project.masterVolumeDb);
      engine.ensureMasterChain(project.masterEffects ?? []);
    }
  }, [project]);

  const play = async (startPos?: number) => {
    const engine = getAudioEngine();
    await engine.resume();
    const start = startPos ?? position;
    engine.play(project, start);
    setIsPlaying(true);
  };

  const pause = () => {
    getAudioEngine().pause();
    setIsPlaying(false);
  };

  const stop = () => {
    getAudioEngine().stop();
    setIsPlaying(false);
    setPosition(0);
  };

  const seek = (pos: number) => {
    const engine = getAudioEngine();
    engine.seek(pos);
    setPosition(engine.position);
  };

  return {
    position,
    isPlaying,
    play,
    pause,
    stop,
    seek,
  };
}
