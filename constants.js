/**
 * ==============================================================================
 * 『くねくねバトル オンライン』システム共通定数定義 (constants.js)
 * ==============================================================================
 */

// ワールド・空間サイズ
export const MAP_SIZE = 60000;
export const GRID_SIZE = 250;

// プレイヤー・AI定数
export const TOTAL_SNAKES = 50;
export const MAX_PLAYERS = 8;
export const MAX_AIS = 42;

// 移動速度（黄金比減衰モデル基盤）
export const BASE_SPEED = 4.2;
export const BOOST_SPEED_MULT = 1.8;
export const TURN_SPEED_PLAYER = 0.16;

// セーフエリア規定値（ピクセル）
export const SAFE_INSET_TOP_GRAVITY = 104; // GRAVITYネイティブバー直下
export const SAFE_INSET_TOP_WEB = 20;      // 一般Webブラウザプレビュー用
export const SAFE_INSET_BOTTOM = 24;

// GRAVITY公式製作者 内部user_id定数（真の内部ID）
export const CREATOR_MAIN_INTERNAL_UID = '1540889251'; // norion (メイン窓口)
export const CREATOR_SUB_INTERNAL_UID  = '1542253108'; // のりおん (ゲーム開発・告知)

// スネーク基本カラーパレット
export const SNAKE_COLORS = [
    '#00e5ff', // シアン (デフォルト)
    '#ff3366', // ローズレッド
    '#ccff33', // ライムイエロー
    '#ff9933', // ネオンオレンジ
    '#cc66ff', // パープル
    '#33ff99', // エメラルドグリーン
    '#ffff33'  // イエロー
];

// 環境餌カラー
export const FOOD_COLORS = ['#ffff99', '#99ffff', '#b3ff99', '#ffb3d9'];