/**
 * ==============================================================================
 * 『くねくねバトル オンライン』Web Audio API プログラム動的音響エンジン (audio.js)
 * 外部音源ファイル 0バイト・遅延 0ms・iOS WebKit 音声制限完全クリア仕様
 * ==============================================================================
 */

class AudioManager {
    constructor() {
        this.ctx = null;
        this.isMuted = true; // デフォルトOFF
        this.boostOsc = null;
        this.boostGain = null;
    }

    // iOS WebKitのユーザー操作トリガーによるAudioContext初期化
    initContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    // サウンド ON / OFF 切り替え
    toggleMute() {
        this.initContext();
        this.isMuted = !this.isMuted;

        if (this.isMuted) {
            this.stopBoostSound();
        } else {
            // ONになった瞬間のフィードバック音（明るい2音アルペジオ）
            this.playChime();
        }
        return this.isMuted;
    }

    // 小餌取得音（サイン波 880Hz -> 1320Hz の爽快なピコ音）
    playEatSmall() {
        if (this.isMuted || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1320, now + 0.05);

            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 0.05);
        } catch (e) {}
    }

    // 巨大餌取得音（三角波 440Hz -> 880Hz -> 1760Hz のリッチな和音）
    playEatBig() {
        if (this.isMuted || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.setValueAtTime(880, now + 0.04);
            osc.frequency.setValueAtTime(1760, now + 0.08);

            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 0.14);
        } catch (e) {}
    }

    // ブースト加速音（低周波 110Hz 鋸歯状波 + ローパスフィルタ）開始
    startBoostSound() {
        if (this.isMuted || !this.ctx || this.boostOsc) return;
        try {
            const now = this.ctx.currentTime;
            this.boostOsc = this.ctx.createOscillator();
            this.boostGain = this.ctx.createGain();
            const filter = this.ctx.createBiquadFilter();

            this.boostOsc.type = 'sawtooth';
            this.boostOsc.frequency.setValueAtTime(110, now);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(320, now);

            this.boostGain.gain.setValueAtTime(0.01, now);
            this.boostGain.gain.linearRampToValueAtTime(0.06, now + 0.08);

            this.boostOsc.connect(filter);
            filter.connect(this.boostGain);
            this.boostGain.connect(this.ctx.destination);

            this.boostOsc.start(now);
        } catch (e) {}
    }

    // ブースト加速音 停止
    stopBoostSound() {
        if (!this.boostOsc || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            this.boostGain.gain.linearRampToValueAtTime(0.001, now + 0.05);
            this.boostOsc.stop(now + 0.05);
        } catch (e) {}
        this.boostOsc = null;
        this.boostGain = null;
    }

    // 激突・撃破音（低音バースト）
    playCrash() {
        if (this.isMuted || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(140, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);

            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 0.25);
        } catch (e) {}
    }

    // 起動確認チャイム
    playChime() {
        if (!this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + i * 0.06);
                gain.gain.setValueAtTime(0.1, now + i * 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.12);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now + i * 0.06);
                osc.stop(now + i * 0.06 + 0.12);
            });
        } catch (e) {}
    }
}

export const Sound = new AudioManager();