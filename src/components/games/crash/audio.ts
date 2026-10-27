/**
 * Badge Rocket — procedural flight audio (the pingu/audio.ts doctrine: a
 * tiny AudioContext synth, unlocked on the first pointer/keydown, no audio
 * files, a mute toggle that rides the master gain).
 *
 * The climb is the signature sound: a soft tick per integer multiplier
 * crossing, its pitch rising with the multiplier — the audio itself tells
 * you how high you are and how close the edge feels.
 */
type SoundName = "launch" | "tick" | "cashout" | "crash" | "moon";

export type AudioBus = {
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  muted: () => boolean;
  play: (name: SoundName, level?: number) => void;
};

export function createAudio(): AudioBus {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;

  function ensure() {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  function tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slide = 1,
    delay = 0,
  ) {
    if (!ctx || !master || muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide !== 1) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur: number, gain: number, freq = 800, delay = 0) {
    if (!ctx || !master || muted) return;
    const t = ctx.currentTime + delay;
    const length = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  return {
    unlock() {
      ensure();
    },
    setMuted(next) {
      muted = next;
      if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 0.8, ctx.currentTime, 0.02);
    },
    muted: () => muted,
    play(name, level = 0) {
      ensure();
      if (muted || !ctx) return;
      if (name === "launch") {
        // Ignition: a rising engine tone over a rumble bed.
        tone(70, 0.9, "sawtooth", 0.1, 3.2);
        noise(0.7, 0.1, 220);
      }
      if (name === "tick") {
        // One rung higher on the ladder: pitch climbs with the multiplier.
        const semis = Math.min(24, level);
        tone(392 * Math.pow(2, semis / 12), 0.07, "triangle", 0.05);
      }
      if (name === "cashout") {
        tone(523, 0.1, "triangle", 0.08, 1);
        tone(659, 0.12, "triangle", 0.08, 1, 0.09);
        tone(784, 0.22, "triangle", 0.08, 1, 0.18);
        for (let i = 0; i < 4; i += 1) {
          tone(1046 + Math.random() * 300, 0.06, "sine", 0.03, 1, 0.22 + i * 0.05);
        }
      }
      if (name === "crash") {
        tone(64, 0.4, "sine", 0.26, 0.45);
        noise(0.42, 0.24, 900);
        noise(0.3, 0.12, 180, 0.06);
      }
      if (name === "moon") {
        // The 10x pad: a soft major chord as the moon fills the frame.
        tone(392, 0.7, "sine", 0.05, 1);
        tone(494, 0.7, "sine", 0.045, 1, 0.05);
        tone(587, 0.9, "sine", 0.045, 1, 0.1);
      }
    },
  };
}
