// Web Audio API音響エンジン（シームレス・オートスケジューリング風音合成・ジッパーノイズ完全根絶）
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.muted = true;
    this.noiseBuffer = null;
    
    // 短発音の連打制御用
    this.lastSlideSound = 0;
    this.lastZipSound = 0;
    this.lastElevatorSound = 0;

    // スカイダイブ（前飛び）用音源参照
    this.skydiveGlideSource = null;
    this.skydiveGlideFilter = null;
    this.skydiveGlideGain = null;
    this.skydiveToneSource = null;
    this.skydiveToneGain = null;
    this.skydiveIsPlaying = false;

    // トラップドア（直下）用音源参照
    this.trapdoorFallSource = null;
    this.trapdoorFallFilter = null;
    this.trapdoorFallGain = null;
    this.trapdoorSubSource = null;
    this.trapdoorSubGain = null;
    this.trapdoorIsPlaying = false;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.82;

        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -24;
        this.compressor.knee.value = 30;
        this.compressor.ratio.value = 12;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;

        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  getNoiseBuffer() {
    if (!this.noiseBuffer && this.ctx) {
      const bufferSize = this.ctx.sampleRate * 4.0; // 4秒分の連続ノイズ
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2.0 - 1.0;
      }
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  autoDisconnect(osc, ...nodes) {
    if (!osc) return;
    osc.onended = () => {
      try {
        osc.disconnect();
        nodes.forEach(n => {
          if (n && typeof n.disconnect === 'function') n.disconnect();
        });
        osc.onended = null;
      } catch (e) {}
    };
  }

  // --- 短発系SE ---

  playCollect(pitch = 1) {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(460 * pitch, now);
      osc.frequency.exponentialRampToValueAtTime(920 * pitch, now + 0.08);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch (e) {}
  }

  playGateBoost() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const notes = [587.33, 880, 1174.66];
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const start = now + idx * 0.05;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
        osc.connect(gain);
        gain.connect(this.masterGain);
        this.autoDisconnect(osc, gain);
        osc.start(start);
        osc.stop(start + 0.17);
      });
    } catch (e) {}
  }

  playItemGet() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(587.33, now);
      osc1.frequency.exponentialRampToValueAtTime(1174.66, now + 0.12);
      gain1.gain.setValueAtTime(0.28, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.23);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.04);
      osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.2);
      gain2.gain.setValueAtTime(0.32, now + 0.04);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      this.autoDisconnect(osc2, gain2);
      osc2.start(now + 0.04);
      osc2.stop(now + 0.29);
    } catch (e) {}
  }

  playAttackShoot() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(740, now);
      osc1.frequency.exponentialRampToValueAtTime(2400, now + 0.13);
      gain1.gain.setValueAtTime(0.26, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.14);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1480, now + 0.02);
      osc2.frequency.exponentialRampToValueAtTime(3400, now + 0.15);
      gain2.gain.setValueAtTime(0.24, now + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      this.autoDisconnect(osc2, gain2);
      osc2.start(now + 0.02);
      osc2.stop(now + 0.16);
    } catch (e) {}
  }

  playAttackHit() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(280, now);
      osc1.frequency.exponentialRampToValueAtTime(50, now + 0.24);
      gain1.gain.setValueAtTime(0.42, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.26);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(1100, now);
      osc2.frequency.exponentialRampToValueAtTime(160, now + 0.16);
      gain2.gain.setValueAtTime(0.26, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      this.autoDisconnect(osc2, gain2);
      osc2.start(now);
      osc2.stop(now + 0.17);
    } catch (e) {}
  }

  // ★ 新規追加：落雷インパクト音（放電クラッシュ＋重低音雷鳴）
  playThunderStrike() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      // 1. バチッ！という強烈な初期放電クラッシュ音
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(920, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.30);
      gain.gain.setValueAtTime(0.55, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.30);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 0.31);

      // 2. ドゴォォン！と空気を震わせる重低音落雷ノイズ
      const noise = this.getNoiseBuffer();
      if (noise) {
        const src = this.ctx.createBufferSource();
        src.buffer = noise;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(650, now);
        filter.frequency.exponentialRampToValueAtTime(70, now + 0.65);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.65, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.70);

        src.connect(filter);
        filter.connect(nGain);
        nGain.connect(this.masterGain);
        src.start(now);
        src.stop(now + 0.72);
      }
    } catch (e) {}
  }

  playDrainCollect(pitchStep = 0) {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const freqs = [1760, 2093, 2637, 3136];
      const baseFreq = freqs[pitchStep % freqs.length];

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.25, now + 0.13);
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 0.16);

      const chime = this.ctx.createOscillator();
      const cGain = this.ctx.createGain();
      chime.type = 'triangle';
      chime.frequency.setValueAtTime(baseFreq * 1.8, now + 0.02);
      chime.frequency.exponentialRampToValueAtTime(baseFreq * 2.2, now + 0.12);
      cGain.gain.setValueAtTime(0.20, now + 0.02);
      cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      chime.connect(cGain);
      cGain.connect(this.masterGain);
      this.autoDisconnect(chime, cGain);
      chime.start(now + 0.02);
      chime.stop(now + 0.15);
    } catch (e) {}
  }

  playMagnetCharge() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(440, now);
      osc1.frequency.exponentialRampToValueAtTime(1760, now + 0.28);
      gain1.gain.setValueAtTime(0.24, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.36);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880, now + 0.05);
      osc2.frequency.exponentialRampToValueAtTime(2200, now + 0.28);
      gain2.gain.setValueAtTime(0.18, now + 0.05);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      this.autoDisconnect(osc2, gain2);
      osc2.start(now + 0.05);
      osc2.stop(now + 0.36);
    } catch (e) {}
  }

  playMagnetDock(step = 0) {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const freqs = [880, 987.77, 1108.73, 1174.66, 1318.51, 1396.91];
      const freq = freqs[step % freqs.length];

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.15, now + 0.06);
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {}
  }

  playBuildPlank() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(360, now);
      osc.frequency.exponentialRampToValueAtTime(560, now + 0.07);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {}
  }

  playSlide() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastSlideSound < 0.12) return;
    this.lastSlideSound = now;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(440, now + 0.1);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 0.11);
    } catch (e) {}
  }

  playZipline(speedProgress = 0.5) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastZipSound < 0.08) return;
    this.lastZipSound = now;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      const baseFreq = 480 + speedProgress * 320 + Math.random() * 60;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.linearRampToValueAtTime(baseFreq + 120, now + 0.075);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {}
  }

  playElevatorStart() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(160, now);
      osc1.frequency.exponentialRampToValueAtTime(320, now + 0.09);
      gain1.gain.setValueAtTime(0.35, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.15);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(440, now + 0.03);
      osc2.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      gain2.gain.setValueAtTime(0.20, now + 0.03);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      this.autoDisconnect(osc2, gain2);
      osc2.start(now + 0.03);
      osc2.stop(now + 0.17);
    } catch (e) {}
  }

  playElevatorMotor(speedRatio = 0.5) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastElevatorSound < 0.09) return;
    this.lastElevatorSound = now;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      const baseFreq = 95 + speedRatio * 180;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.linearRampToValueAtTime(baseFreq + 24, now + 0.085);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch (e) {}
  }

  playElevatorArrival() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const chime1 = this.ctx.createOscillator();
      const g1 = this.ctx.createGain();
      chime1.type = 'sine';
      chime1.frequency.setValueAtTime(880, now);
      g1.gain.setValueAtTime(0.28, now);
      g1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      chime1.connect(g1);
      g1.connect(this.masterGain);
      this.autoDisconnect(chime1, g1);
      chime1.start(now);
      chime1.stop(now + 0.29);

      const chime2 = this.ctx.createOscillator();
      const g2 = this.ctx.createGain();
      chime2.type = 'sine';
      chime2.frequency.setValueAtTime(1174.66, now + 0.12);
      g2.gain.setValueAtTime(0.25, now + 0.12);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      chime2.connect(g2);
      g2.connect(this.masterGain);
      this.autoDisconnect(chime2, g2);
      chime2.start(now + 0.12);
      chime2.stop(now + 0.43);
    } catch (e) {}
  }

  // --- ★ スカイダイブ専用音響：澄み切った高域大気風音＆軽やかなエアストリーム（優雅な滑空） ---

  playSkydiveLaunch() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(360, now);
      osc1.frequency.exponentialRampToValueAtTime(1400, now + 0.20);
      gain1.gain.setValueAtTime(0.32, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.25);
    } catch (e) {}
  }

  startSkydiveGlide(totalDuration = 3.1) {
    if (this.muted || !this.ctx) return;
    this.stopSkydiveGlide();
    try {
      const noiseBuffer = this.getNoiseBuffer();
      if (!noiseBuffer) return;
      this.skydiveIsPlaying = true;
      const now = this.ctx.currentTime;

      // 1. ノイズの高域を優しくカットした澄んだ大気風音（ざらつきを抑えた高域滑空ノイズ）
      this.skydiveGlideSource = this.ctx.createBufferSource();
      this.skydiveGlideSource.buffer = noiseBuffer;
      this.skydiveGlideSource.loop = true;

      this.skydiveGlideFilter = this.ctx.createBiquadFilter();
      this.skydiveGlideFilter.type = 'bandpass';
      this.skydiveGlideFilter.Q.setValueAtTime(2.2, now); // 狭いQ値で澄んだ空気感

      this.skydiveGlideFilter.frequency.setValueAtTime(950, now);
      this.skydiveGlideFilter.frequency.exponentialRampToValueAtTime(1600, now + totalDuration * 0.40);
      this.skydiveGlideFilter.frequency.exponentialRampToValueAtTime(1400, now + totalDuration * 0.80);
      this.skydiveGlideFilter.frequency.exponentialRampToValueAtTime(900, now + totalDuration);

      this.skydiveGlideGain = this.ctx.createGain();
      this.skydiveGlideGain.gain.setValueAtTime(0.01, now);
      this.skydiveGlideGain.gain.linearRampToValueAtTime(0.18, now + 0.25);
      this.skydiveGlideGain.gain.setValueAtTime(0.18, now + totalDuration * 0.82);
      this.skydiveGlideGain.gain.linearRampToValueAtTime(0.001, now + totalDuration);

      this.skydiveGlideSource.connect(this.skydiveGlideFilter);
      this.skydiveGlideFilter.connect(this.skydiveGlideGain);
      this.skydiveGlideGain.connect(this.masterGain);

      // 2. 澄んだ空気中を飛ぶサイン波のエアストリーム（優雅な浮遊ハーモニクス）
      this.skydiveToneSource = this.ctx.createOscillator();
      this.skydiveToneGain = this.ctx.createGain();
      this.skydiveToneSource.type = 'sine';
      this.skydiveToneSource.frequency.setValueAtTime(320, now);
      this.skydiveToneSource.frequency.exponentialRampToValueAtTime(460, now + totalDuration * 0.50);
      this.skydiveToneSource.frequency.exponentialRampToValueAtTime(310, now + totalDuration);

      this.skydiveToneGain.gain.setValueAtTime(0.01, now);
      this.skydiveToneGain.gain.linearRampToValueAtTime(0.08, now + 0.30);
      this.skydiveToneGain.gain.setValueAtTime(0.08, now + totalDuration * 0.78);
      this.skydiveToneGain.gain.linearRampToValueAtTime(0.001, now + totalDuration);

      this.skydiveToneSource.connect(this.skydiveToneGain);
      this.skydiveToneGain.connect(this.masterGain);

      this.skydiveGlideSource.start(now);
      this.skydiveGlideSource.stop(now + totalDuration + 0.1);
      this.skydiveToneSource.start(now);
      this.skydiveToneSource.stop(now + totalDuration + 0.1);
    } catch (e) {}
  }

  modulateSkydiveGlide(intensity) {}

  stopSkydiveGlide() {
    if (!this.skydiveIsPlaying || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      if (this.skydiveGlideGain) {
        this.skydiveGlideGain.gain.cancelScheduledValues(now);
        this.skydiveGlideGain.gain.setValueAtTime(this.skydiveGlideGain.gain.value, now);
        this.skydiveGlideGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      }
      if (this.skydiveToneGain) {
        this.skydiveToneGain.gain.cancelScheduledValues(now);
        this.skydiveToneGain.gain.setValueAtTime(this.skydiveToneGain.gain.value, now);
        this.skydiveToneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      }
      if (this.skydiveGlideSource) this.skydiveGlideSource.stop(now + 0.10);
      if (this.skydiveToneSource) this.skydiveToneSource.stop(now + 0.10);

      const src = this.skydiveGlideSource;
      const flt = this.skydiveGlideFilter;
      const gn = this.skydiveGlideGain;
      const tSrc = this.skydiveToneSource;
      const tGn = this.skydiveToneGain;

      setTimeout(() => {
        if (src) { try { src.disconnect(); } catch (e) {} }
        if (flt) { try { flt.disconnect(); } catch (e) {} }
        if (gn) { try { gn.disconnect(); } catch (e) {} }
        if (tSrc) { try { tSrc.disconnect(); } catch (e) {} }
        if (tGn) { try { tGn.disconnect(); } catch (e) {} }
      }, 150);

      this.skydiveGlideSource = null;
      this.skydiveGlideFilter = null;
      this.skydiveGlideGain = null;
      this.skydiveToneSource = null;
      this.skydiveToneGain = null;
      this.skydiveIsPlaying = false;
    } catch (e) {}
  }

  // --- ★ フリーフォール専用音響：重厚メカロック解放 ＆ 垂直ドップラー急降下突風（ヒュオオオッ！） ---

  playTrapdoorOpen() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      // 重厚な金属ラッチ解放音（カシャン！ガコッ！）
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(320, now);
      osc1.frequency.exponentialRampToValueAtTime(35, now + 0.16);
      gain1.gain.setValueAtTime(0.58, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.18);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(2100, now + 0.015);
      osc2.frequency.exponentialRampToValueAtTime(280, now + 0.09);
      gain2.gain.setValueAtTime(0.44, now + 0.015);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      this.autoDisconnect(osc2, gain2);
      osc2.start(now + 0.015);
      osc2.stop(now + 0.12);
    } catch (e) {}
  }

  startTrapdoorFall(totalDuration = 3.1) {
    if (this.muted || !this.ctx) return;
    this.stopTrapdoorFall();
    try {
      const noiseBuffer = this.getNoiseBuffer();
      if (!noiseBuffer) return;
      this.trapdoorIsPlaying = true;
      const now = this.ctx.currentTime;

      // 1. 大気を垂直に貫き、重低音から高音へ一気に駆け上がるドップラー突風（ヒュオオオッ！）
      this.trapdoorFallSource = this.ctx.createBufferSource();
      this.trapdoorFallSource.buffer = noiseBuffer;
      this.trapdoorFallSource.loop = true;

      this.trapdoorFallFilter = this.ctx.createBiquadFilter();
      this.trapdoorFallFilter.type = 'bandpass';
      this.trapdoorFallFilter.Q.setValueAtTime(1.0, now); // 幅広い帯域で迫力のある突風感

      // 初速のタメ（無重力の静寂）から、重力加速度とともに2900Hzへ急激に駆け上がるドップラーカーブ
      this.trapdoorFallFilter.frequency.setValueAtTime(500, now);
      this.trapdoorFallFilter.frequency.exponentialRampToValueAtTime(800, now + 0.25);
      this.trapdoorFallFilter.frequency.exponentialRampToValueAtTime(2100, now + totalDuration * 0.60);
      this.trapdoorFallFilter.frequency.exponentialRampToValueAtTime(3200, now + totalDuration * 0.90);
      this.trapdoorFallFilter.frequency.exponentialRampToValueAtTime(1200, now + totalDuration);

      this.trapdoorFallGain = this.ctx.createGain();
      this.trapdoorFallGain.gain.setValueAtTime(0.01, now);
      this.trapdoorFallGain.gain.linearRampToValueAtTime(0.35, now + 0.22);
      this.trapdoorFallGain.gain.setValueAtTime(0.35, now + totalDuration * 0.88);
      this.trapdoorFallGain.gain.linearRampToValueAtTime(0.001, now + totalDuration);

      this.trapdoorFallSource.connect(this.trapdoorFallFilter);
      this.trapdoorFallFilter.connect(this.trapdoorFallGain);
      this.trapdoorFallGain.connect(this.masterGain);

      // 2. 重力で真下へ吸い込まれる重厚なサブベース唸り（垂直フリーフォールの迫力低域）
      this.trapdoorSubSource = this.ctx.createOscillator();
      this.trapdoorSubGain = this.ctx.createGain();
      this.trapdoorSubSource.type = 'triangle';
      this.trapdoorSubSource.frequency.setValueAtTime(85, now);
      this.trapdoorSubSource.frequency.exponentialRampToValueAtTime(140, now + totalDuration * 0.70);
      this.trapdoorSubSource.frequency.exponentialRampToValueAtTime(70, now + totalDuration);

      this.trapdoorSubGain.gain.setValueAtTime(0.01, now);
      this.trapdoorSubGain.gain.linearRampToValueAtTime(0.18, now + 0.20);
      this.trapdoorSubGain.gain.setValueAtTime(0.18, now + totalDuration * 0.85);
      this.trapdoorSubGain.gain.linearRampToValueAtTime(0.001, now + totalDuration);

      this.trapdoorSubSource.connect(this.trapdoorSubGain);
      this.trapdoorSubGain.connect(this.masterGain);

      this.trapdoorFallSource.start(now);
      this.trapdoorFallSource.stop(now + totalDuration + 0.1);
      this.trapdoorSubSource.start(now);
      this.trapdoorSubSource.stop(now + totalDuration + 0.1);
    } catch (e) {}
  }

  modulateTrapdoorFall(intensity) {}

  stopTrapdoorFall() {
    if (!this.trapdoorIsPlaying || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      if (this.trapdoorFallGain) {
        this.trapdoorFallGain.gain.cancelScheduledValues(now);
        this.trapdoorFallGain.gain.setValueAtTime(this.trapdoorFallGain.gain.value, now);
        this.trapdoorFallGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      }
      if (this.trapdoorSubGain) {
        this.trapdoorSubGain.gain.cancelScheduledValues(now);
        this.trapdoorSubGain.gain.setValueAtTime(this.trapdoorSubGain.gain.value, now);
        this.trapdoorSubGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      }
      if (this.trapdoorFallSource) this.trapdoorFallSource.stop(now + 0.10);
      if (this.trapdoorSubSource) this.trapdoorSubSource.stop(now + 0.10);

      const src = this.trapdoorFallSource;
      const flt = this.trapdoorFallFilter;
      const gn = this.trapdoorFallGain;
      const sSrc = this.trapdoorSubSource;
      const sGn = this.trapdoorSubGain;

      setTimeout(() => {
        if (src) { try { src.disconnect(); } catch (e) {} }
        if (flt) { try { flt.disconnect(); } catch (e) {} }
        if (gn) { try { gn.disconnect(); } catch (e) {} }
        if (sSrc) { try { sSrc.disconnect(); } catch (e) {} }
        if (sGn) { try { sGn.disconnect(); } catch (e) {} }
      }, 150);

      this.trapdoorFallSource = null;
      this.trapdoorFallFilter = null;
      this.trapdoorFallGain = null;
      this.trapdoorSubSource = null;
      this.trapdoorSubGain = null;
      this.trapdoorIsPlaying = false;
    } catch (e) {}
  }

  // 既存コードとの後方互換用エイリアス
  playDiveLaunch() { this.playSkydiveLaunch(); }
  playFreefallWind(intensity = 0.5) {}
  playTrapdoorFall(t) {}
  playSkydiveGlide(t) {}

  playLanding() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(210, now);
      osc1.frequency.exponentialRampToValueAtTime(65, now + 0.16);
      gain1.gain.setValueAtTime(0.44, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.18);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(740, now + 0.02);
      osc2.frequency.exponentialRampToValueAtTime(1100, now + 0.20);
      gain2.gain.setValueAtTime(0.24, now + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      this.autoDisconnect(osc2, gain2);
      osc2.start(now + 0.02);
      osc2.stop(now + 0.21);
    } catch (e) {}
  }

  playJump(tierId = 'normal') {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      if (tierId === 'normal') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.25);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(this.masterGain);
        this.autoDisconnect(osc, gain);
        osc.start(now);
        osc.stop(now + 0.26);
      } else if (tierId === 'high') {
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(120, now);
        osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.42);
        gain1.gain.setValueAtTime(0.34, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        osc1.connect(gain1);
        gain1.connect(this.masterGain);
        this.autoDisconnect(osc1, gain1);
        osc1.start(now);
        osc1.stop(now + 0.43);

        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(587.33, now);
        osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.42);
        gain2.gain.setValueAtTime(0.25, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        osc2.connect(gain2);
        gain2.connect(this.masterGain);
        this.autoDisconnect(osc2, gain2);
        osc2.start(now);
        osc2.stop(now + 0.43);
      } else if (tierId === 'mega') {
        const subOsc = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(95, now);
        subOsc.frequency.exponentialRampToValueAtTime(32, now + 0.32);
        subGain.gain.setValueAtTime(0.58, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        subOsc.connect(subGain);
        subGain.connect(this.masterGain);
        this.autoDisconnect(subOsc, subGain);
        subOsc.start(now);
        subOsc.stop(now + 0.33);

        const sawOsc = this.ctx.createOscillator();
        const sawGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, now);
        filter.frequency.linearRampToValueAtTime && filter.frequency.linearRampToValueAtTime(3500, now + 0.65);

        sawOsc.type = 'sawtooth';
        sawOsc.frequency.setValueAtTime(160, now);
        sawOsc.frequency.exponentialRampToValueAtTime(2200, now + 0.65);
        sawGain.gain.setValueAtTime(0.32, now);
        sawGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        osc.connect(filter);
        filter.connect(sawGain);
        sawGain.connect(this.masterGain);
        this.autoDisconnect(sawOsc, filter, sawGain);
        sawOsc.start(now);
        sawOsc.stop(now + 0.66);

        const chNotes = [1318.5, 1760.0, 2637.0];
        chNotes.forEach((freq, idx) => {
          const chOsc = this.ctx.createOscillator();
          const chGain = this.ctx.createGain();
          const startT = now + 0.22 + idx * 0.08;
          chOsc.type = 'sine';
          chOsc.frequency.setValueAtTime(freq, startT);
          chGain.gain.setValueAtTime(0.24, startT);
          chGain.gain.exponentialRampToValueAtTime(0.001, startT + 0.30);
          chOsc.connect(chGain);
          chGain.connect(this.masterGain);
          this.autoDisconnect(chOsc, chGain);
          chOsc.start(startT);
          chOsc.stop(startT + 0.32);
        });
      }
    } catch (e) {}
  }

  playTackle() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 0.19);
    } catch (e) {}
  }

  playVictory() {
    if (this.muted || !this.ctx) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const start = this.ctx.currentTime + idx * 0.12;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        osc.connect(gain);
        gain.connect(this.masterGain);
        this.autoDisconnect(osc, gain);
        osc.start(start);
        osc.stop(start + 0.37);
      });
    } catch (e) {}
  }
}