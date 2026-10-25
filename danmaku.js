// danmaku.js: ニコニコ動画風 弾幕テキスト演出・レーン管理モジュール
// ★ 4人プレイ拡張版（緑チーム発言者バッジ対応）：
//   1. 【発言者タグ（緑チーム: .tag-green）スタイル追加】
//      エメラルドグリーン基調（#10b981）のグラデーション＆ボーダーバッジを定義。
//   2. 【spawnDanmaku における teamId === 'green' クラス分岐追加】
//      スロット3（緑Botまたは4人目ゲスト）の発言時に鮮やかな緑バッジを表示。
//   3. 【画面上部〜中上部の複数レーン分散管理】
//      走者の足元や階段の視界を塞がない安全領域（画面上部 16% 〜 40%）を4レーンに分割配置。
//   4. 【自動DOMプール＆ガベージフリー破棄】
//      右端から左端へ約4.8秒かけて横断後、animationend イベントでDOMを確実に安全解放。

/**
 * 弾幕用スタイルの動的注入
 */
function injectDanmakuStyles() {
  if (document.getElementById('gravity-danmaku-styles')) return;

  const style = document.createElement('style');
  style.id = 'gravity-danmaku-styles';
  style.textContent = `
    /* 弾幕コンテナ（全画面固定・タップ透過） */
    #danmaku-container {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 70;
      overflow: hidden;
    }

    /* 弾幕テキスト共通スタイル */
    .danmaku-item {
      position: absolute;
      white-space: nowrap;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", sans-serif;
      font-size: 20px;
      font-weight: 900;
      letter-spacing: 0.04em;
      line-height: 1.2;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      will-change: transform;
      user-select: none;
      -webkit-user-select: none;

      /* 白浮き・空抜け防止の強固な黒縁取り＆ドロップシャドウ */
      text-shadow:
        -2px -2px 0 #000000,
         2px -2px 0 #000000,
        -2px  2px 0 #000000,
         2px  2px 0 #000000,
         0px  3px 8px rgba(0, 0, 0, 0.75);
      -webkit-text-stroke: 0.5px rgba(0, 0, 0, 0.8);
      animation-timing-function: linear;
      animation-fill-mode: forwards;
    }

    /* 発言者タグ（チームカラーバッジ） */
    .danmaku-sender-tag {
      font-size: 11px;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 9999px;
      color: #ffffff;
      text-shadow: none;
      -webkit-text-stroke: 0;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    }
    .tag-blue {
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      border: 1px solid #38bdf8;
    }
    .tag-red {
      background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
      border: 1px solid #f87171;
    }
    .tag-yellow {
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      border: 1px solid #fde047;
    }
    .tag-green {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      border: 1px solid #34d399;
    }
    .tag-neutral {
      background: linear-gradient(135deg, #64748b 0%, #475569 100%);
      border: 1px solid #94a3b8;
    }

    /* 右端から左端へスムーズに横断するキーフレーム */
    @keyframes danmakuFly {
      0% {
        transform: translateX(100vw);
      }
      100% {
        transform: translateX(-100%);
      }
    }
  `;
  document.head.appendChild(style);
}

// 弾幕コンテナDOM参照
let danmakuContainer = null;

// レーン定義（画面高さに対するパーセンテージ）
// レース視野（中央奥の島や手前の走者足元）を遮らない 16% 〜 38% の上空エリア
const LANES_Y_PERCENT = [16, 23, 30, 37];
let lastLaneIndex = -1;

/**
 * 弾幕コンテナの初期化
 */
function ensureContainer() {
  if (danmakuContainer && document.body.contains(danmakuContainer)) return;
  injectDanmakuStyles();
  danmakuContainer = document.getElementById('danmaku-container');
  if (!danmakuContainer) {
    danmakuContainer = document.createElement('div');
    danmakuContainer.id = 'danmaku-container';
    document.body.appendChild(danmakuContainer);
  }
}

/**
 * 重複を避けつつ最適なレーンを選択する
 */
function getNextLane() {
  let lane = Math.floor(Math.random() * LANES_Y_PERCENT.length);
  // 直前と同じレーンへの連続投入を抑制
  if (lane === lastLaneIndex) {
    lane = (lane + 1) % LANES_Y_PERCENT.length;
  }
  lastLaneIndex = lane;
  return LANES_Y_PERCENT[lane];
}

/**
 * ニコニコ風弾幕テキストを画面上に生成して流す
 * @param {string} rawText 送信メッセージ（全角15文字以内推奨）
 * @param {string} senderName 発言者名（例: 'norion', 'ゲスト1'）
 * @param {string} teamId チームID ('blue' | 'red' | 'yellow' | 'green' | 'neutral')
 */
export function spawnDanmaku(rawText, senderName = '', teamId = 'blue') {
  if (!rawText) return;
  ensureContainer();

  // 最大15文字にトリミング
  const safeText = String(rawText).trim().slice(0, 15);
  if (!safeText) return;

  const item = document.createElement('div');
  item.className = 'danmaku-item';

  // チームカラータグのクラス決定（緑チーム対応）
  let tagClass = 'danmaku-sender-tag tag-blue';
  if (teamId === 'red') tagClass = 'danmaku-sender-tag tag-red';
  else if (teamId === 'yellow') tagClass = 'danmaku-sender-tag tag-yellow';
  else if (teamId === 'green') tagClass = 'danmaku-sender-tag tag-green';
  else if (teamId === 'neutral') tagClass = 'danmaku-sender-tag tag-neutral';

  const shortSender = senderName ? String(senderName).slice(0, 6) : '';
  const senderBadgeHtml = shortSender ? `<span class="${tagClass}">${shortSender}</span>` : '';

  item.innerHTML = `
    ${senderBadgeHtml}
    <span>${escapeHtml(safeText)}</span>
  `;

  // レーンのY座標決定（画面上部領域）
  const topPercent = getNextLane();
  item.style.top = `${topPercent}%`;

  // 横断アニメーション（文字長に応じて 4.6秒 〜 5.2秒 で微調整）
  const durationSec = (4.8 + (Math.random() * 0.4)).toFixed(2);
  item.style.animation = `danmakuFly ${durationSec}s linear forwards`;

  // アニメーション完了時に自動破棄（DOMリーク完全防止）
  item.addEventListener('animationend', () => {
    item.remove();
  });

  danmakuContainer.appendChild(item);
}

/**
 * XSS防止サニタイズ
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// グローバル公開（外部・他モジュールからの呼び出し用）
if (typeof window !== 'undefined') {
  window.spawnDanmaku = spawnDanmaku;
}

// DOMロード時の自動初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureContainer);
} else {
  ensureContainer();
}