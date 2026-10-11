// Web Audio API音響エンジン（自動解放・リーク防止管理付き）
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.muted = true;
    this.lastSlideSound = 0;
    this.lastZipSound = 0;
    this.lastElevatorSound = 0;
    this.lastWindSound = 0;
    this.lastSkydiveGlideSound = 0;
    this.lastTrapdoorFallSound = 0;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.8;

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

  // ★ 看板ステージ1：スカイダイブ飛び出し音（大気を引き裂く高速ジェット音）
  playSkydiveLaunch() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(380, now);
      osc1.frequency.exponentialRampToValueAtTime(1850, now + 0.22);
      gain1.gain.setValueAtTime(0.42, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.27);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(600, now + 0.02);
      osc2.frequency.exponentialRampToValueAtTime(2400, now + 0.20);
      gain2.gain.setValueAtTime(0.30, now + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      this.autoDisconnect(osc2, gain2);
      osc2.start(now + 0.02);
      osc2.stop(now + 0.25);
    } catch (e) {}
  }

  // ★ 看板ステージ1：スカイダイブ高速滑空風切り音（高音ジェット大気摩擦音）
  playSkydiveGlide(intensity = 0.5) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastSkydiveGlideSound < 0.08) return;
    this.lastSkydiveGlideSound = now;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      const baseFreq = 220 + intensity * 460;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.linearRampToValueAtTime(baseFreq + 80, now + 0.075);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200 + intensity * 2400, now);
      filter.Q.value = 3.2;

      const vol = 0.10 + intensity * 0.22;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, filter, gain);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {}
  }

  // ★ 看板ステージ2：トラップドア「ガシャン！」開放ロック解除音
  playTrapdoorOpen() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      // 1. 重厚なスチールハッチ開放音
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(260, now);
      osc1.frequency.exponentialRampToValueAtTime(45, now + 0.16);
      gain1.gain.setValueAtTime(0.48, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.19);

      // 2. 金属ロックピン解放の鋭いクリック音
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1200, now + 0.02);
      osc2.frequency.exponentialRampToValueAtTime(180, now + 0.08);
      gain2.gain.setValueAtTime(0.35, now + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      this.autoDisconnect(osc2, gain2);
      osc2.start(now + 0.02);
      osc2.stop(now + 0.11);
    } catch (e) {}
  }

  // ★ 看板ステージ2：トラップドア垂直直下ドロップ音（低周波サブベース重力降下音）
  playTrapdoorFall(intensity = 0.5) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastTrapdoorFallSound < 0.08) return;
    this.lastTrapdoorFallSound = now;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'triangle';
      const baseFreq = 120 + intensity * 260;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.linearRampToValueAtTime(baseFreq + 40, now + 0.075);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450 + intensity * 850, now);

      const vol = 0.12 + intensity * 0.20;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      this.autoDisconnect(osc, filter, gain);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {}
  }

  // 既存コードとの後方互換用エイリアス
  playDiveLaunch() { this.playSkydiveLaunch(); }
  playFreefallWind(intensity = 0.5) { this.playTrapdoorFall(intensity); }

  playLanding() {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(220, now);
      osc1.frequency.exponentialRampToValueAtTime(75, now + 0.18);
      gain1.gain.setValueAtTime(0.42, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      this.autoDisconnect(osc1, gain1);
      osc1.start(now);
      osc1.stop(now + 0.19);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.02);
      osc2.frequency.exponentialRampToValueAtTime(1320, now + 0.24);
      gain2.gain.setValueAtTime(0.28, now + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      this.autoDisconnect(osc2, gain2);
      osc2.start(now + 0.02);
      osc2.stop(now + 0.25);
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
        filter.frequency.linearRampToValueAtTime(3500, now + 0.65);

        sawOsc.type = 'sawtooth';
        sawOsc.frequency.setValueAtTime(160, now);
        sawOsc.frequency.exponentialRampToValueAtTime(2200, now + 0.65);
        sawGain.gain.setValueAtTime(0.32, now);
        sawGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        sawOsc.connect(filter);
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