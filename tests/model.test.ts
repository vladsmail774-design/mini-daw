import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { AudioAsset, ProjectState, SpeedEffect } from "../src/types";
import { cloneEffect, useStore } from "../src/state/store";
import { createInitialProject, makeTrack, projectDocument, validateProject } from "../src/state/model";
import { defaultEffect } from "../src/state/effects";

const state = () => useStore.getState();
function media(id = "audio"): AudioAsset {
  return { id, name: `${id}.wav`, durationSec: 20, sampleRate: 48000, numChannels: 2,
    peaks: new Float32Array([0, 0.5, 1, -0.5]), peaksPerSecond: 2 };
}
function clip(start = 0, trackId = state().project.tracks[0].id, duration = 10) {
  return state().addClip({ assetId: "audio", trackId, start, offset: 0, duration });
}
beforeEach(() => { state().newProject(); state().addAsset(media()); });

test("drag snapshots before gesture and creates exactly one named Undo/Redo", () => {
  const id = clip(); const count = state().past.length;
  state().beginTransaction("Move clips");
  for (let i = 1; i <= 100; i++) state().moveClipTransient(id, i / 10);
  assert.equal(state().past.length, count);
  state().commitTransaction();
  assert.equal(state().past.length, count + 1);
  assert.equal(state().past.at(-1)?.description, "Move clips");
  state().undo(); assert.equal(state().project.clips[0].start, 0);
  state().redo(); assert.equal(state().project.clips[0].start, 10);
});

test("trim can cancel or Undo without changing source offset accidentally", () => {
  const id = clip(); const original = state().project.clips[0];
  state().beginTransaction("Trim clip"); state().resizeClipTransient(id, 2, 8, 2);
  state().cancelTransaction(); assert.deepEqual(state().project.clips[0], original);
  state().beginTransaction("Trim clip"); state().resizeClipTransient(id, 2, 8, 2); state().commitTransaction();
  assert.equal(state().project.clips[0].offset, 2);
  state().undo(); assert.deepEqual(state().project.clips[0], original);
});

test("100 slider values form one entry; no-op gesture keeps Redo", () => {
  const trackId = state().project.tracks[0].id;
  state().beginTransaction("Track volume");
  for (let i = 1; i <= 100; i++) state().updateTrack(trackId, { volumeDb: -i / 10 });
  state().commitTransaction(); assert.equal(state().past.length, 1);
  state().undo(); assert.equal(state().project.tracks[0].volumeDb, 0);
  state().beginTransaction("No change"); state().updateTrack(trackId, { volumeDb: -1 }); state().updateTrack(trackId, { volumeDb: 0 }); state().commitTransaction();
  assert.equal(state().past.length, 0); assert.equal(state().future.length, 1);
  state().redo(); assert.equal(state().project.tracks[0].volumeDb, -10);
});

test("Undo selected track normalizes selection and rejects orphan clip insertion", () => {
  state().addTrack(); const removed = state().project.tracks.at(-1)!.id;
  state().setSelected({ selectedTrackId: removed, selectedClipId: null });
  state().undo(); assert.notEqual(state().ui.selectedTrackId, removed);
  const history = state().past.length;
  assert.equal(clip(0, removed), ""); assert.equal(state().project.clips.length, 0);
  assert.equal(state().past.length, history); assert.match(state().lastError ?? "", /missing track/);
  assert.ok(clip(0, state().ui.selectedTrackId!));
});

test("import survives Undo of other edits, invalidates Redo, and never enters history", () => {
  clip(); state().addTrack(); state().undo(); assert.equal(state().future.length, 1);
  const added = media("second"); state().addAsset(added);
  assert.equal(state().future.length, 0); state().undo();
  assert.equal(state().project.assets.second, added);
  assert.equal(state().mediaRegistry, state().project.assets);
  for (const history of [...state().past, ...state().future]) {
    assert.equal("assets" in history.document, false); assert.equal("pxPerSec" in history.document, false);
  }
});

test("assets referenced only by Undo/Redo/clipboard cannot be deleted", () => {
  const id = clip(); state().copyClips([id]); state().deleteClip(id);
  assert.equal(state().removeAsset("audio"), false);
  state().undo(); assert.equal(state().project.clips[0].assetId, "audio");
  state().addAsset(media("unused")); assert.equal(state().removeAsset("unused"), true);
});

test("invalid numbers, source offsets, fades and loop bounds do not mutate history", () => {
  const id = clip(); const before = projectDocument(state().project); const count = state().past.length;
  state().moveClip(id, NaN); state().moveClip(id, Infinity);
  state().resizeClip(id, 0, 0, 0); state().resizeClip(id, 0, 2, -1); state().resizeClip(id, 0, 2, 100);
  state().updateClip(id, { fadeInSec: 11 });
  state().setLoop({ start: 9, end: 8 }); state().setLoop({ end: Infinity });
  state().setBpm(NaN); state().setMasterVolumeDb(Infinity);
  state().updateTrack(state().project.tracks[0].id, { pan: 5 });
  assert.deepEqual(projectDocument(state().project), before); assert.equal(state().past.length, count);
});

test("moving beyond previous content boundary extends project; Undo preserves zoom", () => {
  const id = clip(); state().moveClip(id, 600); assert.ok(state().project.lengthSec >= 610);
  state().setZoom(0.5); state().undo();
  assert.equal(state().project.clips[0].start, 0); assert.equal(state().project.pxPerSec, 0.5);
  state().redo(); assert.equal(state().project.clips[0].start, 600); assert.equal(state().project.pxPerSec, 0.5);
});

test("group movement, copy/paste, duplicate, delete stay atomic and retain relative offsets", () => {
  const first = clip(1); const second = clip(3, state().project.tracks[1].id);
  state().selectClips([first, second]); const count = state().past.length;
  state().moveClips([first, second], -10); assert.deepEqual(state().project.clips.map((clip) => clip.start), [0, 2]);
  assert.equal(state().past.length, count + 1);
  state().copyClips(); const pasted = state().pasteClips(50, state().project.tracks[0].id);
  assert.equal(pasted.length, 2); assert.deepEqual(state().project.clips.slice(-2).map((clip) => clip.start), [50, 52]);
  const duplicates = state().duplicateClips(); assert.equal(duplicates.length, 2);
  const beforeDelete = state().past.length; state().deleteClips(); assert.equal(state().past.length, beforeDelete + 1);
  assert.deepEqual(state().ui.selectedClipIds, []); assert.equal(state().ui.selectedClipId, null);
  state().undo(); assert.equal(state().project.clips.length, 6);
});

test("rate edits and split use source seconds; changing track keeps chosen source segment", () => {
  const firstTrack = state().project.tracks[0].id; const secondTrack = state().project.tracks[1].id;
  const id = clip(0, firstTrack, 8);
  const speed = { ...defaultEffect("speed"), rate: 2 } as SpeedEffect;
  state().updateTrack(firstTrack, { effects: [speed] }); assert.equal(state().project.clips[0].duration, 4);
  state().splitClip(id, 1); assert.equal(state().project.clips[1].offset, 2); assert.equal(state().project.clips[1].duration, 3);
  state().moveClip(state().project.clips[1].id, 10, secondTrack);
  assert.equal(state().project.clips[1].duration, 6); assert.equal(state().project.clips[1].offset, 2);
  state().undo(); assert.equal(state().project.clips[1].duration, 3);
});

test("whole-chain bypass preserves individual bypass values across toggles and Undo", () => {
  const trackId = state().project.tracks[0].id;
  const effects = [{ ...defaultEffect("gain"), bypass: true }, defaultEffect("eq3")];
  state().updateTrack(trackId, { effects });
  state().setTrackEffectsBypassed(trackId, true); state().setTrackEffectsBypassed(trackId, false);
  assert.deepEqual(state().project.tracks[0].effects.map((fx) => fx.bypass), [true, false]);
  state().undo(); assert.equal(state().project.tracks[0].effectsBypassed, true);
  assert.deepEqual(state().project.tracks[0].effects.map((fx) => fx.bypass), [true, false]);
});

test("crossfade overlap is a single reversible edit", () => {
  const first = clip(0); const second = clip(8);
  state().selectClips([first, second]); const count = state().past.length;
  state().crossfadeSelected(); assert.equal(state().project.clips[0].fadeOutSec, 2); assert.equal(state().project.clips[1].fadeInSec, 2);
  assert.equal(state().past.length, count + 1);
  state().undo(); assert.equal(state().project.clips[0].fadeOutSec, undefined);
});

test("duplicate and reorder track preserve clip links and use distinct effect IDs", () => {
  const trackId = state().project.tracks[0].id; clip(); state().addEffect(trackId, "eq10");
  const duplicate = state().duplicateTrack(trackId)!;
  assert.ok(duplicate); assert.equal(state().project.clips[1].trackId, duplicate);
  assert.notEqual(state().project.tracks[0].effects[0].id, state().project.tracks[1].effects[0].id);
  state().reorderTrack(duplicate, 2); assert.equal(state().project.tracks[2].id, duplicate);
  state().undo(); assert.equal(state().project.tracks[1].id, duplicate);
});

test("failed loads leave current session intact, valid load clears history and stale selection", () => {
  const id = clip(); state().selectClips([id]); const before = state().project;
  const bad = { ...before, clips: [{ ...before.clips[0], trackId: "missing" }] };
  assert.throws(() => state().loadProject(bad), /missing track/); assert.equal(state().project, before);
  state().loadProject(createInitialProject("Loaded"));
  assert.equal(state().project.name, "Loaded"); assert.equal(state().past.length, 0); assert.deepEqual(state().ui.selectedClipIds, []);
});

test("strict load validation rejects corrupt effect parameters and duplicate IDs", () => {
  const project = createInitialProject();
  project.tracks[0].effects.push({ ...defaultEffect("speed"), rate: Infinity } as SpeedEffect);
  assert.throws(() => validateProject(project));
  project.tracks[0].effects = []; project.tracks[1].id = project.tracks[0].id;
  assert.throws(() => validateProject(project), /Duplicate track/);
  assert.throws(() => validateProject({} as ProjectState));
});

test("corrupt bands, missing parameters, illegal enum values and crossovers fail before audio setup", () => {
  const project = createInitialProject();
  const equalizer = defaultEffect("eq10");
  project.tracks[0].effects = [equalizer];
  assert.doesNotThrow(() => validateProject(project));
  const badBands = { ...equalizer, bands: Array.from({ length: 10 }, () => ({})) };
  project.tracks[0].effects = [badBands as typeof equalizer];
  assert.throws(() => validateProject(project), /parameter type/);
  const multiband = defaultEffect("multibandCompressor");
  project.tracks[0].effects = [{ ...multiband, crossoversHz: [2000, 100] } as typeof multiband];
  assert.throws(() => validateProject(project), /ascending/);
  project.tracks[0].effects = [{ ...defaultEffect("gain"), gainDb: undefined } as unknown as typeof equalizer];
  assert.throws(() => validateProject(project));
  project.tracks[0].effects = [];
  project.audioSettings.channelMode = "broken" as "stereo";
  assert.throws(() => validateProject(project), /unsupported value/);
});

test("relink updates waveform registry and preserves media in older history", () => {
  const id = clip(); state().moveClip(id, 3); state().undo();
  const replacement = { ...state().project.assets.audio, peaks: new Float32Array([0, 1, 0]) };
  assert.equal(state().updateAsset(replacement), true); assert.equal(state().future.length, 0);
  state().undo(); assert.equal(state().project.assets.audio, replacement);
  assert.equal(state().updateAsset({ ...replacement, durationSec: 3 }), false);
  assert.equal(state().project.assets.audio, replacement);
});

test("project rename permits spaces and empty editing state; transaction can cancel", () => {
  state().beginTransaction("Rename project");
  state().updateProjectName(""); state().updateProjectName("My "); state().updateProjectName("My session");
  assert.equal(state().project.name, "My session");
  state().cancelTransaction(); assert.equal(state().project.name, "Untitled");
});

test("effect presets receive independent nested IDs and accept the full visible expander range", () => {
  const effects = [defaultEffect("dynamicEq"), defaultEffect("multibandCompressor"), { ...defaultEffect("noiseGate"), rangeDb: 80 }];
  const firstTrack = state().project.tracks[0].id; const secondTrack = state().project.tracks[1].id;
  state().updateTrack(firstTrack, { effects });
  state().updateTrack(secondTrack, { effects: effects.map(cloneEffect) });
  assert.equal(state().lastError, null);
  assert.equal(state().project.tracks[1].effects.length, 3);
  assert.doesNotThrow(() => validateProject(state().project));
});

test("30 tracks and 600 clips: group gesture preserves selection and one history entry", (t) => {
  const project = createInitialProject();
  project.assets = { audio: media() };
  project.tracks = Array.from({ length: 30 }, (_, index) => makeTrack(`Track ${index + 1}`, "#60a5fa"));
  project.clips = project.tracks.flatMap((track, trackIndex) => Array.from({ length: 20 }, (_, index) => ({
    id: `clip_${trackIndex}_${index}`, trackId: track.id, assetId: "audio", start: index * 30, offset: 0, duration: 20,
  })));
  state().loadProject(project);
  const ids = project.clips.filter((_, index) => index % 60 === 0).map((clip) => clip.id);
  state().selectClips(ids);
  const start = performance.now();
  state().beginTransaction("Move ten clips");
  for (let index = 0; index < 100; index++) state().moveClips(ids, 0.1, 0, true);
  state().commitTransaction();
  t.diagnostic(`100 transient updates plus snapshots: ${(performance.now() - start).toFixed(1)} ms (Node model only)`);
  assert.equal(state().past.length, 1); assert.deepEqual(state().ui.selectedClipIds, ids);
  state().undo(); assert.equal(state().project.clips[0].start, 0);
  state().redo(); assert.ok(Math.abs(state().project.clips[0].start - 10) < 1e-8);
  assert.equal(state().project.clips.length, 600);
});
