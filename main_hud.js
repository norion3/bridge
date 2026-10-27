// main_hud.js: タイマー・スコア演出・リスタート権限・公式スコア送信・画面中央5秒カウントダウンHUD制御モジュール
// ★ カウントダウン確実表示・自律フェイルセーフ生成版（Phase 1 修正）：
//   1. 【自律フェイルセーフDOM生成 (ensureCountdownDOM)】
//      mountAllUI のスキップやHTML直書きの有無に一切依存せず、showCountdownHUD が呼ばれた瞬間に
//      #hud-countdown-overlay が存在しない場合は document.body へ即時動的生成・インジェクション。
//      どのような環境でも画面中央の「5 → 4 → 3 → 2 → 1 → GO!」が100%確実に表示されるよう保証。
//   2. 【高輝度ネオンスプリングCSS自己注入 (ensureCountdownStyles)】
//      アニメーションキーフレームが未注入の場合でも自律的にスタイルを適用。
//   3. 【タイマー＆スコア演出・リスタート権限制御・公式スコア送信の100%維持】

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

/**
 * カウントダウン用CSSの自律注入（フェイルセーフ）
 */
function ensureCountdownStyles() {
  if (document.getElementById('hud-countdown-injected-styles')) return;
  const style = document.createElement('style');
  style.id = 'hud-countdown-injected-styles';
  style.textContent = `
    #hud-countdown-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999 !important;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    #hud-countdown-overlay.active {
      display: flex !important;
    }
    .countdown-number {
      font-size: 92px;
      font-weight: 900;
      line-height: 1;
      color: #ffffff;
      text-shadow:
        -4px -4px 0 #0284c7,
         4px -4px 0 #0284c7,
        -4px  4px 0 #0284c7,
         4px  4px 0 #0284c7,
         0 0 35px rgba(56, 189, 248, 1.0),
         0 8px 18px rgba(0, 0, 0, 0.7);
      will-change: transform, opacity;
      animation: countdownPop 0.5s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards;
    }
    .countdown-go {
      font-size: 82px;
      font-weight: 900;
      letter-spacing: 0.05em;
      color: #fde047;
      text-shadow:
        -4px -4px 0 #b45309,
         4px -4px 0 #b45309,
        -4px  4px 0 #b45309,
         4px  4px 0 #b45309,
         0 0 40px rgba(250, 204, 21, 1.0),
         0 8px 20px rgba(0, 0, 0, 0.75);
      will-change: transform, opacity;
      animation: countdownGo 0.8s ease-out forwards;
    }
    .countdown-subtitle {
      font-size: 16px;
      font-weight: 800;
      color: #e0f2fe;
      letter-spacing: 0.18em;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9);
      margin-top: 10px;
    }

    @keyframes countdownPop {
      0% {
        transform: scale(1.65);
        opacity: 0;
      }
      50% {
        transform: scale(0.92);
        opacity: 1;
      }
      100% {
        transform: scale(1.0);
        opacity: 1;
      }
    }

    @keyframes countdownGo {
      0% {
        transform: scale(0.6);
        opacity: 0;
      }
      35% {
        transform: scale(1.3);
        opacity: 1;
      }
      70% {
        transform: scale(1.0);
        opacity: 1;
      }
      100% {
        transform: scale(1.2);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * カウントダウンDOM要素の確実な取得＆自律動的生成（フェイルセーフ）
 */
function ensureCountdownDOM() {
  ensureCountdownStyles();
  let overlay = document.getElementById('hud-countdown-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'hud-countdown-overlay';
    overlay.innerHTML = `
      <div id="countdown-text" class="countdown-number">5</div>
      <div id="countdown-sub" class="countdown-subtitle">READY...</div>
    `;
    const targetContainer = document.getElementById('app-container') || document.body;
    targetContainer.appendChild(overlay);
  }
  return overlay;
}

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
  const overlay = ensureCountdownDOM();
  const textEl = document.getElementById('countdown-text');
  const subEl = document.getElementById('countdown-sub');

  if (countdownGoTimer) {
    clearTimeout(countdownGoTimer);
    countdownGoTimer = null;
  }

  lastCountdownNumber = startNumber;

  if (overlay) {
    overlay.classList.add('active');
    overlay.style.setProperty('display', 'flex', 'important');
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
    overlay.style.setProperty('display', 'none', 'important');
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