import type { BoardType, Hole, MountingHole } from '../model/types';

export interface BoardPreset {
  id: string;
  name: string;
  url?: string;
  cols: number;
  rows: number;
  widthMm: number;
  heightMm: number;
  /** 基板の端から最初の穴の中心までの距離（横・縦） */
  marginMm: number;
  marginYMm: number;
  type: BoardType;
  mountingHoles: MountingHole[];
  /** 確認できていない項目（UI に表示する） */
  unverified?: string;
}

export const PRESETS: BoardPreset[] = [
  {
    id: 'akizuki-p03229',
    name: '秋月電子 P-03229 片面 Cタイプ 72×47mm',
    url: 'https://akizukidenshi.com/catalog/g/g103229/',
    // 商品ページ・図面（p3229_katamen_c.pdf）: 72×47mm、片面、CEM-3、ピッチ 2.54mm、
    // 穴 375 個（25×15）・穴径 1mm、取付穴 φ3.2mm×4（各辺から 3mm）、厚さ 1.6mm。
    // 穴の格子は基板の中央にある: 横 (72 − 24×2.54) / 2 = 5.52mm、縦 (47 − 14×2.54) / 2 = 5.72mm
    cols: 25,
    rows: 15,
    widthMm: 72,
    heightMm: 47,
    marginMm: 5.52,
    marginYMm: 5.72,
    type: 'single',
    mountingHoles: [
      { xMm: 3, yMm: 3, dMm: 3.2 },
      { xMm: 69, yMm: 3, dMm: 3.2 },
      { xMm: 3, yMm: 44, dMm: 3.2 },
      { xMm: 69, yMm: 44, dMm: 3.2 },
    ],
  },
];

export function getPreset(id: string | undefined): BoardPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** 取付穴に重なる穴（ランド直径 約 1.8mm として判定）を使用禁止にする */
export function holesBlockedByMounting(
  b: { cols: number; rows: number; pitchMm: number; marginMm: number; marginYMm?: number },
  mounts: MountingHole[],
): Hole[] {
  const out: Hole[] = [];
  for (let y = 0; y < b.rows; y++) {
    for (let x = 0; x < b.cols; x++) {
      const hx = b.marginMm + x * b.pitchMm;
      const hy = (b.marginYMm ?? b.marginMm) + y * b.pitchMm;
      if (mounts.some((m) => Math.hypot(hx - m.xMm, hy - m.yMm) < m.dMm / 2 + 0.9)) out.push([x, y]);
    }
  }
  return out;
}
