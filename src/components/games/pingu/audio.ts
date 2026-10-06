type SoundName = "dive" | "swing" | "hit" | "bounce" | "stick" | "whiff" | "done" | "best";

export type AudioBus = {
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  muted: () => boolean;
  play: (name: SoundName, power?: number) => void;
};

export function createAudio(): AudioBus {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  function tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 1) {
    if (!ctx || !master || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide !== 1) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur: number, gain: number, freq = 800) {
    if (!ctx || !master || muted) return;
    const t = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
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
    play(name, power = 0.6) {
      ensure();
      if (muted || !ctx) return;
      if (name === "dive") tone(420, 0.12, "triangle", 0.08, 1.4);
      if (name === "swing") noise(0.18, 0.12, 500);
      if (name === "hit") {
        tone(110 + power * 70, 0.16, "sine", 0.22, 0.55);
        noise(0.08, 0.16, 1400);
      }
      if (name === "bounce") tone(280 + Math.random() * 80, 0.12, "sine", 0.1, 0.6);
      if (name === "stick") {
        tone(70, 0.22, "sine", 0.2, 0.4);
        noise(0.14, 0.12, 300);
      }
      if (name === "whiff") tone(180, 0.1, "sine", 0.05, 0.7);
      if (name === "done") {
        tone(523, 0.12, "triangle", 0.06, 1);
        tone(659, 0.16, "triangle", 0.05, 1);
      }
      if (name === "best") {
        tone(523, 0.1, "triangle", 0.07, 1);
        tone(659, 0.12, "triangle", 0.07, 1);
        tone(784, 0.2, "triangle", 0.07, 1);
      }
    },
  };
}
