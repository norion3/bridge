// ==============================================================================
// 『くねくねバトル オンライン』49体自律AIマネージャー (ai.js)
// ・タイムスライス分散思考による常時60FPS保証
// ・外壁回避・餌捕食・上位プレデター追撃・胴体激突回避
// ==============================================================================

import { MAP_SIZE, SNAKE_COLORS } from './constants.js';
import { Snake } from './snake.js';

export class AIManager {
    constructor() {
        this.ais = [];
        this.sliceIndex = 0;
        this.faces = ['normal', 'angry', 'happy', 'cool', 'cute'];
    }

    init(count, playerX, playerY) {
        this.ais = [];
        for (let i = 1; i <= count; i++) {
            const color = SNAKE_COLORS[i % SNAKE_COLORS.length];
            const face = this.faces[i % this.faces.length];
            const ai = new Snake(false, i, `CPU ${i}`, color, face);

            // プレイヤー周囲に均等散布
            const angle = (i / count) * Math.PI * 2;
            const dist = 1200 + Math.random() * 4500;
            const sx = Math.max(200, Math.min(MAP_SIZE - 200, playerX + Math.cos(angle) * dist));
            const sy = Math.max(200, Math.min(MAP_SIZE - 200, playerY + Math.sin(angle) * dist));
            ai.reset(sx, sy);

            // 初期スコアの多様化
            if (Math.random() < 0.2) {
                ai.addScore(Math.floor(Math.random() * 800));
            }
            this.ais.push(ai);
        }
    }

    // タイムスライス更新：毎フレーム1/4ずつ思考ルーチンを回してCPU負荷を平準化
    update(player, allSnakes, frameCount) {
        const total = this.ais.length;
        const batchSize = Math.ceil(total / 4);
        const startIndex = (this.sliceIndex * batchSize) % total;
        this.sliceIndex = (this.sliceIndex + 1) % 4;

        for (let i = 0; i < total; i++) {
            const ai = this.ais[i];
            if (ai.isDead) {
                // リスポーン（プレイヤーから一定距離離れた位置）
                if (frameCount % 60 === 0) {
                    const ang = Math.random() * Math.PI * 2;
                    const d = 2500 + Math.random() * 4000;
                    const rx = Math.max(200, Math.min(MAP_SIZE - 200, player.x + Math.cos(ang) * d));
                    const ry = Math.max(200, Math.min(MAP_SIZE - 200, player.y + Math.sin(ang) * d));
                    ai.reset(rx, ry);
                }
                continue;
            }

            // 思考ルーチンはタイムスライス該当AIのみ更新
            const shouldThink = (i >= startIndex && i < startIndex + batchSize);
            if (shouldThink) {
                this.think(ai, player, allSnakes);
            }

            // 物理移動は全AI毎フレーム実行
            ai.updatePhysics(null, ai.isBoosting);
        }
    }

    think(ai, player, allSnakes) {
        ai.aiChangeTimer--;

        // 1. 外壁危険検知（最優先）
        const wallMargin = 300 + ai.size * 2;
        if (ai.x < wallMargin || ai.x > MAP_SIZE - wallMargin || ai.y < wallMargin || ai.y > MAP_SIZE - wallMargin) {
            ai.targetAngle = Math.atan2(MAP_SIZE / 2 - ai.y, MAP_SIZE / 2 - ai.x);
            ai.isBoosting = false;
            return;
        }

        // 2. 近隣の脅威（胴体）激突回避
        let threatFound = false;
        for (let other of allSnakes) {
            if (other === ai || other.isDead || !other.isVisible) continue;

            const dx = other.x - ai.x;
            const dy = other.y - ai.y;
            const distHead = Math.hypot(dx, dy);

            // 近距離のスネーク
            if (distHead < 800) {
                for (let j = 0; j < other.history.length; j += 4) {
                    const seg = other.history[j];
                    const sdx = seg.x - ai.x;
                    const sdy = seg.y - ai.y;
                    const sDist = Math.hypot(sdx, sdy);

                    if (sDist < ai.size * 3.5 + other.size * 1.5) {
                        const angleToBody = Math.atan2(sdy, sdx);
                        let diff = angleToBody - ai.angle;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        while (diff > Math.PI) diff -= Math.PI * 2;

                        if (Math.abs(diff) < Math.PI / 2.2) {
                            ai.targetAngle = ai.angle + (diff > 0 ? -Math.PI / 1.8 : Math.PI / 1.8);
                            ai.isBoosting = ai.score > 120 && Math.random() < 0.3;
                            threatFound = true;
                            break;
                        }
                    }
                }
            }
            if (threatFound) break;
        }

        if (threatFound) return;

        // 3. 自律行動（捕食 / 攻撃 / 巡回）
        if (ai.aiChangeTimer <= 0) {
            ai.aiChangeTimer = 25 + Math.floor(Math.random() * 35);

            // レベル2以上のAIは獲物（プレイヤーや格下AI）を追う
            if (ai.aiLevel >= 2 && Math.hypot(player.x - ai.x, player.y - ai.y) < 1600 && ai.score > player.score * 1.1) {
                // プレイヤーの進行方向を先読みして包囲
                const leadDist = 120;
                const tx = player.x + Math.cos(player.angle) * leadDist;
                const ty = player.y + Math.sin(player.angle) * leadDist;
                ai.targetAngle = Math.atan2(ty - ai.y, tx - ai.x);
                ai.isBoosting = ai.score > 150 && Math.random() < 0.4;
            } else {
                // ランダム放浪・緩やかな旋回
                ai.targetAngle += (Math.random() - 0.5) * 0.9;
                ai.isBoosting = false;
            }
        }
    }
}