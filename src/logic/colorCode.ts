/** 抵抗のカラーコード */

export const BAND_COLORS = ['#1b1b1b', '#7b4a24', '#d32f2f', '#f57c00', '#fbc02d', '#2e7d32', '#1e5bc6', '#7b3fa0', '#8a8a8a', '#f5f5f5'];
export const GOLD = '#c9a227';
export const SILVER = '#b8bcc2';
export const COLOR_NAMES = ['黒', '茶', '赤', '橙', '黄', '緑', '青', '紫', '灰', '白'];

const PREFIX: Record<string, number> = { R: 1, r: 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6, G: 1e9, g: 1e9 };

/**
 * 抵抗値の文字列を Ω に変換する。
 * 例: "330", "330Ω", "10k", "4.7kΩ", "4k7", "2R2", "1M", "0.47"
 */
export function parseResistance(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '').replace(/(Ω|ohms?|オーム)$/i, '');
  if (!t) return null;
  // 4k7 / 2R2 形式
  let m = t.match(/^(\d+)([RrKkMmGg])(\d+)$/);
  if (m) return Number(`${m[1]}.${m[3]}`) * PREFIX[m[2]];
  m = t.match(/^(\d+(?:\.\d+)?|\.\d+)([RrKkMmGg]?)$/);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] ? PREFIX[m[2]] : 1);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * カラーコードの帯の色（左から）。
 * 有効数字 2 桁で表せる値は 4 本（許容差 金 ±5%）、3 桁必要な値は 5 本（許容差 茶 ±1%）。
 * 表せない値は null。
 */
export function resistorBands(ohms: number): string[] | null {
  for (const digits of [2, 3]) {
    let e = Math.floor(Math.log10(ohms)) - (digits - 1);
    let mant = Math.round(ohms / 10 ** e);
    if (mant >= 10 ** digits) {
      mant /= 10;
      e += 1;
    }
    // 誤差 0.1% 以内で表せるか
    if (Math.abs(mant * 10 ** e - ohms) / ohms > 0.001) continue;
    if (e < -2 || e > 9) return null;
    const ds = String(mant).padStart(digits, '0').split('').map(Number);
    const mult = e === -1 ? GOLD : e === -2 ? SILVER : BAND_COLORS[e];
    return [...ds.map((d) => BAND_COLORS[d]), mult, digits === 2 ? GOLD : BAND_COLORS[1]];
  }
  return null;
}
