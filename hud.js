/**
 * ==============================================================================
 * 『くねくねバトル オンライン』一体型HUD ＆ Canvas直接描画ミニマップ (hud.js)
 * 別DOM Canvasを全廃し、メインCanvas右上に直接レーダーを描画してGPU負荷を低減
 * ==============================================================================
 */

export class HUDManager {
    constructor() {
        this.showMap = true;
        this.showRanking = false;
        this.radarSize = 75; // ミニマップサイズ (px)
        this.radarMargin = 16;
    }

    init() {
        const btnRank = document.getElementById('btn-rank');
        const statsBox = document.getElementById('stats-box');
        if (btnRank && statsBox) {
            btnRank.onclick = (e) => {
                e.stopPropagation();
                this.showRanking = !this.showRanking;
                statsBox.style.display = this.showRanking ? 'block' : 'none';
            };
        }

        const btnMap = document.getElementById('btn-map');
        if (btnMap) {
            btnMap.onclick = (e) => {
                e.stopPropagation();
                this.showMap = !this.showMap;
                btnMap.innerText = this.showMap ? 'MAP: ON' : 'MAP: OFF';
            };
        }
    }

    // スコアと順位のDOM更新
    updateStats(rank, total, score) {
        const valRank = document.getElementById('val-rank');
        const valTotal = document.getElementById('val-total');
        const valScore = document.getElementById('val-score');
        if (valRank) valRank.innerText = rank;
        if (valTotal) valTotal.innerText = total;
        if (valScore) valScore.innerText = Math.floor(score);
    }

    // メインCanvas右上にミニマップ（レーダー）を直接描画
    drawRadar(ctx, canvasWidth, safeTop, player, otherEntities, mapSize) {
        if (!this.showMap || !player) return;

        const rx = canvasWidth - this.radarSize - this.radarMargin;
        const ry = safeTop;

        // レーダー背景パネル
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.fillRect(rx, ry, this.radarSize, this.radarSize);

        // レーダー外枠
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, this.radarSize, this.radarSize);

        // スケール比率（マップ全体に対する縮尺）
        const scale = this.radarSize / mapSize;

        // 他のスネーク・AIの描画
        if (otherEntities && otherEntities.length > 0) {
            for (let s of otherEntities) {
                if (s.isDead) continue;
                const dotX = rx + s.x * scale;
                const dotY = ry + s.y * scale;

                ctx.fillStyle = s.score > player.score ? '#ff3366' : '#33ccff';
                ctx.beginPath();
                ctx.arc(dotX, dotY, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 自機の位置（白く目立つドット）
        const myX = rx + player.x * scale;
        const myY = ry + player.y * scale;

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(myX, myY, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // 自機の周囲に微弱な光彩
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(myX, myY, 4, 0, Math.PI * 2);
        ctx.stroke();
    }
}