/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ニコニコ風弾幕チャットエンジン (danmaku.js)
 * 画面上部（18%〜36%）の視界を塞がない領域に4レーンで横断アニメーション
 * ==============================================================================
 */

export class DanmakuManager {
    constructor() {
        this.container = null;
        this.lanes = [
            { top: '18%', busyUntil: 0 },
            { top: '23%', busyUntil: 0 },
            { top: '28%', busyUntil: 0 },
            { top: '33%', busyUntil: 0 }
        ];
    }

    init() {
        this.container = document.getElementById('danmaku-container');
    }

    // 弾幕メッセージの投入
    push(senderName, text, badgeColor = '#00e5ff', isSystem = false) {
        if (!this.container) return;

        const now = Date.now();
        // 最も早く空くレーンを探索
        let selectedLane = this.lanes[0];
        let minBusy = this.lanes[0].busyUntil;

        for (let i = 1; i < this.lanes.length; i++) {
            if (this.lanes[i].busyUntil < minBusy) {
                minBusy = this.lanes[i].busyUntil;
                selectedLane = this.lanes[i];
            }
        }

        selectedLane.busyUntil = Math.max(now, selectedLane.busyUntil) + 1200; // 同一レーンの最低間隔

        const item = document.createElement('div');
        item.className = 'danmaku-item' + (isSystem ? ' danmaku-system' : '');
        item.style.top = selectedLane.top;

        if (isSystem) {
            item.innerHTML = `<span class="danmaku-sys-text">${this.escapeHTML(text)}</span>`;
        } else {
            item.innerHTML = `
                <span class="danmaku-badge" style="background-color: ${badgeColor};">${this.escapeHTML(senderName)}</span>
                <span class="danmaku-content">${this.escapeHTML(text)}</span>
            `;
        }

        this.container.appendChild(item);

        // 4.6秒後に自動消去
        setTimeout(() => {
            if (item && item.parentNode) {
                item.parentNode.removeChild(item);
            }
        }, 4600);
    }

    escapeHTML(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

export const Danmaku = new DanmakuManager();