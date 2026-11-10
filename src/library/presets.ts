import type { BoardType } from '../model/types';

export interface BoardPreset {
  id: string;
  name: string;
  url?: string;
  cols: number;
  rows: number;
  widthMm?: number;
  heightMm?: number;
  /** 基板の端から最初の穴の中心までの距離 */
  marginMm: number;
  type: BoardType;
  /** 値が実物で未確認の場合 true（UI に「仮値」と表示する） */
  provisional?: boolean;
}

export const PRESETS: BoardPreset[] = [
  {
    id: 'akizuki-p03229',
    name: '秋月電子 P-03229',
    url: 'https://akizukidenshi.com/catalog/g/g103229/',
    // TODO: 商品ページの寸法・穴数・片面/両面を確認して更新する（仕様書 §11-1）
    cols: 28,
    rows: 18,
    widthMm: 72,
    heightMm: 47,
    marginMm: 1.71,
    type: 'single',
    provisional: true,
  },
];

export function getPreset(id: string | undefined): BoardPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
