/**
 * ==============================================================================
 * 『くねくねバトル オンライン』スネークエンティティクラス (snake.js)
 * ・自機 ＆ 49体AI共通の物理・描画・成長計算
 * ・体節の滑らかな追従・波打ちアニメーション
 * ・表情5種（normal, angry, happy, cool, cute）のベクター描画
 * ==============================================================================
 */

import { BASE_SPEED, BOOST_SPEED_MULT, TURN_SPEED_PLAYER, MAP_SIZE } from './constants.js';

export class Snake {
    constructor(isPlayer = false, id = 0, name = '', color = '#00e5ff', face = 'normal') {
        this.isPlayer = isPlayer;
        this.id = id;
        this.name = name || (isPlayer ? 'あなた' : `CPU ${id}`);
        this.color = color;
        this.face = face;
        this.internalUid = isPlayer ? 'local_user' : null;

        // 座標・物理
        this.x = MAP_SIZE / 2;
        this.y = MAP_SIZE / 2;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.speed = BASE_SPEED;
        this.turnSpeed = isPlayer ? TURN_SPEED_PLAYER : 0.08;

        // 成長・サイズ
        this.score = 50;
        this.size = 14;
        this.targetLength = 16;
        this.history = [];
        this.distCounter = 0;
        this.maxSize = this.size;

        // フラグ・状態
        this.isDead = false;
        this.kills = 0;
        this.isBoosting = false;
        this.isVisible = true;

        // AI思考用内部ステート
        this.aiLevel = isPlayer ? 0 : (Math.floor(Math.random() * 3) + 1);
        this.aiChangeTimer = Math.floor(Math.random() * 30);
    }

    reset(spawnX, spawnY) {
        this.x = spawnX;
        this.y = spawnY;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.score = 50;
        this.recalculateSize();
        this.maxSize = this.size;
        this.history = [];
        this.distCounter = 0;
        this.isDead = false;
        this.kills = 0;
        this.isBoosting = false;
        this.isVisible = true;
    }

    recalculateSize() {
        this.size = 12 + Math.pow(this.score, 0.45) * 0.35;
        this.targetLength = 10 + Math.floor(Math.pow(this.score, 0.55) * 0.4);
        if (this.size > this.maxSize) this.maxSize = this.size;
    }

    addScore(val) {
        this.score += val;
        this.recalculateSize();
    }

    updatePhysics(inputAngle, boostActive) {
        if (this.isDead) return;

        this.isBoosting = boostActive && this.score > 60;
        const currentSpeed = this.isBoosting ? BASE_SPEED * BOOST_SPEED_MULT : BASE_SPEED;
        this.speed = currentSpeed;

        // ブースト時の質量微小消費
        if (this.isBoosting) {
            this.score = Math.max(50, this.score - 0.09);
            this.recalculateSize();
        }

        // 旋回制御
        if (inputAngle !== null) {
            this.targetAngle = inputAngle;
        }

        let diff = this.targetAngle - this.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), this.turnSpeed);

        // 前進
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;

        // 外壁クランプ
        const wallMin = this.size;
        const wallMax = MAP_SIZE - this.size;
        if (this.x < wallMin || this.x > wallMax || this.y < wallMin || this.y > wallMax) {
            this.x = Math.max(wallMin, Math.min(wallMax, this.x));
            this.y = Math.max(wallMin, Math.min(wallMax, this.y));
            if (!this.isPlayer) {
                this.targetAngle = Math.atan2(MAP_SIZE / 2 - this.y, MAP_SIZE / 2 - this.x);
            }
        }

        // 体節履歴記録
        this.distCounter += this.speed;
        const stepDist = this.size * 0.55;
        if (this.distCounter >= stepDist) {
            this.history.unshift({ x: this.x, y: this.y, angle: this.angle });
            this.distCounter = 0;
            while (this.history.length > this.targetLength) {
                this.history.pop();
            }
        }
    }

    draw(ctx, frameCount, cameraScale) {
        if (this.isDead || !this.isVisible) return;

        const histLen = this.history.length;

        // 1. 体節（胴体）の描画
        for (let i = histLen - 1; i >= 0; i--) {
            const pt = this.history[i];
            const progress = i / histLen;
            const segmentRadius = this.size * (1 - Math.pow(progress, 2.5) * 0.5);

            // 波打ちアニメーション
            const waveOffset = Math.sin(frameCount * 0.18 - i * 0.35) * (this.size * 0.2);
            const normAngle = (pt.angle || 0) + Math.PI / 2;
            const drawX = pt.x + Math.cos(normAngle) * waveOffset;
            const drawY = pt.y + Math.sin(normAngle) * waveOffset;

            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(drawX, drawY, segmentRadius, 0, Math.PI * 2);
            ctx.fill();

            // 胴体シャドウリング（立体感）
            const flow = Math.sin(frameCount * 0.25 - i * 0.3);
            if (flow > 0.4) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
                ctx.beginPath();
                ctx.arc(drawX, drawY, segmentRadius * 0.7, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 2. 頭部の描画
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();

        // 頭部グロー（ブースト時）
        if (this.isBoosting) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        // 表情描画
        this.drawFaceExpressions(ctx);
        ctx.restore();

        // 3. ネームプレート ＆ スコア
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, this.x, this.y - this.size - 6);
    }

    drawFaceExpressions(ctx) {
        const eyeR = this.size * 0.35;
        const eyeX = this.size * 0.32;
        const eyeY = this.size * 0.38;
        const pupilR = eyeR * 0.45;

        switch (this.face) {
            case 'angry':
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#111827';
                ctx.beginPath(); ctx.arc(eyeX + 2, -eyeY, pupilR, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX + 2, eyeY, pupilR, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#111827';
                ctx.lineWidth = Math.max(1.5, this.size * 0.12);
                ctx.beginPath(); ctx.moveTo(eyeX - eyeR, -eyeY - 3); ctx.lineTo(eyeX + eyeR, -eyeY + 3); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(eyeX - eyeR, eyeY + 3); ctx.lineTo(eyeX + eyeR, eyeY - 3); ctx.stroke();
                break;

            case 'happy':
                ctx.strokeStyle = '#111827';
                ctx.lineWidth = Math.max(2, this.size * 0.14);
                ctx.beginPath(); ctx.arc(eyeX, -eyeY, eyeR * 0.8, -Math.PI / 2, Math.PI / 2); ctx.stroke();
                ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR * 0.8, -Math.PI / 2, Math.PI / 2); ctx.stroke();
                ctx.fillStyle = 'rgba(255, 99, 132, 0.7)';
                ctx.beginPath(); ctx.arc(eyeX - 2, 0, this.size * 0.25, 0, Math.PI * 2); ctx.fill();
                break;

            case 'cool':
                ctx.fillStyle = '#0f172a';
                ctx.beginPath(); ctx.roundRect ? ctx.roundRect(eyeX - eyeR, -eyeY - 2, eyeR * 2, eyeR * 1.5, 3) : ctx.rect(eyeX - eyeR, -eyeY - 2, eyeR * 2, eyeR * 1.5); ctx.fill();
                ctx.beginPath(); ctx.roundRect ? ctx.roundRect(eyeX - eyeR, eyeY - eyeR * 0.7, eyeR * 2, eyeR * 1.5, 3) : ctx.rect(eyeX - eyeR, eyeY - eyeR * 0.7, eyeR * 2, eyeR * 1.5); ctx.fill();
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 1.2;
                ctx.beginPath(); ctx.moveTo(eyeX - eyeR, 0); ctx.lineTo(eyeX + eyeR, 0); ctx.stroke();
                break;

            case 'cute':
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(eyeX, -eyeY, eyeR * 1.1, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR * 1.1, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#0f172a';
                ctx.beginPath(); ctx.arc(eyeX + 1, -eyeY, pupilR * 1.1, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX + 1, eyeY, pupilR * 1.1, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(eyeX + 3, -eyeY - 2, pupilR * 0.4, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX + 3, eyeY - 2, pupilR * 0.4, 0, Math.PI * 2); ctx.fill();
                break;

            case 'normal':
            default:
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#111827';
                ctx.beginPath(); ctx.arc(eyeX + 2, -eyeY, pupilR, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX + 2, eyeY, pupilR, 0, Math.PI * 2); ctx.fill();
                break;
        }
    }
}