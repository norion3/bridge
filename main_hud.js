// main_hud.js: タイマー・スコア演出・リスタート権限・公式スコア送信専用モジュール
// ★ main.js からHUD制御・ランキング連携ロジックを完全分離（Package 5）
//   1. 【GRAVITY公式スコア送信 API postMessage 連携】
//      ゲーム終了時の確定段数を親アプリネイティブ層へ安全通知。
//   2. 【リスタートボタン権限制御】
//      ホスト/ソロのみ表示、ゲスト端末は強制非表示。
//   3. 【タイマー＆スコアポップ演出】
//      残り30秒クリティカル点滅、高速架橋時のポップクランプ制御。

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

export function resetHUDTimers() {
  if (scorePopTimer) {
    clearTimeout(scorePopTimer);
    scorePopTimer = null;
  }
  lastPlankPlacedTime = 0;
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