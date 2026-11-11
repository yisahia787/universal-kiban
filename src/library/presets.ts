import type { BoardType, Hole, MountingHole } from '../model/types';

export interface BoardPreset {
  id: string;
  name: string;
  url?: string;
  cols: number;
  rows: number;
  widthMm: number;
  heightMm: number;
  /** 基板の端から最初の穴の中心までの距離 */
  marginMm: number;
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
    // 商品ページの主な仕様: 72×47mm、片面、CEM-3、ランドピッチ 2.54mm、穴径 1mm、
    // 取付穴径 3.2mm・取付穴間隔 66×41mm（= 各辺から 3mm）、厚さ 1.6mm
    cols: 28,
    rows: 18,
    widthMm: 72,
    heightMm: 47,
    marginMm: 1.71,
    type: 'single',
    mountingHoles: [
      { xMm: 3, yMm: 3, dMm: 3.2 },
      { xMm: 69, yMm: 3, dMm: 3.2 },
      { xMm: 3, yMm: 44, dMm: 3.2 },
      { xMm: 69, yMm: 44, dMm: 3.2 },
    ],
    unverified: '穴数（28×18）は外形からの推定です',
  },
];

export function getPreset(id: string | undefined): BoardPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** 取付穴に重なる穴（ランド直径 約 1.8mm として判定）を使用禁止にする */
export function holesBlockedByMounting(
  b: { cols: number; rows: number; pitchMm: number; marginMm: number },
  mounts: MountingHole[],
): Hole[] {
  const out: Hole[] = [];
  for (let y = 0; y < b.rows; y++) {
    for (let x = 0; x < b.cols; x++) {
      const hx = b.marginMm + x * b.pitchMm;
      const hy = b.marginMm + y * b.pitchMm;
      if (mounts.some((m) => Math.hypot(hx - m.xMm, hy - m.yMm) < m.dMm / 2 + 0.9)) out.push([x, y]);
    }
  }
  return out;
}
