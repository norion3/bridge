// ==============================================================================
// 『くねくねバトル オンライン』自律DOMマウントモジュール (dom.js)
// Step 5-C 改訂:
// ・マルチプレイロビー画面 (#lobby-overlay) 配備
// ・公開ルーム一覧 ＆ 更新ボタン ＆ 部屋作成ボタン
// ・マッチング待機室画面 (#waiting-overlay) 配備
// ・リザルト画面、ボトムシートメニュー、HUDの完全統合
// ==============================================================================

export function mountDOM() {
    if (document.getElementById('game-canvas')) return;

    // 1. メインゲームCanvas
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    document.body.appendChild(canvas);

    // 2. 弾幕チャットレイヤー
    const danmakuContainer = document.createElement('div');
    danmakuContainer.id = 'danmaku-container';
    document.body.appendChild(danmakuContainer);

    // 3. UIレイヤーコンテナ
    const uiLayer = document.createElement('div');
    uiLayer.id = 'ui-layer';
    uiLayer.innerHTML = `
        <!-- 上部HUD -->
        <div id="hud">
            <div class="hud-group" style="position: relative;">
                <button id="btn-rank" class="hud-btn">RANKING</button>
                <div id="stats-box" class="stats-box" style="display: none;">
                    <div>順位: <span id="val-rank" style="color:#ffdd00; font-weight:bold;">1</span> / <span id="val-total">50</span></div>
                    <div>スコア: <span id="val-score" style="color:#00e5ff; font-weight:bold;">0</span></div>
                    <hr>
                    <div id="leaderboard-list"></div>
                </div>
            </div>

            <div class="hud-group">
                <button id="btn-map" class="hud-btn">MAP: ON</button>
            </div>
        </div>

        <!-- 右上「…」直下 いいね誘導吹き出し -->
        <div id="like-bubble">メニューから「❤️いいね」してね！</div>

        <!-- 左下：サウンドボタン -->
        <div id="btn-sound">
            <svg id="icon-sound-off" viewBox="0 0 24 24">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
            </svg>
            <svg id="icon-sound-on" viewBox="0 0 24 24" style="display: none;">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
        </div>

        <!-- 右下2連ボタン -->
        <div id="btn-boost">
            <svg viewBox="0 0 24 24">
                <path d="M13 6l6 6-6 6M5 6l6 6-6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
        </div>

        <div id="btn-menu">
            <svg viewBox="0 0 24 24">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
            MENU
        </div>

        <!-- 仮想ジョイスティック -->
        <div id="joystick-base">
            <div id="joystick-knob"></div>
        </div>
    `;
    document.body.appendChild(uiLayer);

    // 4. ボトムシートメニュー ＆ オーバーレイ
    const menuOverlay = document.createElement('div');
    menuOverlay.id = 'menu-overlay';
    menuOverlay.innerHTML = `
        <div id="bottom-sheet">
            <div class="sheet-drag-handle"></div>
            <div class="sheet-header">
                <div class="sheet-title">GAME MENU</div>
                <div id="btn-close-menu" class="sheet-close-btn">✕</div>
            </div>

            <div class="sheet-tabs">
                <button class="sheet-tab-btn active" data-tab="chat">💬 CHAT</button>
                <button class="sheet-tab-btn" data-tab="players">👥 走者 <span id="players-tab-count">(1)</span></button>
                <button class="sheet-tab-btn" data-tab="custom">🎨 CUSTOM</button>
                <button class="sheet-tab-btn" data-tab="creator">+ 製作者</button>
            </div>

            <div id="tab-pane-chat" class="sheet-tab-content">
                <div style="font-size: 11px; color: rgba(255,255,255,0.7); text-align: left; margin-bottom: 8px;">タップで即送信</div>
                <div class="chat-chips-grid">
                    <div class="chat-chip">よろしく！</div>
                    <div class="chat-chip">ナイス！</div>
                    <div class="chat-chip">ありがとう！</div>
                    <div class="chat-chip">ごめんね！</div>
                    <div class="chat-chip">まってー！</div>
                    <div class="chat-chip">おつかれさま！</div>
                    <div class="chat-chip">ドンマイ！</div>
                    <div class="chat-chip">もう1回！</div>
                </div>
                <div class="chat-input-bar">
                    <input type="text" id="chat-input-text" class="chat-input-box" placeholder="メッセージを入力..." maxlength="15">
                    <button id="btn-send-chat" class="chat-send-btn">送信</button>
                </div>
            </div>

            <div id="tab-pane-players" class="sheet-tab-content" style="display: none;">
                <div id="participants-list" class="participants-list"></div>
            </div>

            <div id="tab-pane-custom" class="sheet-tab-content" style="display: none;">
                <div class="custom-panel">
                    <div class="custom-label">顔タイプ</div>
                    <div class="custom-row">
                        <button class="custom-face-btn selected" data-face="normal">ノーマル</button>
                        <button class="custom-face-btn" data-face="angry">いかり</button>
                        <button class="custom-face-btn" data-face="happy">にこにこ</button>
                        <button class="custom-face-btn" data-face="cool">クール</button>
                        <button class="custom-face-btn" data-face="cute">キュート</button>
                    </div>

                    <div class="custom-label" style="margin-top: 6px;">カラー</div>
                    <div class="custom-row">
                        <div class="custom-color-btn selected" style="background-color: #00e5ff;" data-color="#00e5ff"></div>
                        <div class="custom-color-btn" style="background-color: #ff3366;" data-color="#ff3366"></div>
                        <div class="custom-color-btn" style="background-color: #ccff33;" data-color="#ccff33"></div>
                        <div class="custom-color-btn" style="background-color: #ff9933;" data-color="#ff9933"></div>
                        <div class="custom-color-btn" style="background-color: #cc66ff;" data-color="#cc66ff"></div>
                    </div>
                </div>
            </div>

            <div id="tab-pane-creator" class="sheet-tab-content" style="display: none;">
                <div class="creator-notice-card">
                    遊んでくれてありがとうございます！<br>
                    <strong style="color: #ffdd00;">楽しかったら右上の [...] から いいね を押してね</strong><br>
                    ご意見やご要望もお気軽にどうぞ！
                </div>
                <div id="link-creator-profile" class="creator-link-row">
                    <span>👤 製作者プロフィール</span>
                    <span>↗</span>
                </div>
                <div id="link-dev-news" class="creator-link-row">
                    <span>📢 ゲーム開発・告知</span>
                    <span>↗</span>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(menuOverlay);

    // 5. リザルト画面モーダル (#over-screen)
    const overScreen = document.createElement('div');
    overScreen.id = 'over-screen';
    overScreen.innerHTML = `
        <div class="result-panel">
            <h2 class="result-title">GAME OVER</h2>
            <div class="result-stats-table">
                <div class="result-row">
                    <span class="result-row-label">最終順位</span>
                    <span id="res-rank" class="result-row-val">1 位</span>
                </div>
                <div class="result-row">
                    <span class="result-row-label">スコア</span>
                    <span id="res-score" class="result-row-val">0</span>
                </div>
                <div class="result-row">
                    <span class="result-row-label">撃破数</span>
                    <span id="res-kills" class="result-row-val">0</span>
                </div>
                <div class="result-row">
                    <span class="result-row-label">生存時間</span>
                    <span id="res-time" class="result-row-val">0 秒</span>
                </div>
                <div class="result-row">
                    <span class="result-row-label">最大サイズ</span>
                    <span id="res-size" class="result-row-val">0</span>
                </div>
            </div>
            <div class="result-actions">
                <button id="btn-retry" class="result-btn btn-retry">リトライ</button>
                <button id="btn-submit-score" class="result-btn btn-submit-score">得点送信</button>
            </div>
        </div>
    `;
    document.body.appendChild(overScreen);

    // 6. マルチプレイロビー画面 (#lobby-overlay)
    const lobbyOverlay = document.createElement('div');
    lobbyOverlay.id = 'lobby-overlay';
    lobbyOverlay.innerHTML = `
        <div class="lobby-card">
            <div class="lobby-title">くねくねバトル</div>
            <div id="lobby-greeting" class="lobby-subtitle">ようこそ プレイヤー さん</div>

            <!-- メインボタン：ソロプレイ開始 -->
            <button id="btn-lobby-solo" type="button" class="btn-lobby-hero">▶ 1人で遊ぶ (ソロ)</button>

            <!-- サブボタン：マルチプレイ部屋作成 -->
            <div class="lobby-btn-row">
                <button id="btn-lobby-public" type="button" class="btn-lobby-sub btn-green">公開ルーム作成</button>
                <button id="btn-lobby-private" type="button" class="btn-lobby-sub btn-teal">プライベート作成</button>
            </div>

            <!-- 公開ルーム一覧ボックス -->
            <div class="room-list-box">
                <div class="room-list-header">
                    <span>公開ルーム一覧</span>
                    <button id="btn-refresh-rooms" type="button" class="btn-refresh-mini">更新</button>
                </div>
                <div id="room-list-container" class="room-list-container">
                    <div class="room-list-empty">公開ルームはありません</div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(lobbyOverlay);

    // 7. マッチング待機室画面 (#waiting-overlay)
    const waitingOverlay = document.createElement('div');
    waitingOverlay.id = 'waiting-overlay';
    waitingOverlay.innerHTML = `
        <div class="waiting-card">
            <div id="waiting-room-tag" class="waiting-room-tag">ROOM #-----</div>
            <div class="waiting-title">マッチング待機中</div>
            <div class="waiting-divider"></div>
            <div id="waiting-members-list" class="waiting-members-list"></div>
            <button id="btn-waiting-start" type="button" class="btn-lobby-hero" style="display: none;">ゲーム開始</button>
            <button id="btn-waiting-leave" type="button" class="btn-waiting-leave">ロビーへ戻る</button>
        </div>
    `;
    document.body.appendChild(waitingOverlay);

    // 8. ローダーのスピナーをフェード消去
    const loaderShield = document.getElementById('loader-shield');
    if (loaderShield) {
        loaderShield.style.transition = 'opacity 0.25s ease';
        loaderShield.style.opacity = '0';
        setTimeout(() => {
            if (loaderShield.parentNode) loaderShield.parentNode.removeChild(loaderShield);
        }, 250);
    }
}