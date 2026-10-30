/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ボトムシートメニュー ＆ ルーター (menu.js)
 * ・CHAT: 8大定型文チップ ＋ 自由入力バー
 * ・走者 (N): 参加者一覧 ＋ GravityRouterによるプロフィール起動
 * ・CUSTOM: インゲーム顔5種・色5種リアルタイム着せ替え
 * ・+ 製作者: 実機完全準拠 2大告知パネル ＆ 右上いいね誘導吹き出し連動
 * ==============================================================================
 */

import { CREATOR_MAIN_INTERNAL_UID, CREATOR_SUB_INTERNAL_UID, SNAKE_COLORS } from './constants.js';
import { Danmaku } from './danmaku.js';

// GRAVITYネイティブ画面安全起動ルーター（Universal Links誤爆・404クラッシュ防止）
export const GravityRouter = {
    openProfile(internalUid) {
        if (!internalUid || internalUid === 'local_user') return;
        const cleanId = String(internalUid).replace(/[^0-9]/g, '');
        if (!cleanId) return;

        const paramObj = {
            uid: Number(cleanId),
            selectedIndex: 0,
            web_url: 'https://www.gravity.place/user/' + cleanId,
            s: 'web',
            b: 'user'
        };
        const innerUrl = 'usercenter?0=' + encodeURIComponent(JSON.stringify(paramObj));
        const deepLink = 'slme://internal?type=5&ani=1&url=' + encodeURIComponent(innerUrl);

        // 非表示iframeキック方式（location.href書き換えクラッシュを回避）
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;display:none;';
        iframe.src = deepLink;
        document.body.appendChild(iframe);
        setTimeout(() => {
            if (document.body.contains(iframe)) document.body.removeChild(iframe);
        }, 1000);
    }
};

export class MenuManager {
    constructor() {
        this.isOpen = false;
        this.currentTab = 'chat'; // 'chat' | 'players' | 'custom' | 'creator'
        this.onCustomChange = null; // (face, color) => void
        this.selectedFace = 'normal';
        this.selectedColor = SNAKE_COLORS[0];
    }

    init(onCustomChange) {
        this.onCustomChange = onCustomChange;

        // メニュー開閉ボタン
        const btnMenu = document.getElementById('btn-menu');
        const btnClose = document.getElementById('btn-close-menu');
        const overlay = document.getElementById('menu-overlay');

        if (btnMenu) btnMenu.onclick = (e) => { e.stopPropagation(); this.open(); };
        if (btnClose) btnClose.onclick = (e) => { e.stopPropagation(); this.close(); };
        if (overlay) overlay.onclick = (e) => {
            if (e.target === overlay) this.close();
        };

        // タブ切り替えボタン
        this.bindTabs();

        // CHAT: 定型文チップ
        this.bindChatChips();

        // CHAT: 自由入力バー
        this.bindChatInput();

        // CUSTOM: 着せ替えピッカー
        this.bindCustomPicker();

        // 製作者タブのプロフィールリンク
        this.bindCreatorLinks();
    }

    open() {
        this.isOpen = true;
        const sheet = document.getElementById('bottom-sheet');
        const overlay = document.getElementById('menu-overlay');
        if (overlay) overlay.style.display = 'block';
        if (sheet) {
            requestAnimationFrame(() => sheet.classList.add('open'));
        }
    }

    close() {
        this.isOpen = false;
        const sheet = document.getElementById('bottom-sheet');
        const overlay = document.getElementById('menu-overlay');
        const likeBubble = document.getElementById('like-bubble');

        if (sheet) sheet.classList.remove('open');
        if (likeBubble) likeBubble.classList.remove('show');

        setTimeout(() => {
            if (!this.isOpen && overlay) overlay.style.display = 'none';
        }, 250);
    }

    switchTab(tabName) {
        this.currentTab = tabName;

        // 全タブボタンとコンテンツの非アクティブ化
        document.querySelectorAll('.sheet-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        document.querySelectorAll('.sheet-tab-content').forEach(content => {
            content.style.display = content.id === `tab-pane-${tabName}` ? 'block' : 'none';
        });

        // 実機完全準拠：「製作者」タブの時のみ、右上の「…」直下に「いいね誘導吹き出し」を表示
        const likeBubble = document.getElementById('like-bubble');
        if (likeBubble) {
            if (tabName === 'creator') {
                likeBubble.classList.add('show');
            } else {
                likeBubble.classList.remove('show');
            }
        }
    }

    bindTabs() {
        const tabs = document.querySelectorAll('.sheet-tab-btn');
        tabs.forEach(tab => {
            tab.onclick = (e) => {
                e.stopPropagation();
                this.switchTab(tab.dataset.tab);
            };
        });
    }

    bindChatChips() {
        const chips = document.querySelectorAll('.chat-chip');
        chips.forEach(chip => {
            chip.onclick = (e) => {
                e.stopPropagation();
                const text = chip.innerText.trim();
                Danmaku.push('あなた', text, this.selectedColor);
                this.close();
            };
        });
    }

    bindChatInput() {
        const inputEl = document.getElementById('chat-input-text');
        const btnSend = document.getElementById('btn-send-chat');

        const sendMsg = () => {
            if (!inputEl) return;
            const text = inputEl.value.trim();
            if (text.length > 0) {
                Danmaku.push('あなた', text.slice(0, 15), this.selectedColor);
                inputEl.value = '';
                inputEl.blur();
                this.close();
            }
        };

        if (btnSend) btnSend.onclick = (e) => { e.stopPropagation(); sendMsg(); };
        if (inputEl) {
            inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    sendMsg();
                }
            };
        }
    }

    bindCustomPicker() {
        // 顔選択
        const faceBtns = document.querySelectorAll('.custom-face-btn');
        faceBtns.forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                faceBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.selectedFace = btn.dataset.face;
                if (this.onCustomChange) this.onCustomChange(this.selectedFace, this.selectedColor);
            };
        });

        // カラー選択
        const colorBtns = document.querySelectorAll('.custom-color-btn');
        colorBtns.forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                colorBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.selectedColor = btn.dataset.color;
                if (this.onCustomChange) this.onCustomChange(this.selectedFace, this.selectedColor);
            };
        });
    }

    bindCreatorLinks() {
        const linkCreator = document.getElementById('link-creator-profile');
        const linkDev = document.getElementById('link-dev-news');

        if (linkCreator) {
            linkCreator.onclick = (e) => {
                e.stopPropagation();
                GravityRouter.openProfile(CREATOR_MAIN_INTERNAL_UID);
            };
        }
        if (linkDev) {
            linkDev.onclick = (e) => {
                e.stopPropagation();
                GravityRouter.openProfile(CREATOR_SUB_INTERNAL_UID);
            };
        }
    }

    // 走者一覧の動的描画（マルチ・ソロ対応）
    updateParticipants(playerList) {
        const listContainer = document.getElementById('participants-list');
        const tabCount = document.getElementById('players-tab-count');
        if (!listContainer) return;

        if (tabCount) tabCount.innerText = `(${playerList.length})`;

        listContainer.innerHTML = '';
        playerList.forEach(p => {
            const row = document.createElement('div');
            row.className = 'participant-row';
            row.innerHTML = `
                <div class="participant-avatar" style="background-color: ${p.color};">
                    ${p.name.charAt(0)}
                </div>
                <div class="participant-info">
                    <div class="participant-name">${p.name}</div>
                    <div class="participant-status">● プレイ中</div>
                </div>
                <div class="participant-arrow">↗</div>
            `;
            row.onclick = (e) => {
                e.stopPropagation();
                if (p.internalUid) GravityRouter.openProfile(p.internalUid);
            };
            listContainer.appendChild(row);
        });
    }
}

export const Menu = new MenuManager();