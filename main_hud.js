// main_hud.js: タイマー・スコア演出・リスタート権限・公式スコア送信・画面中央5秒カウントダウンHUD制御モジュール
// ★ カウントダウンHUD完全統合版（Phase 3）：
//   1. 【画面中央5秒カウントダウンDOM制御（showCountdownOverlay / updateCountdownHUD / triggerCountdownGo）】
//      5, 4, 3, 2, 1 の数字切り替え時にスプリングアニメーション（countdownPop）を毎秒再トリガー。
//      Web Audio API（playCountdownTick / playCountdownGo）と完全連携し、明瞭な電子シグナル音を再生。
//      GO! 到達時は黄金ネオン演出（countdownGo）を再生し、約0.8秒後に自動非表示化。
//   2. 【タイマー＆スコア演出・リスタート権限制御・公式スコア送信の100%維持】

import { player } from './character.js';

export let timeLeft = 300;
export let isGameOver = false;
export let placedPlankCount = 0;
export let lastDisplayedSec = -1;

export function setTimeLeft(val) { timeLeft = val; }
export function decrementTimeLeft(dt) { timeLeft = Math.max(0, timeLeft - dt); }
export function setIsGameOver(val) { isGameOver = val; }
export function setPlacedPlankCount(val) { placedPlankCount = val; }
export function incPlacedPlankCount() { placedPlankCount++; }
export function setLastDisplayedSec(val) { lastDisplayedSec = val; }

// 階段スコア連続加算アンチシェイク用タイマー
let scorePopTimer = null;
let lastPlankPlacedTime = 0;

// カウントダウン表示管理用
let lastCountdownNumber = -1;
let countdownGoTimer = null;

export function resetHUDTimers() {
  if (scorePopTimer) {
    clearTimeout(scorePopTimer);
    scorePopTimer = null;
  }
  if (countdownGoTimer) {
    clearTimeout(countdownGoTimer);
    countdownGoTimer = null;
  }
  lastPlankPlacedTime = 0;
  lastCountdownNumber = -1;
  hideCountdownHUD();
}

/**
 * カウントダウンHUD表示開始
 * @param {number} startNumber 初期表示カウント（通常 5）
 */
export function showCountdownHUD(startNumber = 5) {
  const overlay = document.getElementById('hud-countdown-overlay');
  const textEl = document.getElementById('countdown-text');
  const subEl = document.getElementById('countdown-sub');

  if (countdownGoTimer) {
    clearTimeout(countdownGoTimer);
    countdownGoTimer = null;
  }

  lastCountdownNumber = startNumber;

  if (overlay) {
    overlay.classList.add('active');
  }

  if (textEl) {
    textEl.className = 'countdown-number';
    textEl.textContent = String(startNumber);
    // アニメーションの再トリガー
    textEl.style.animation = 'none';
    void textEl.offsetWidth; // リフロー強制
    textEl.style.animation = '';
  }

  if (subEl) {
    subEl.textContent = 'READY...';
    subEl.style.display = 'block';
  }
}

/**
 * 毎フレームのカウントダウンHUD更新（残り秒数に基づく数字切り替え・音再生）
 * @param {number} remainingSec 残り秒数（例: 4.8, 3.2）
 * @param {Object} sound SoundEngine インスタンス
 */
export function updateCountdownHUD(remainingSec, sound = null) {
  const overlay = document.getElementById('hud-countdown-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;

  const currentNumber = Math.max(1, Math.ceil(remainingSec));

  if (currentNumber !== lastCountdownNumber && currentNumber >= 1) {
    lastCountdownNumber = currentNumber;
    const textEl = document.getElementById('countdown-text');
    if (textEl) {
      textEl.className = 'countdown-number';
      textEl.textContent = String(currentNumber);
      textEl.style.animation = 'none';
      void textEl.offsetWidth; // リフロー強制
      textEl.style.animation = '';
    }

    // 5〜1の電子音再生（カウントが進むごとに少しだけピッチアップ）
    if (sound && typeof sound.playCountdownTick === 'function') {
      const pitchMultiplier = 1.0 + (5 - currentNumber) * 0.04;
      sound.playCountdownTick(pitchMultiplier);
    }
  }
}

/**
 * 「GO!」演出トリガー＆自動フェードアウト消去
 * @param {Object} sound SoundEngine インスタンス
 */
export function triggerCountdownGo(sound = null) {
  const overlay = document.getElementById('hud-countdown-overlay');
  const textEl = document.getElementById('countdown-text');
  const subEl = document.getElementById('countdown-sub');

  if (!overlay) return;

  if (countdownGoTimer) {
    clearTimeout(countdownGoTimer);
  }

  if (textEl) {
    textEl.className = 'countdown-go';
    textEl.textContent = 'GO!!';
    textEl.style.animation = 'none';
    void textEl.offsetWidth;
    textEl.style.animation = '';
  }

  if (subEl) {
    subEl.textContent = 'START!!';
  }

  // GO! 和音シグナル音再生
  if (sound && typeof sound.playCountdownGo === 'function') {
    sound.playCountdownGo();
  }

  // アニメーション完了（約0.8秒）後に非表示化
  countdownGoTimer = setTimeout(() => {
    hideCountdownHUD();
    countdownGoTimer = null;
  }, 820);
}

/**
 * カウントダウンHUDの即時非表示
 */
export function hideCountdownHUD() {
  const overlay = document.getElementById('hud-countdown-overlay');
  if (overlay) {
    overlay.classList.remove('active');
  }
  const textEl = document.getElementById('countdown-text');
  if (textEl) {
    textEl.className = 'countdown-number';
    textEl.textContent = '';
  }
  lastCountdownNumber = -1;
}

if (typeof window !== 'undefined') {
  window.showCountdownHUD = showCountdownHUD;
  window.updateCountdownHUD = updateCountdownHUD;
  window.triggerCountdownGo = triggerCountdownGo;
  window.hideCountdownHUD = hideCountdownHUD;
}

/**
 * リスタートボタン（クイックリスタート＆結果モーダル）の表示権限更新関数
 */
export function updateRestartButtonVisibility() {
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = Boolean(isMulti && window.NetworkManager.isHost);

  const quickRestartBtn = document.getElementById('btn-restart-quick');
  if (quickRestartBtn) {
    if (!isMulti || isHost) {
      quickRestartBtn.style.setProperty('display', 'flex', 'important');
      quickRestartBtn.classList.remove('hidden');
    } else {
      quickRestartBtn.style.setProperty('display', 'none', 'important');
      quickRestartBtn.classList.add('hidden');
    }
  }

  const resultRestartBtn = document.getElementById('btn-restart');
  if (resultRestartBtn) {
    if (!isMulti || isHost) {
      resultRestartBtn.style.setProperty('display', 'block', 'important');
    } else {
      resultRestartBtn.style.setProperty('display', 'none', 'important');
    }
  }
}

if (typeof window !== 'undefined') {
  window.updateRestartButtonVisibility = updateRestartButtonVisibility;
}

/**
 * GRAVITY公式仕様準拠：親アプリ（ネイティブ層）へスコアを送信
 */
export function submitGravityScore(score) {
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  try {
    if (typeof window !== 'undefined' && window.parent) {
      window.parent.postMessage({
        type: 'gameOver',
        score: safeScore
      }, '*');
      console.log(`[GravityScore] Score (${safeScore}) submitted successfully via postMessage.`);
    }
  } catch (err) {
    console.warn('[GravityScore] Failed to postMessage score to GRAVITY native:', err);
  }
}

if (typeof window !== 'undefined') {
  window.submitGravityScore = submitGravityScore;
}

/**
 * ホストから 10Hz POS パケット（tl キー）で届いた残り秒数を平滑同期
 */
export function applyRemoteTimeSync(remoteTimeLeft) {
  if (typeof remoteTimeLeft === 'number' && !isNaN(remoteTimeLeft)) {
    const diff = Math.abs(timeLeft - remoteTimeLeft);
    if (diff > 0.4) {
      if (diff > 2.0) {
        timeLeft = remoteTimeLeft;
      } else {
        timeLeft = THREE.MathUtils.lerp(timeLeft, remoteTimeLeft, 0.4);
      }
      updateTimerHUD(true);
    }
  }
}

/**
 * ホストからタイムアップ宣告を受信した際のハンドラ
 */
export function applyRemoteTimeUp(sound = null) {
  if (!isGameOver) {
    timeLeft = 0;
    updateTimerHUD(true);
    onTimeUp(sound);
  }
}

if (typeof window !== 'undefined') {
  window.getGameTimeLeft = () => timeLeft;
  window.applyRemoteTimeSync = applyRemoteTimeSync;
  window.applyRemoteTimeUp = (s) => applyRemoteTimeUp(s);
}

/**
 * GRAVITY環境の上部立ち入り禁止エリア動的オフセット
 */
export function applyGravityTopInset(isGravityApp) {
  const hudContainer = document.getElementById('hud-top-container');
  if (!hudContainer) return;

  if (isGravityApp) {
    const isTall = window.innerHeight >= 812;
    const topInset = isTall ? 98 : 74;
    hudContainer.style.paddingTop = `${topInset + 8}px`;
  } else {
    hudContainer.style.paddingTop = '';
  }
}

/**
 * 階段スコアのポップ演出
 */
export function triggerScorePop() {
  const scoreEl = document.getElementById('hud-score');
  if (!scoreEl) return;

  const now = performance.now();
  const timeSinceLast = now - lastPlankPlacedTime;
  lastPlankPlacedTime = now;

  if (scorePopTimer) {
    clearTimeout(scorePopTimer);
  }

  if (timeSinceLast < 140) {
    scoreEl.classList.remove('score-pop');
    scoreEl.classList.add('score-clamped');
  } else {
    scoreEl.classList.remove('score-pop');
    scoreEl.classList.add('score-pop');
  }

  scorePopTimer = setTimeout(() => {
    scoreEl.classList.remove('score-pop', 'score-clamped');
    scorePopTimer = null;
  }, 140);
}

export function updateHUD() {
  const countEl = document.getElementById('hud-stack-count');
  const scoreEl = document.getElementById('hud-score');
  if (countEl && player) countEl.innerText = player.stackCount;
  if (scoreEl) scoreEl.innerText = placedPlankCount;
}

/**
 * タイマー表示更新（残り30秒でネオンレッド化）
 */
export function updateTimerHUD(force = false) {
  const currentSecInt = Math.floor(timeLeft);
  if (!force && currentSecInt === lastDisplayedSec) return;
  lastDisplayedSec = currentSecInt;
  const min = Math.floor(currentSecInt / 60).toString().padStart(2, '0');
  const sec = (currentSecInt % 60).toString().padStart(2, '0');
  const timerEl = document.getElementById('hud-timer');
  if (timerEl) {
    timerEl.innerText = `${min}:${sec}`;

    if (timeLeft <= 30 && timeLeft > 0) {
      if (!timerEl.classList.contains('timer-critical')) {
        timerEl.classList.add('timer-critical');
        timerEl.style.textShadow = '0 0 12px rgba(244, 63, 94, 0.85), 0 2px 6px rgba(0, 0, 0, 0.95)';
      }
    } else {
      if (timerEl.classList.contains('timer-critical')) {
        timerEl.classList.remove('timer-critical');
      }
      timerEl.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.95), 0 0 4px rgba(0, 0, 0, 0.9)';
    }
  }
}

/**
 * タイムアップ確定処理
 */
export function onTimeUp(sound = null) {
  if (isGameOver) return;
  isGameOver = true;

  if (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive && window.NetworkManager.isHost) {
    if (typeof window.NetworkManager.broadcastTimeUp === 'function') {
      window.NetworkManager.broadcastTimeUp();
    }
  }

  if (sound) sound.playVictory();

  const rankEl = document.getElementById('modal-rank');
  if (rankEl) rankEl.innerText = placedPlankCount + ' 段';
  const resultModal = document.getElementById('modal-result');
  if (resultModal) {
    resultModal.classList.remove('hidden');
    resultModal.style.display = 'flex';
  }
  updateRestartButtonVisibility();

  submitGravityScore(placedPlankCount);
}