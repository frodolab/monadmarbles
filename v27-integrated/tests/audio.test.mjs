import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, midiToHz, remainingSeconds, audioPhases } from '../src/audio.js';
import { readFile } from 'node:fs/promises';

class FakeParam {
  constructor() { this.value = 0; }
  cancelScheduledValues() {}
  setTargetAtTime(value) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
}
class FakeAudioContext {
  static created = 0;
  static notes = 0;
  constructor() {
    FakeAudioContext.created++;
    this.currentTime = 0;
    this.state = 'suspended';
    this.destination = {};
    this.closed = false;
  }
  createGain() { return { gain: new FakeParam(), connect() {}, disconnect() {} }; }
  createOscillator() {
    const frequency = new FakeParam();
    return {
      frequency, type: '', onended: null,
      connect() {}, disconnect() {}, start() { FakeAudioContext.notes++; }, stop() {},
    };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
}
function harness() {
  FakeAudioContext.created = 0;
  FakeAudioContext.notes = 0;
  let currentTime = 1000, id = 0;
  const intervals = new Map();
  const saved = new Map();
  const storage = {
    getItem(k) { return saved.get(k); },
    setItem(k, v) { saved.set(k, v); },
  };
  const audio = new GameAudio({
    AudioContextClass: FakeAudioContext, storage,
    now: () => currentTime, visible: () => true,
    every: (fn, ms) => { const key = ++id; intervals.set(key, { fn, ms }); return key; },
    clearEvery: key => intervals.delete(key),
  });
  return { audio, intervals, saved,
    setTime: t => { currentTime = t; },
    tick() { [...intervals.values()].forEach(x => x.fn()); },
  };
}
const room = (phase, extra = {}) => ({
  phase, sessionId: 'browser-session-1', raceId: 'race-7',
  entries: [], ...extra,
});

test('audio uses original synthesized notes without files or extra network traffic', async () => {
  const src = await readFile(new URL('../src/audio.js', import.meta.url), 'utf8');
  assert.match(src, /createOscillator/);
  assert.doesNotMatch(src, /fetch\(|new Audio\(|src\s*=\s*['"]https?:|Spotify|eth_requestAccounts|eth_sendTransaction/);
  assert.equal(Math.round(midiToHz(69)), 440);
  assert.deepEqual(audioPhases.music, ['racing']);
  assert.equal(audioPhases.countdownSeconds, 10);
});

test('no AudioContext is created and nothing plays before user gesture', () => {
  const {audio, intervals} = harness();
  audio.onRoom(room('racing'));
  assert.equal(FakeAudioContext.created, 0);
  assert.equal(FakeAudioContext.notes, 0);
  assert.equal(intervals.size, 0);
  audio.dispose();
});

test('unlock starts one quiet soundtrack only in an active race; finish stops it', () => {
  const {audio, intervals} = harness();
  audio.onRoom(room('lobby'));
  audio.unlock();
  assert.equal(intervals.size, 0);
  assert.equal(FakeAudioContext.created, 1);
  audio.onRoom(room('racing'));
  assert.equal(intervals.size, 1);
  assert.ok(FakeAudioContext.notes > 1, 'first original music notes were scheduled');
  const total = FakeAudioContext.notes;
  audio.onRoom(room('racing', {entries:[{id:'a'}]}));
  assert.equal(intervals.size, 1, 'repeated snapshots never create duplicate music loops');
  audio.onRoom(room('finished', {winnerId:'a'}));
  assert.equal(intervals.size, 0, 'no background loop remains after winner');
  const afterFinish = FakeAudioContext.notes;
  assert.ok(afterFinish > total, 'a quiet finish cue played');
  audio.onRoom(room('finished', {winnerId:'a', payout:{status:'paid'}}));
  assert.equal(FakeAudioContext.notes, afterFinish, 'payout status never repeats fanfare');
  audio.onPodium();
  assert.ok(FakeAudioContext.notes > afterFinish);
  audio.onReturn();
  assert.equal(intervals.size, 0, 'no running timers after return to lobby');
  audio.dispose();
  assert.equal(audio.context, null);
});

test('countdown sounds occur at ten distinct server-timed seconds, never a 90s timer', () => {
  const h = harness();
  const {audio, intervals} = h;
  audio.unlock();
  audio.onRoom(room('countdown', {startsAt:11000, serverTime:1000}));
  assert.equal(intervals.size, 1);
  const before = FakeAudioContext.notes;
  h.setTime(1030);
  h.tick();
  assert.equal(FakeAudioContext.notes, before, 'same second does not beep repeatedly');
  h.setTime(2010);
  h.tick();
  assert.ok(FakeAudioContext.notes > before, 'next second gets exactly one tick');
  assert.equal(remainingSeconds(11000, 1000, 1000, 2010), 9);
  assert.equal(remainingSeconds(11000, 1000, 1000, 12500), 0);
  audio.onRoom(room('racing'));
  assert.equal(intervals.size, 1, 'countdown timer replaced by one music scheduler');
  audio.dispose();
  assert.equal(intervals.size, 0);
});

test('sound toggle persists preference, silences immediately and restarts by user choice', () => {
  const h = harness();
  const {audio, saved, intervals} = h;
  const button = {
    attrs: {}, title: '', textContent: '', handlers: {},
    addEventListener(name, fn) { this.handlers[name] = fn; },
    setAttribute(key, value) { this.attrs[key] = value; },
  };
  audio.setToggle(button);
  assert.equal(button.attrs['aria-label'], 'Mute game sound');
  audio.onRoom(room('racing'));
  audio.unlock();
  assert.equal(intervals.size, 1);
  button.handlers.click();
  assert.equal(audio.enabled, false);
  assert.equal(button.textContent, '🔇');
  assert.equal(saved.get('monad-marbles-audio-enabled-v1'), 'false');
  assert.equal(intervals.size, 0);
  button.handlers.click();
  assert.equal(audio.enabled, true);
  assert.equal(button.textContent, '🔊');
  assert.equal(intervals.size, 1);
  audio.onVisibilityChange();
  audio.onReturn();
  assert.equal(intervals.size, 0);
  audio.dispose();
});

test('physical proximity sound is throttled, depends on real server marble positions', () => {
  const h = harness();
  const {audio} = h;
  audio.unlock();
  audio.onRoom(room('racing'));
  let previous = FakeAudioContext.notes;
  const marble = (id, x) => ({id, x, y:0, z:-100});
  audio.onFrame({tick:10, marbles:[marble('a',0),marble('b',0.5)]});
  assert.ok(FakeAudioContext.notes > previous);
  previous = FakeAudioContext.notes;
  h.setTime(1200);
  audio.onFrame({tick:11, marbles:[marble('a',0),marble('b',0.5)]});
  assert.equal(FakeAudioContext.notes, previous);
  h.setTime(3100);
  audio.onFrame({tick:12, marbles:[marble('a',0),marble('b',200)]});
  assert.equal(FakeAudioContext.notes, previous, 'distant marbles cause no bump sound');
  audio.dispose();
});
