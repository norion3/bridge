// menu_styles.js: ゲームメニュー・ボトムシート・いいね誘導・ボタン専用 CSS スタイル定義モジュール
// ★ menu.js から分離された純粋スタイルシートインジェクション

/**
 * メニュースタイルの動的注入
 */
export function injectMenuStyles() {
  if (document.getElementById('gravity-game-menu-styles')) return;

  const style = document.createElement('style');
  style.id = 'gravity-game-menu-styles';
  style.textContent = `
    /* ★ 右下サイド MENUボタン（スワイプエリア完全解放・英語カプセル） */
    #btn-open-game-menu {
      position: fixed;
      right: 16px;
      bottom: max(68px, env(safe-area-inset-bottom, 16px) + 52px);
      z-index: 45;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.92) 0%, rgba(2, 132, 199, 0.98) 100%);
      color: #ffffff;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.04em;
      border: 1.5px solid rgba(255, 255, 255, 0.45);
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.45), 0 0 10px rgba(56, 189, 248, 0.35);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      cursor: pointer;
      transition: transform 0.12s ease, filter 0.12s ease;
      touch-action: manipulation;
    }
    #btn-open-game-menu:active {
      transform: scale(0.92);
      filter: brightness(0.9);
    }
    #btn-open-game-menu .menu-icon-mini {
      font-size: 13px;
      line-height: 1;
    }
    #btn-open-game-menu .menu-text-mini {
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.02em;
      line-height: 1;
    }

    /* ボトムシート オーバーレイ（背景暗転） */
    #game-menu-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.60);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 80;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
    }
    #game-menu-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    /* ボトムシート メインパネル */
    #game-menu-sheet {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      max-width: 460px;
      margin: 0 auto;
      height: 72vh;
      max-height: 540px;
      background: radial-gradient(circle at 50% 0%, rgba(14, 165, 233, 0.96) 0%, rgba(15, 23, 42, 0.98) 100%);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-bottom: none;
      border-radius: 22px 22px 0 0;
      box-shadow: 0 -10px 35px rgba(0, 0, 0, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.4);
      z-index: 85;
      transform: translateY(105%);
      transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", sans-serif;
    }
    #game-menu-sheet.open {
      transform: translateY(0%);
    }

    /* パネル上部グラブバー＆ヘッダー */
    .menu-sheet-grabber {
      width: 36px;
      height: 4px;
      background: rgba(255, 255, 255, 0.35);
      border-radius: 2px;
      margin: 8px auto 2px auto;
      flex-shrink: 0;
    }
    .menu-sheet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 16px 8px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      flex-shrink: 0;
    }
    .menu-sheet-title {
      font-size: 15px;
      font-weight: 900;
      letter-spacing: 0.05em;
      color: #ffffff;
      text-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }
    .menu-sheet-close {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      cursor: pointer;
    }

    /* タブ切り替えバー */
    .menu-tab-bar {
      display: flex;
      background: rgba(0, 0, 0, 0.25);
      padding: 4px;
      margin: 8px 14px;
      border-radius: 12px;
      gap: 4px;
      flex-shrink: 0;
    }
    .menu-tab-btn {
      flex: 1;
      padding: 7px 4px;
      font-size: 12.5px;
      font-weight: 800;
      color: #bae6fd;
      background: transparent;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: center;
    }
    .menu-tab-btn.active {
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      color: #ffffff;
      box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);
    }

    /* ★ タブコンテンツ表示領域（「ルーム招待 ⇧」ボタン被り解消の96px安全余白） */
    .menu-tab-content {
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 8px 16px;
      padding-bottom: max(96px, env(safe-area-inset-bottom, 24px) + 72px);
      display: none;
    }
    .menu-tab-content.active {
      display: flex;
      flex-direction: column;
    }

    /* 1. チャットタブ UI */
    .chat-tab-container {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
      gap: 10px;
    }
    .chat-top-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .chat-section-label {
      font-size: 11px;
      font-weight: 800;
      color: #7dd3fc;
      letter-spacing: 0.03em;
    }
    .quick-chat-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }
    .chat-chip {
      background: rgba(255, 255, 255, 0.10);
      border: 1px solid rgba(255, 255, 255, 0.20);
      color: #e0f2fe;
      padding: 10px 8px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      text-align: center;
      transition: background 0.12s ease, transform 0.1s ease;
    }
    .chat-chip:active {
      background: rgba(56, 189, 248, 0.35);
      transform: scale(0.97);
    }

    /* 親指で押しやすい下部入力バー */
    .chat-input-bottom-bar {
      margin-top: auto;
      display: flex;
      gap: 8px;
      padding-top: 6px;
    }
    .chat-input-field {
      flex: 1;
      height: 42px;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(56, 189, 248, 0.5);
      border-radius: 12px;
      padding: 0 12px;
      color: #ffffff;
      font-size: 13.5px;
      font-weight: 700;
      outline: none;
    }
    .chat-input-field:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
    }
    .chat-send-btn {
      width: 68px;
      height: 42px;
      background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%);
      color: #ffffff;
      font-size: 13px;
      font-weight: 900;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 3px 10px rgba(2, 132, 199, 0.4);
      flex-shrink: 0;
    }
    .chat-send-btn:active {
      transform: scale(0.95);
    }

    /* 2. 製作者タブ UI（ボタン特化型スリムUI・崩れリスクゼロ） */
    .creator-section-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-top: 4px;
    }
    .creator-message-card {
      background: rgba(15, 23, 42, 0.60);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 14px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .creator-message-line {
      font-size: 12.5px;
      line-height: 1.45;
      color: #e0f2fe;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .creator-message-line.highlight {
      color: #fde047;
      font-weight: 800;
    }

    /* 本垢・サブ垢の2大アクションボタン */
    .creator-action-btn-card {
      width: 100%;
      border-radius: 14px;
      padding: 12px 14px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 3px;
      transition: transform 0.12s ease, filter 0.12s ease;
      touch-action: manipulation;
      text-align: left;
    }
    .creator-action-btn-card:active {
      transform: scale(0.98);
      filter: brightness(0.92);
    }
    .creator-action-btn-card.card-main {
      background: linear-gradient(135deg, rgba(2, 132, 199, 0.85) 0%, rgba(3, 105, 161, 0.95) 100%);
      border: 1.5px solid #38bdf8;
      box-shadow: 0 4px 16px rgba(2, 132, 199, 0.4), 0 0 10px rgba(56, 189, 248, 0.25);
    }
    .creator-action-btn-card.card-sub {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.85) 0%, rgba(5, 150, 105, 0.95) 100%);
      border: 1.5px solid #34d399;
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.35), 0 0 10px rgba(52, 211, 153, 0.25);
    }
    .creator-btn-title {
      font-size: 14px;
      font-weight: 900;
      color: #ffffff;
      letter-spacing: 0.02em;
    }
    .creator-btn-subtitle {
      font-size: 11.5px;
      color: #e0f2fe;
      font-weight: 600;
    }

    /* 3. 参加者一覧タブ UI */
    .participants-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-right: 4px;
    }
    .participant-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255, 255, 255, 0.10);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      padding: 8px 12px;
      gap: 10px;
      cursor: pointer;
      transition: background 0.12s ease;
    }
    .participant-row:active {
      background: rgba(255, 255, 255, 0.20);
    }
    .participant-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }
    .participant-avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: #0284c7;
      border: 2px solid rgba(255, 255, 255, 0.5);
      object-fit: cover;
      flex-shrink: 0;
    }
    .participant-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .participant-name {
      font-size: 13px;
      font-weight: 800;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .participant-status {
      font-size: 11px;
      color: #94a3b8;
    }
    .status-active {
      color: #34d399 !important;
      font-weight: 700;
    }
    .participant-jump-icon {
      font-size: 15px;
      color: #38bdf8;
      flex-shrink: 0;
    }

    /* =========================================================
       ★ 右上「いいね誘導」ネオンシアン吹き出し（位置・余白・左詰め最適化版）
       ========================================================= */
    #like-guide-anchor {
      position: fixed;
      top: max(56px, env(safe-area-inset-top, 24px) + 48px);
      right: 12px;
      z-index: 95;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      pointer-events: none;
      opacity: 0;
      transform: translateY(-6px);
      transition: opacity 0.22s ease, transform 0.22s ease;
    }
    #like-guide-anchor.show {
      opacity: 1;
      transform: translateY(0);
    }

    /* 三角矢印（上部GRAVITYボタンの中心線：右端から約33pxにピタリと合わせる） */
    .like-guide-arrow {
      width: 0;
      height: 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-bottom: 9px solid #38bdf8;
      margin-right: 14px;
      margin-bottom: 3px;
      animation: likeArrowPulse 0.8s ease-in-out infinite alternate;
    }

    /* 吹き出し本体（自然な左詰め＆高視認性） */
    .like-guide-bubble {
      background: linear-gradient(135deg, rgba(2, 132, 199, 0.95) 0%, rgba(3, 105, 161, 0.98) 100%);
      border: 1.5px solid #38bdf8;
      border-radius: 14px;
      padding: 8px 14px;
      color: #ffffff;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.02em;
      box-shadow: 0 4px 18px rgba(2, 132, 199, 0.5), 0 0 10px rgba(56, 189, 248, 0.4);
      text-align: left;
      line-height: 1.45;
      white-space: nowrap;
    }

    @keyframes likeArrowPulse {
      0% { transform: translateY(0); }
      100% { transform: translateY(-4px); }
    }
  `;
  document.head.appendChild(style);
}