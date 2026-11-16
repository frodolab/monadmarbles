/**
 * Monad Marbles — original, synthesized game soundtrack and cues.
 *
 * All audio is created locally with Web Audio oscillators: no audio files,
 * third-party requests, sampled/copyrighted music, autoplay bypasses, or
 * interaction with the contract/race physics. One engine lives in the parent
 * lobby (never inside the race iframe).
 */
const STORAGE_KEY = 'monad-marbles-audio-enabled-v1';
const ACTIVE_PHASES = new Set(['racing']);
const MUSIC_BPM = 98;
const EIGHTH_NOTE = 60 / MUSIC_BPM / 2;
const CHORDS = [
  [48, 55, 60, 64], // Cmaj9-ish
  [45, 52, 57, 60], // Am7
  [41, 48, 53, 57], // Fmaj7
  [43, 50, 55, 59], // G6
];
// Gentle, original two-bar melody repeated in alternating harmonic colours.
const MELODY = [
  72, null, 76, 79, null, 76, 74, null,
  76, null, 81, null, 79, 76, null, 74,
  72, null, 76, 79, null, 81, 79, null,
  76, 74, null, 72, 74, null, 76, null,
];
export const audioPhases = Object.freeze({
  music: [...ACTIVE_PHASES],
  countdownSeconds: 10,
  sounds: ['join', 'tick', 'go', 'roll', 'finish', 'podium'],
});
export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
export function remainingSeconds(startsAt, serverTime, receivedAt, now) {
  if (!Number.isFinite(Number(startsAt)) || !Number.isFinite(Number(serverTime))) return null;
  const deadline = Number(receivedAt) + Math.max(0, Number(startsAt) - Number(serverTime));
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export class GameAudio {
  constructor({
    AudioContextClass = typeof window === 'undefined'
      ? null : (window.AudioContext || window.webkitAudioContext),
    storage = typeof localStorage === 'undefined' ? null : localStorage,
    now = () => Date.now(),
    visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    every = (fn, ms) => setInterval(fn, ms),
    clearEvery = timer => clearInterval(timer),
  } = {}) {
    this.AudioContextClass = AudioContextClass;
    this.storage = storage;
    this.now = now;
    this.visible = visible;
    this.every = every;
    this.clearEvery = clearEvery;
    try { this.enabled = storage?.getItem(STORAGE_KEY) !== 'false'; }
    catch { this.enabled = true; }
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.fxBus = null;
    this.room = null;
    this.phase = 'waiting';
    this.roomKey = null;
    this.entryCount = 0;
    this.countdown = null;
    this.countdownTimer = null;
    this.lastCountdownSecond = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.nextNoteTime = 0;
    this.lastRollAt = -Infinity;
    this.lastFrameTick = -1;
    this.winnerAnnouncedKey = null;
    this.toggleButton = null;
  }

  setToggle(button) {
    this.toggleButton = button;
    this._label();
    button?.addEventListener('click', () => {
      this.setEnabled(!this.enabled);
      if (this.enabled) void this.unlock();
    });
  }

  _label() {
    const button = this.toggleButton;
    if (!button) return;
    button.textContent = this.enabled ? '🔊' : '🔇';
    button.setAttribute('aria-label', this.enabled ? 'Mute game sound' : 'Enable game sound');
    button.setAttribute('aria-pressed', String(this.enabled));
    button.title = this.enabled ? 'Mute game sound' : 'Enable game sound';
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    try { this.storage?.setItem(STORAGE_KEY, String(this.enabled)); } catch {}
    this._label();
    this._setMaster(this.enabled && this.visible() ? 0.72 : 0);
    if (this.enabled && this.visible() && this.context) this._startMusic();
    else this._stopMusic();
    if (!this.enabled) this._stopCountdown();
    else if (this.phase === 'countdown' && this.room && this.countdownTimer == null) {
      this._startCountdown(this.room.startsAt, this.room.serverTime);
    }
  }

  unlock() {
    if (!this.enabled || !this.AudioContextClass) return false;
    try {
      if (!this.context) {
        this.context = new this.AudioContextClass();
        const ctx = this.context;
        this.master = ctx.createGain();
        this.master.gain.value = 0.72;
        this.master.connect(ctx.destination);
        this.musicBus = ctx.createGain();
        this.musicBus.gain.value = 0;
        this.musicBus.connect(this.master);
        this.fxBus = ctx.createGain();
        this.fxBus.gain.value = 0.2;
        this.fxBus.connect(this.master);
      }
      if (this.context.state === 'suspended') {
        // Called synchronously on a genuine click/key/touch gesture. Do not
        // await a network request or a MetaMask permission before this resume.
        const resumed = this.context.resume();
        if (resumed?.catch) resumed.catch(() => {});
      }
      this._setMaster(this.visible() ? 0.72 : 0);
      if (ACTIVE_PHASES.has(this.phase) && this.visible()) this._startMusic();
      return true;
    } catch {
      // Audio is optional; unsupported browser/device must never block a race.
      return false;
    }
  }

  _setMaster(level) {
    if (!this.context || !this.master) return;
    const t = this.context.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(level, t, 0.035);
  }

  _tone(hz, when, duration, gain, type = 'sine', bus = this.fxBus, toHz = null) {
    if (!this.context || !this.enabled || !this.visible() || !bus) return;
    const ctx = this.context;
    const start = Math.max(ctx.currentTime, when);
    const oscillator = ctx.createOscillator();
    const env = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(hz, start);
    if (toHz != null && toHz > 0) oscillator.frequency.exponentialRampToValueAtTime(toHz, start + duration * 0.7);
    const attack = Math.min(0.025, duration * 0.14);
    const release = Math.max(start + attack + 0.005, start + duration);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(Math.max(0.001, gain), start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, release);
    oscillator.connect(env);
    env.connect(bus);
    oscillator.onended = () => { oscillator.disconnect(); env.disconnect(); };
    oscillator.start(start);
    oscillator.stop(release + 0.025);
  }

  _play(sound, detail = 0) {
    if (!this.context || !this.enabled || !this.visible()) return;
    const t = this.context.currentTime + 0.012;
    switch (sound) {
      case 'join':
        this._tone(620, t, 0.16, 0.18, 'sine');
        this._tone(830, t + 0.12, 0.27, 0.15, 'sine');
        break;
      case 'tick':
        this._tone(detail <= 3 ? 770 : 590, t, 0.075, 0.18, 'sine');
        break;
      case 'go':
        this._tone(520, t, 0.26, 0.25, 'triangle', this.fxBus, 830);
        this._tone(1046, t + 0.15, 0.38, 0.16, 'sine');
        break;
      case 'roll':
        this._tone(185, t, 0.095, 0.075, 'triangle', this.fxBus, 125);
        this._tone(370, t + 0.025, 0.07, 0.04, 'sine', this.fxBus, 310);
        break;
      case 'finish':
        this._tone(659, t, 0.2, 0.17, 'sine');
        this._tone(880, t + 0.16, 0.25, 0.18, 'sine');
        break;
      case 'podium':
        [523, 659, 784, 1046].forEach((hz, i) =>
          this._tone(hz, t + i * 0.14, i === 3 ? 0.8 : 0.36,
            i === 3 ? 0.18 : 0.12, 'sine'));
        break;
    }
  }

  _scheduleMusic() {
    if (!this.context || !this.enabled || !this.visible() ||
        !ACTIVE_PHASES.has(this.phase)) return;
    const horizon = this.context.currentTime + 0.22;
    // A backgrounded frame must not schedule a backlog of notes.
    if (this.nextNoteTime < this.context.currentTime - 0.2) {
      this.nextNoteTime = this.context.currentTime + 0.04;
    }
    let scheduled = 0;
    while (this.nextNoteTime < horizon && scheduled++ < 5) {
      const beat = this.musicStep++;
      const chord = CHORDS[Math.floor(beat / 16) % CHORDS.length];
      const note = MELODY[beat % MELODY.length];
      const at = this.nextNoteTime;
      if (note != null) {
        const chordColour = Math.floor(beat / 16) % 2 === 1 ? -2 : 0;
        this._tone(midiToHz(note + chordColour), at, EIGHTH_NOTE * 1.55,
          0.19, 'sine', this.musicBus);
      }
      if (beat % 8 === 0) {
        this._tone(midiToHz(chord[0]), at, EIGHTH_NOTE * 5.5,
          0.15, 'triangle', this.musicBus);
      }
      if (beat % 16 === 0) {
        chord.slice(1).forEach((pitch, i) => {
          this._tone(midiToHz(pitch + 12), at + i * 0.016,
            EIGHTH_NOTE * 11, 0.075, 'sine', this.musicBus);
        });
      }
      this.nextNoteTime += EIGHTH_NOTE;
    }
  }

  _startMusic() {
    if (!this.context || !this.enabled || !this.visible() ||
        !ACTIVE_PHASES.has(this.phase) || this.musicTimer != null) return;
    this.musicStep = 0;
    this.nextNoteTime = this.context.currentTime + 0.055;
    this.musicBus.gain.cancelScheduledValues(this.context.currentTime);
    this.musicBus.gain.setTargetAtTime(0.17, this.context.currentTime, 0.35);
    this._scheduleMusic();
    this.musicTimer = this.every(() => this._scheduleMusic(), 110);
  }

  _stopMusic() {
    if (this.musicTimer != null) {
      this.clearEvery(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.context && this.musicBus) {
      this.musicBus.gain.cancelScheduledValues(this.context.currentTime);
      this.musicBus.gain.setTargetAtTime(0, this.context.currentTime, 0.12);
    }
  }

  _startCountdown(startsAt, serverTime) {
    if (!Number.isFinite(Number(startsAt)) || !Number.isFinite(Number(serverTime))) return;
    const at = this.now();
    this.countdown = { startsAt, serverTime, receivedAt: at };
    if (this.countdownTimer != null) return;
    this.lastCountdownSecond = null;
    this.countdownTimer = this.every(() => this._countdownTick(), 100);
    this._countdownTick();
  }

  _countdownTick() {
    if (!this.countdown || this.phase !== 'countdown' ||
        !this.enabled || !this.visible()) return;
    const seconds = remainingSeconds(
      this.countdown.startsAt, this.countdown.serverTime,
      this.countdown.receivedAt, this.now());
    if (seconds != null && seconds >= 1 && seconds <= 10 &&
        seconds !== this.lastCountdownSecond) {
      this.lastCountdownSecond = seconds;
      this._play('tick', seconds);
    }
  }

  _stopCountdown() {
    if (this.countdownTimer != null) {
      this.clearEvery(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdown = null;
    this.lastCountdownSecond = null;
  }

  onRoom(next) {
    if (!next) return;
    const phase = next.phase || 'waiting';
    const roomKey = String(next.sessionId || '') + ':' + String(next.raceId || '');
    const count = Array.isArray(next.entries) ? next.entries.length : 0;
    const newRound = roomKey !== this.roomKey;
    const previousPhase = this.phase;
    const previousCount = this.entryCount;
    this.phase = phase;
    this.room = next;
    this.roomKey = roomKey;
    this.entryCount = count;
    if (newRound) {
      this.lastFrameTick = -1;
      this.winnerAnnouncedKey = null;
      this.lastRollAt = -Infinity;
    } else if (count > previousCount && phase === 'lobby') {
      // A single soft cue even if the server synchronizes many new entries.
      this._play('join');
    }
    if (phase === 'countdown') {
      if (previousPhase !== 'countdown' || newRound) {
        this._startCountdown(next.startsAt, next.serverTime);
      }
    } else this._stopCountdown();
    if (phase !== previousPhase || newRound) {
      if (phase === 'racing') {
        this._play('go');
        this._startMusic();
      } else {
        this._stopMusic();
        if (phase === 'finished' && next.winnerId &&
            this.winnerAnnouncedKey !== roomKey) {
          this.winnerAnnouncedKey = roomKey;
          this._play('finish');
        }
      }
    }
  }

  onFrame(frame) {
    if (!frame || this.phase !== 'racing' ||
        frame.tick <= this.lastFrameTick) return;
    this.lastFrameTick = frame.tick;
    if (!this.enabled || !this.context || !this.visible()) return;
    if (this.now() - this.lastRollAt < 1900 || !Array.isArray(frame.marbles)) return;
    // A restrained physical-world cue, based only on nearby real server
    // positions. Never uses a second local physics engine or predicts winners.
    const balls = frame.marbles;
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], b = balls[j];
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        if (dx * dx + dy * dy + dz * dz < 1.5) {
          this.lastRollAt = this.now();
          this._play('roll');
          return;
        }
      }
    }
  }

  onPodium() {
    this._stopMusic();
    this._play('podium');
  }

  onReturn() {
    this._stopMusic();
    this._stopCountdown();
  }

  onVisibilityChange() {
    if (!this.visible()) {
      this._stopMusic();
      this._setMaster(0);
      return;
    }
    this._setMaster(this.enabled ? 0.72 : 0);
    if (this.enabled) this._startMusic();
  }

  dispose() {
    this._stopMusic();
    this._stopCountdown();
    if (this.context) {
      try { const closing = this.context.close(); if (closing?.catch) closing.catch(() => {}); }
      catch {}
    }
    this.context = null;
  }
}
