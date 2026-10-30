/**
 * ==============================================================================
 * 『くねくねバトル オンライン』入力制御 ＆ 2本指ピンチズームモジュール (input.js)
 * ・画面長押しによるブースト誤爆を完全根絶（専用ボタンのみで加速）
 * ・2本指ピンチイン/アウトによる滑らかなカメラ視野拡縮（0.45〜1.35倍）
 * ==============================================================================
 */

export class InputManager {
    constructor() {
        // ジョイスティック状態
        this.x = 0;
        this.y = 0;
        this.active = false;
        this.touchId = null;
        this.center = { x: 0, y: 0 };
        this.maxRadius = 32;

        // ブースト状態（専用ボタン押下時のみ true）
        this.boost = false;

        // 2本指ピンチズーム状態
        this.isPinching = false;
        this.initialPinchDistance = 0;
        this.zoomMultiplier = 1.0; // ユーザーピンチ倍率 (0.45 〜 1.35)
        this.pinchTouchIds = [];

        // DOM参照
        this.canvas = null;
        this.joyBase = null;
        this.joyKnob = null;
        this.boostBtn = null;

        // コールバック
        this.onBoostChange = null; // (isBoosting) => void
    }

    init(canvas, onBoostChange) {
        this.canvas = canvas;
        this.onBoostChange = onBoostChange;
        this.joyBase = document.getElementById('joystick-base');
        this.joyKnob = document.getElementById('joystick-knob');
        this.boostBtn = document.getElementById('btn-boost');

        this.bindTouchEvents();
        this.bindMouseEvents();
        this.bindBoostButton();
    }

    // 画面長押し誤爆を根絶：ブーストボタン専用リスナー
    bindBoostButton() {
        if (!this.boostBtn) return;

        const setBoost = (on) => {
            if (this.boost === on) return;
            this.boost = on;
            this.boostBtn.classList.toggle('active', on);
            if (this.onBoostChange) this.onBoostChange(on);
        };

        this.boostBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setBoost(true);
        }, { passive: false });

        this.boostBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setBoost(false);
        }, { passive: false });

        this.boostBtn.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setBoost(false);
        }, { passive: false });

        this.boostBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            setBoost(true);
        });

        window.addEventListener('mouseup', () => {
            if (this.boost) setBoost(false);
        });
    }

    bindTouchEvents() {
        if (!this.canvas) return;

        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });
    }

    handleTouchStart(e) {
        e.preventDefault();

        // 2本指タッチ検知 -> ピンチズーム開始
        if (e.touches.length === 2) {
            this.isPinching = true;
            this.pinchTouchIds = [e.touches[0].identifier, e.touches[1].identifier];
            this.initialPinchDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            // ピンチ中はジョイスティックの一時停止
            this.endJoystick();
            return;
        }

        // 1本指タッチ -> ジョイスティック開始（画面のどこを押しても追従）
        if (e.touches.length === 1 && !this.active && !this.isPinching) {
            const t = e.touches[0];
            this.touchId = t.identifier;
            this.startJoystick(t.clientX, t.clientY);
        }
    }

    handleTouchMove(e) {
        e.preventDefault();

        // 2本指ピンチズーム処理
        if (this.isPinching && e.touches.length >= 2) {
            const t0 = Array.from(e.touches).find(t => t.identifier === this.pinchTouchIds[0]);
            const t1 = Array.from(e.touches).find(t => t.identifier === this.pinchTouchIds[1]);

            if (t0 && t1 && this.initialPinchDistance > 10) {
                const currentDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
                const deltaRatio = currentDist / this.initialPinchDistance;

                // ズーム倍率の更新（0.45 〜 1.35 に制限）
                this.zoomMultiplier = Math.max(0.45, Math.min(1.35, this.zoomMultiplier * (1 + (deltaRatio - 1) * 0.05)));
                this.initialPinchDistance = currentDist;
            }
            return;
        }

        // 1本指ジョイスティック移動
        if (this.active) {
            const t = Array.from(e.touches).find(touch => touch.identifier === this.touchId);
            if (t) {
                this.moveJoystick(t.clientX, t.clientY);
            }
        }
    }

    handleTouchEnd(e) {
        e.preventDefault();

        if (this.isPinching) {
            // 2本指のうちどちらかが離れたらピンチ終了
            if (e.touches.length < 2) {
                this.isPinching = false;
                this.pinchTouchIds = [];
            }
        }

        // ジョイスティック担当の指が離れたら終了
        if (this.active) {
            const stillActive = Array.from(e.touches).some(t => t.identifier === this.touchId);
            if (!stillActive) {
                this.endJoystick();
            }
        }
    }

    // PC / マウス用フォールバック
    bindMouseEvents() {
        let isMouseDown = false;

        this.canvas.addEventListener('mousedown', (e) => {
            isMouseDown = true;
            this.startJoystick(e.clientX, e.clientY);
        });

        window.addEventListener('mousemove', (e) => {
            if (isMouseDown) {
                this.moveJoystick(e.clientX, e.clientY);
            }
        });

        window.addEventListener('mouseup', () => {
            if (isMouseDown) {
                isMouseDown = false;
                this.endJoystick();
            }
        });

        // PCマウスホイールによるズーム対応
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.95 : 1.05;
            this.zoomMultiplier = Math.max(0.45, Math.min(1.35, this.zoomMultiplier * delta));
        }, { passive: false });
    }

    startJoystick(x, y) {
        this.active = true;
        this.center = { x, y };

        if (this.joyBase) {
            this.joyBase.style.display = 'block';
            this.joyBase.style.left = `${x}px`;
            this.joyBase.style.top = `${y}px`;
        }
        if (this.joyKnob) {
            this.joyKnob.style.transform = 'translate(-50%, -50%)';
        }
        this.x = 0;
        this.y = 0;
    }

    moveJoystick(cx, cy) {
        let dx = cx - this.center.x;
        let dy = cy - this.center.y;
        const dist = Math.hypot(dx, dy);

        if (dist > this.maxRadius) {
            dx = (dx / dist) * this.maxRadius;
            dy = (dy / dist) * this.maxRadius;
        }

        if (this.joyKnob) {
            this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        }

        this.x = dx;
        this.y = dy;
    }

    endJoystick() {
        this.active = false;
        this.touchId = null;
        if (this.joyBase) {
            this.joyBase.style.display = 'none';
        }
        this.x = 0;
        this.y = 0;
    }
}