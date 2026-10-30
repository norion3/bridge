// ==============================================================================
// 『くねくねバトル オンライン』ワールド・動的チャンク餌・パーティクル (world.js)
// ・環境小餌 ＆ ホットスポット大餌の動的チャンク管理
// ・撃破時ドロップ肉片の散布
// ・視界外チャンクの自動破棄によるメモリリーク完全防止
// ==============================================================================

import { MAP_SIZE, GRID_SIZE, FOOD_COLORS } from './constants.js';

export class WorldManager {
    constructor() {
        this.foodGrid = new Map();
        this.generatedChunks = new Set();
        this.dropFoods = [];
        this.particles = [];
    }

    clear() {
        this.foodGrid.clear();
        this.generatedChunks.clear();
        this.dropFoods = [];
        this.particles = [];
    }

    // プレイヤー視界周辺のチャンクを動的生成
    updateChunks(playerX, playerY, viewRadius) {
        const minGx = Math.max(0, Math.floor((playerX - viewRadius) / GRID_SIZE));
        const maxGx = Math.min(Math.floor(MAP_SIZE / GRID_SIZE), Math.floor((playerX + viewRadius) / GRID_SIZE));
        const minGy = Math.max(0, Math.floor((playerY - viewRadius) / GRID_SIZE));
        const maxGy = Math.min(Math.floor(MAP_SIZE / GRID_SIZE), Math.floor((playerY + viewRadius) / GRID_SIZE));

        for (let gx = minGx; gx <= maxGx; gx++) {
            for (let gy = minGy; gy <= maxGy; gy++) {
                const key = `${gx}_${gy}`;
                if (!this.generatedChunks.has(key)) {
                    this.generatedChunks.add(key);
                    this.spawnChunkFoods(gx, gy);
                }
            }
        }

        // 遠隔チャンクのバッチ破棄（メモリ上限管理）
        if (this.generatedChunks.size > 900) {
            const deleteKeys = [];
            const maxDistSq = (viewRadius * 2.2) ** 2;

            for (let key of this.generatedChunks) {
                const [gxStr, gyStr] = key.split('_');
                const cx = parseInt(gxStr, 10) * GRID_SIZE;
                const cy = parseInt(gyStr, 10) * GRID_SIZE;
                const distSq = (cx - playerX) ** 2 + (cy - playerY) ** 2;
                if (distSq > maxDistSq) {
                    deleteKeys.push(key);
                }
            }

            for (let k of deleteKeys) {
                this.generatedChunks.delete(k);
                this.foodGrid.delete(k);
            }
        }
    }

    spawnChunkFoods(gx, gy) {
        const isHotspot = Math.random() < 0.04;
        const count = isHotspot ? Math.floor(Math.random() * 12) + 8 : Math.floor(Math.random() * 4) + 1;
        const list = [];

        for (let i = 0; i < count; i++) {
            const isBig = isHotspot || Math.random() < 0.08;
            list.push({
                x: gx * GRID_SIZE + Math.random() * GRID_SIZE,
                y: gy * GRID_SIZE + Math.random() * GRID_SIZE,
                size: isBig ? 8 + Math.random() * 3 : 3 + Math.random() * 1.5,
                val: isBig ? 24 : 4,
                isBig: isBig,
                color: isBig ? '#ffffff' : FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)]
            });
        }

        this.foodGrid.set(`${gx}_${gy}`, list);
    }

    // 撃破されたスネークの肉片ドロップ
    spawnDeathDrop(snake) {
        const hist = snake.history;
        for (let i = 0; i < hist.length; i += 2) {
            const pt = hist[i];
            this.dropFoods.push({
                x: pt.x + (Math.random() - 0.5) * 20,
                y: pt.y + (Math.random() - 0.5) * 20,
                size: 7 + Math.random() * 4,
                val: 18 + Math.random() * 12,
                isBig: true,
                color: snake.color
            });
        }

        // 爆発パーティクル
        for (let p = 0; p < 18; p++) {
            this.particles.push({
                x: snake.x,
                y: snake.y,
                vx: (Math.random() - 0.5) * 8,
                vy: (Math.random() - 0.5) * 8,
                life: 1.0,
                color: snake.color
            });
        }
    }

    // 餌の捕食判定
    checkFoodConsumption(snake, onEat) {
        const gx = Math.floor(snake.x / GRID_SIZE);
        const gy = Math.floor(snake.y / GRID_SIZE);
        const headR = snake.size;

        // 1. チャンク餌
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const key = `${gx + ox}_${gy + oy}`;
                const list = this.foodGrid.get(key);
                if (!list) continue;

                for (let i = list.length - 1; i >= 0; i--) {
                    const f = list[i];
                    const dx = snake.x - f.x;
                    const dy = snake.y - f.y;
                    if (dx * dx + dy * dy < (headR + f.size) ** 2) {
                        snake.addScore(f.val);
                        list.splice(i, 1);
                        if (onEat) onEat(snake, f);
                    }
                }
            }
        }

        // 2. 肉片ドロップ餌
        for (let i = this.dropFoods.length - 1; i >= 0; i--) {
            const f = this.dropFoods[i];
            const dx = snake.x - f.x;
            const dy = snake.y - f.y;
            if (dx * dx + dy * dy < (headR + f.size) ** 2) {
                snake.addScore(f.val);
                this.dropFoods.splice(i, 1);
                if (onEat) onEat(snake, f);
            }
        }
    }

    updateParticles() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.04;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    draw(ctx, cameraX, cameraY, viewW, viewH, frameCount) {
        const minGx = Math.floor(cameraX / GRID_SIZE) - 1;
        const maxGx = Math.floor((cameraX + viewW) / GRID_SIZE) + 1;
        const minGy = Math.floor(cameraY / GRID_SIZE) - 1;
        const maxGy = Math.floor((cameraY + viewH) / GRID_SIZE) + 1;

        // チャンク餌描画
        for (let gx = minGx; gx <= maxGx; gx++) {
            for (let gy = minGy; gy <= maxGy; gy++) {
                const list = this.foodGrid.get(`${gx}_${gy}`);
                if (!list) continue;

                for (let f of list) {
                    if (f.isBig) {
                        const pulse = 1.0 + Math.sin(frameCount * 0.15 + f.x) * 0.2;
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                        ctx.beginPath();
                        ctx.arc(f.x, f.y, f.size * 1.8 * pulse, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.fillStyle = f.color;
                    ctx.beginPath();
                    ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // 肉片ドロップ餌描画
        for (let f of this.dropFoods) {
            if (f.x < cameraX - 50 || f.x > cameraX + viewW + 50 || f.y < cameraY - 50 || f.y > cameraY + viewH + 50) continue;
            const pulse = 1.0 + Math.sin(frameCount * 0.2 + f.x) * 0.25;
            ctx.fillStyle = f.color;
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.size * pulse, 0, Math.PI * 2);
            ctx.fill();
        }

        // パーティクル描画
        for (let p of this.particles) {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5 * p.life, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
}