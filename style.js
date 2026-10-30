// ==============================================================================
// 『くねくねバトル オンライン』iOS WebKit & iPhone 干渉完全マスクスタイル (style.js)
// Step 5-C 改訂:
// ・マルチプレイロビー画面 (.lobby-card, .btn-lobby-hero, .room-list-box 等)
// ・マッチング待機室 (.waiting-card, .waiting-members-list 等)
// ・リザルト画面、HUD、ボトムシートメニューの完全統合
// ==============================================================================

export function injectStyles() {
    if (document.getElementById('kunekune-style')) return;

    const styleEl = document.createElement('style');
    styleEl.id = 'kunekune-style';
    styleEl.textContent = `
        *, *::before, *::after {
            box-sizing: border-box;
            user-select: none;
            -webkit-user-select: none;
            -webkit-touch-callout: none;
            -webkit-tap-highlight-color: transparent;
        }

        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background-color: #0b051a;
            overflow: hidden;
            position: fixed;
            font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Hiragino Kaku Gothic ProN', sans-serif;
        }

        #game-canvas {
            display: block;
            width: 100%;
            height: 100%;
            touch-action: none;
        }

        #ui-layer {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10;
        }

        :root {
            --safe-top: 104px;
            --safe-side: 16px;
            --safe-bottom: 24px;
        }

        /* --- 上部HUD --- */
        #hud {
            position: absolute;
            top: var(--safe-top);
            left: var(--safe-side);
            right: var(--safe-side);
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            pointer-events: none;
            transition: top 0.2s ease;
        }

        .hud-group {
            display: flex;
            align-items: center;
            gap: 8px;
            pointer-events: auto;
        }

        .hud-btn {
            background: rgba(15, 23, 42, 0.75);
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 8px;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            cursor: pointer;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            transition: background 0.2s, transform 0.1s;
        }
        .hud-btn:active {
            transform: scale(0.94);
            background: rgba(30, 41, 59, 0.9);
        }

        .stats-box {
            position: absolute;
            top: 40px;
            left: 0;
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(0, 229, 255, 0.4);
            border-radius: 10px;
            padding: 10px 14px;
            color: white;
            font-size: 12px;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
            min-width: 160px;
        }
        .stats-box hr {
            border: none;
            border-top: 1px dashed rgba(255, 255, 255, 0.25);
            margin: 8px 0;
        }
        #leaderboard-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        /* --- 操作ボタンレイアウト --- */
        #btn-boost {
            position: absolute;
            bottom: calc(var(--safe-bottom) + 144px);
            right: 20px;
            width: 66px;
            height: 66px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(15, 23, 42, 0.92) 0%, rgba(2, 6, 23, 0.96) 100%);
            border: 2px solid #00e5ff;
            color: #00e5ff;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            box-shadow: 0 0 16px rgba(0, 229, 255, 0.35), inset 0 0 10px rgba(0, 229, 255, 0.2);
            transition: transform 0.1s, border-color 0.2s, box-shadow 0.2s;
            cursor: pointer;
            z-index: 50;
        }
        #btn-boost svg {
            width: 28px;
            height: 28px;
            stroke: #00e5ff;
            filter: drop-shadow(0 0 4px #00e5ff);
            transition: transform 0.1s;
        }
        #btn-boost.active {
            transform: scale(0.92);
            border-color: #ff0055;
            box-shadow: 0 0 25px rgba(255, 0, 85, 0.8), inset 0 0 15px rgba(255, 0, 85, 0.4);
        }
        #btn-boost.active svg {
            stroke: #ff0055;
            filter: drop-shadow(0 0 6px #ff0055);
            transform: scale(1.15);
        }

        #btn-menu {
            position: absolute;
            bottom: calc(var(--safe-bottom) + 62px);
            right: 16px;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, #00b4d8, #0077b6);
            border: 1.5px solid rgba(255, 255, 255, 0.8);
            color: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-size: 9px;
            font-weight: 900;
            pointer-events: auto;
            box-shadow: 0 4px 14px rgba(0, 119, 182, 0.5);
            cursor: pointer;
            z-index: 50;
        }
        #btn-menu svg {
            width: 18px;
            height: 18px;
            fill: white;
            margin-bottom: 1px;
        }
        #btn-menu:active {
            transform: scale(0.92);
        }

        #btn-sound {
            position: absolute;
            bottom: var(--safe-bottom);
            left: 16px;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: rgba(15, 23, 42, 0.85);
            border: 1.5px solid rgba(255, 255, 255, 0.3);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            cursor: pointer;
            z-index: 50;
        }
        #btn-sound svg {
            width: 20px;
            height: 20px;
            fill: #94a3b8;
        }
        #btn-sound.sound-on svg {
            fill: #00e5ff;
            filter: drop-shadow(0 0 5px rgba(0, 229, 255, 0.6));
        }

        #joystick-base {
            display: none;
            position: absolute;
            width: 90px;
            height: 90px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            border: 2px solid rgba(255, 255, 255, 0.3);
            pointer-events: none;
            transform: translate(-50%, -50%);
            z-index: 40;
        }
        #joystick-knob {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: rgba(0, 229, 255, 0.8);
            box-shadow: 0 0 10px rgba(0, 229, 255, 0.6);
            transform: translate(-50%, -50%);
            pointer-events: none;
        }

        /* --- 弾幕チャット --- */
        #danmaku-container {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            overflow: hidden;
            z-index: 100;
        }
        .danmaku-item {
            position: absolute;
            right: -100%;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            font-weight: 700;
            color: #ffffff;
            text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.9);
            animation: danmaku-fly 4.5s linear forwards;
            pointer-events: none;
        }
        .danmaku-badge {
            font-size: 10px;
            font-weight: 800;
            padding: 2px 7px;
            border-radius: 10px;
            color: #0b051a;
        }
        .danmaku-system {
            color: #ffdd00;
        }
        @keyframes danmaku-fly {
            0% { transform: translateX(0); left: 100%; }
            100% { transform: translateX(-200%); left: -50%; }
        }

        /* --- いいね誘導吹き出し --- */
        #like-bubble {
            display: none;
            position: absolute;
            top: 54px;
            right: 12px;
            background: #0088cc;
            color: #ffffff;
            font-size: 13px;
            font-weight: 700;
            padding: 8px 14px;
            border-radius: 12px;
            box-shadow: 0 4px 16px rgba(0, 136, 204, 0.5);
            pointer-events: none;
            z-index: 200;
            white-space: nowrap;
        }
        #like-bubble::after {
            content: '';
            position: absolute;
            top: -7px;
            right: 16px;
            width: 0;
            height: 0;
            border-left: 7px solid transparent;
            border-right: 7px solid transparent;
            border-bottom: 7px solid #0088cc;
        }
        #like-bubble.show {
            display: block;
            animation: bubble-pop 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes bubble-pop {
            0% { transform: scale(0.6); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
        }

        /* --- ボトムシートメニュー --- */
        #menu-overlay {
            display: none;
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(3px);
            -webkit-backdrop-filter: blur(3px);
            z-index: 150;
            pointer-events: auto;
        }
        #bottom-sheet {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            max-height: 72vh;
            background: linear-gradient(180deg, #0284c7 0%, #0369a1 100%);
            border-top-left-radius: 20px;
            border-top-right-radius: 20px;
            box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.6);
            transform: translateY(100%);
            transition: transform 0.28s cubic-bezier(0.2, 0.9, 0.3, 1);
            display: flex;
            flex-direction: column;
            padding: 12px 16px calc(var(--safe-bottom) + 12px);
            z-index: 160;
        }
        #bottom-sheet.open {
            transform: translateY(0);
        }

        .sheet-drag-handle {
            width: 38px;
            height: 4px;
            background: rgba(255, 255, 255, 0.4);
            border-radius: 2px;
            margin: 0 auto 10px;
        }
        .sheet-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .sheet-title {
            color: #ffffff;
            font-size: 16px;
            font-weight: 800;
            letter-spacing: 0.5px;
        }
        .sheet-close-btn {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.2);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: 800;
            cursor: pointer;
        }

        .sheet-tabs {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6px;
            background: rgba(0, 0, 0, 0.2);
            padding: 4px;
            border-radius: 10px;
            margin-bottom: 14px;
        }
        .sheet-tab-btn {
            background: transparent;
            border: none;
            color: rgba(255, 255, 255, 0.7);
            font-size: 12px;
            font-weight: 700;
            padding: 8px 0;
            border-radius: 8px;
            cursor: pointer;
            text-align: center;
            transition: background 0.15s, color 0.15s;
        }
        .sheet-tab-btn.active {
            background: #0284c7;
            color: #ffffff;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        }

        .chat-chips-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 14px;
        }
        .chat-chip {
            background: rgba(255, 255, 255, 0.12);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 10px;
            color: #ffffff;
            font-size: 13px;
            font-weight: 700;
            text-align: center;
            cursor: pointer;
            transition: background 0.15s, transform 0.08s;
        }
        .chat-chip:active {
            background: rgba(255, 255, 255, 0.25);
            transform: scale(0.96);
        }

        .chat-input-bar {
            display: flex;
            gap: 8px;
        }
        .chat-input-box {
            flex: 1;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 10px 12px;
            color: #ffffff;
            font-size: 13px;
            outline: none;
        }
        .chat-send-btn {
            background: #0ea5e9;
            color: #ffffff;
            border: none;
            border-radius: 8px;
            padding: 0 16px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
        }

        .participants-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 40vh;
            overflow-y: auto;
        }
        .participant-row {
            display: flex;
            align-items: center;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 8px 12px;
            cursor: pointer;
        }
        .participant-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            font-weight: 800;
            font-size: 14px;
            margin-right: 10px;
        }
        .participant-info {
            flex: 1;
            text-align: left;
        }
        .participant-name {
            color: #ffffff;
            font-size: 14px;
            font-weight: 700;
        }
        .participant-status {
            color: #34d399;
            font-size: 11px;
            margin-top: 2px;
        }
        .participant-arrow {
            color: rgba(255, 255, 255, 0.6);
            font-size: 16px;
        }

        .custom-panel {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .custom-label {
            color: #ffffff;
            font-size: 12px;
            font-weight: 700;
            text-align: left;
        }
        .custom-row {
            display: flex;
            justify-content: space-around;
            gap: 8px;
        }
        .custom-face-btn {
            flex: 1;
            background: rgba(0, 0, 0, 0.25);
            border: 2px solid transparent;
            border-radius: 8px;
            padding: 8px 4px;
            color: #ffffff;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
        }
        .custom-face-btn.selected {
            border-color: #ffffff;
            background: rgba(255, 255, 255, 0.25);
        }
        .custom-color-btn {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 2px solid transparent;
            cursor: pointer;
        }
        .custom-color-btn.selected {
            border-color: #ffffff;
            transform: scale(1.15);
            box-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
        }

        .creator-notice-card {
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 12px;
            color: #ffffff;
            font-size: 12px;
            line-height: 1.6;
            text-align: left;
            margin-bottom: 12px;
        }
        .creator-link-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            padding: 12px;
            margin-bottom: 8px;
            color: #ffffff;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
        }
        .creator-link-row:active {
            background: rgba(255, 255, 255, 0.2);
        }

        /* --- リザルト画面 --- */
        #over-screen {
            display: none;
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(11, 5, 26, 0.85);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            z-index: 300;
            padding: 20px;
        }
        .result-panel {
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            border: 2px solid #38bdf8;
            border-radius: 16px;
            padding: 20px 24px;
            width: 100%;
            max-width: 360px;
            color: #ffffff;
            text-align: center;
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.8), 0 0 20px rgba(56, 189, 248, 0.3);
            animation: panel-appear 0.25s ease-out;
        }
        @keyframes panel-appear {
            0% { transform: scale(0.85); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
        }
        .result-title {
            color: #ff3366;
            font-size: 22px;
            font-weight: 900;
            letter-spacing: 1.5px;
            margin: 0 0 16px;
            text-shadow: 0 0 10px rgba(255, 51, 102, 0.6);
        }
        .result-stats-table {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 20px;
        }
        .result-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 14px;
            border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
            padding-bottom: 4px;
        }
        .result-row-label {
            color: #94a3b8;
        }
        .result-row-val {
            font-weight: 800;
            font-size: 16px;
            color: #38bdf8;
        }
        .result-actions {
            display: flex;
            gap: 10px;
        }
        .result-btn {
            flex: 1;
            padding: 12px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 800;
            border: none;
            cursor: pointer;
            transition: transform 0.1s, opacity 0.15s;
        }
        .result-btn:active {
            transform: scale(0.96);
        }
        .btn-retry {
            background: linear-gradient(135deg, #0284c7, #0369a1);
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
        }
        .btn-submit-score {
            background: linear-gradient(135deg, #e11d48, #be123c);
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(225, 29, 72, 0.4);
        }

        /* ==========================================================================
           マルチプレイロビー画面 (#lobby-overlay)
           ========================================================================== */
        #lobby-overlay {
            position: absolute;
            inset: 0;
            z-index: 250;
            display: flex;
            flex-direction: column;
            align-items: center;
            background: radial-gradient(circle at 50% 15%, rgba(14, 165, 233, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%);
            color: #ffffff;
            padding: 16px 20px;
            padding-top: max(104px, env(safe-area-inset-top, 44px) + 56px);
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            pointer-events: auto;
        }
        .lobby-card {
            width: 100%;
            max-width: 380px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
        }
        .lobby-title {
            font-size: 28px;
            font-weight: 900;
            letter-spacing: 0.05em;
            color: #ffffff;
            text-shadow: 0 3px 12px rgba(2, 132, 199, 0.8), 0 2px 4px rgba(0, 0, 0, 0.5);
            margin-bottom: 2px;
        }
        .lobby-subtitle {
            font-size: 14px;
            color: #bae6fd;
            margin-bottom: 6px;
        }
        .btn-lobby-hero {
            width: 100%;
            padding: 16px 24px;
            background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%);
            color: #ffffff;
            font-size: 18px;
            font-weight: 900;
            border: 2px solid rgba(255, 255, 255, 0.5);
            border-radius: 16px;
            cursor: pointer;
            box-shadow: 0 8px 22px rgba(2, 132, 199, 0.45);
            transition: transform 0.1s ease;
        }
        .btn-lobby-hero:active {
            transform: scale(0.96);
        }
        .lobby-btn-row {
            display: flex;
            gap: 10px;
            width: 100%;
        }
        .btn-lobby-sub {
            flex: 1;
            padding: 14px 10px;
            font-size: 14px;
            font-weight: 800;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            color: #ffffff;
            cursor: pointer;
            transition: transform 0.1s ease;
        }
        .btn-lobby-sub:active {
            transform: scale(0.96);
        }
        .btn-green {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
        }
        .btn-teal {
            background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
            box-shadow: 0 4px 14px rgba(13, 148, 136, 0.35);
        }
        .room-list-box {
            width: 100%;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.18);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-radius: 14px;
            padding: 14px 16px;
            margin-top: 4px;
        }
        .room-list-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 15px;
            font-weight: 800;
            color: #e0f2fe;
            margin-bottom: 10px;
        }
        .btn-refresh-mini {
            background: rgba(255, 255, 255, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 8px;
            color: #ffffff;
            font-size: 12px;
            font-weight: 700;
            padding: 4px 12px;
            cursor: pointer;
        }
        .room-list-container {
            max-height: 180px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .room-list-empty {
            font-size: 13px;
            color: #bae6fd;
            text-align: center;
            padding: 24px 0;
        }
        .room-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255, 255, 255, 0.12);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            padding: 10px 12px;
        }
        .room-item-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
            text-align: left;
        }
        .room-item-id {
            font-size: 13px;
            font-weight: 800;
            color: #ffffff;
        }
        .room-item-count {
            font-size: 11px;
            color: #7dd3fc;
        }
        .btn-join-room {
            background: #10b981;
            color: #ffffff;
            border: none;
            border-radius: 8px;
            padding: 6px 14px;
            font-size: 12px;
            font-weight: 800;
            cursor: pointer;
        }

        /* ==========================================================================
           マッチング待機室画面 (#waiting-overlay)
           ========================================================================== */
        #waiting-overlay {
            display: none;
            position: absolute;
            inset: 0;
            z-index: 260;
            flex-direction: column;
            align-items: center;
            background: radial-gradient(circle at 50% 20%, rgba(14, 165, 233, 0.96) 0%, rgba(15, 23, 42, 0.98) 100%);
            color: #ffffff;
            padding: 16px 20px;
            padding-top: max(104px, env(safe-area-inset-top, 44px) + 56px);
            overflow-y: auto;
            pointer-events: auto;
        }
        .waiting-card {
            width: 100%;
            max-width: 380px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
        }
        .waiting-room-tag {
            font-size: 13px;
            font-weight: 800;
            color: #38bdf8;
            background: rgba(56, 189, 248, 0.15);
            padding: 4px 14px;
            border-radius: 20px;
            border: 1px solid rgba(56, 189, 248, 0.4);
        }
        .waiting-title {
            font-size: 22px;
            font-weight: 900;
            color: #ffffff;
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        }
        .waiting-divider {
            width: 100%;
            height: 1px;
            background: rgba(255, 255, 255, 0.2);
            margin: 4px 0;
        }
        .waiting-members-list {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 240px;
            overflow-y: auto;
        }
        .waiting-slot {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 10px;
            padding: 8px 12px;
        }
        .waiting-slot-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .waiting-slot-badge {
            width: 22px;
            height: 22px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 900;
            color: #0b051a;
        }
        .waiting-slot-name {
            font-size: 13px;
            font-weight: 700;
            color: #ffffff;
        }
        .waiting-slot-host {
            font-size: 10px;
            font-weight: 800;
            color: #fde047;
            background: rgba(250, 204, 21, 0.2);
            border: 1px solid rgba(250, 204, 21, 0.5);
            padding: 2px 6px;
            border-radius: 6px;
        }
        .btn-waiting-leave {
            width: 100%;
            margin-top: 6px;
            background: rgba(255, 255, 255, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.25);
            color: #ffffff;
            padding: 13px;
            border-radius: 12px;
            font-weight: 800;
            font-size: 14px;
            cursor: pointer;
        }
        .btn-waiting-leave:active {
            transform: scale(0.97);
        }
    `;
    document.head.appendChild(styleEl);
}