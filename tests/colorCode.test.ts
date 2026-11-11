import { describe, expect, it } from 'vitest';
import { BAND_COLORS as C, GOLD, SILVER, parseResistance, resistorBands } from '../src/logic/colorCode';

describe('parseResistance', () => {
  it.each([
    ['330', 330],
    ['330Ω', 330],
    ['10k', 10000],
    ['4.7kΩ', 4700],
    ['4k7', 4700],
    ['2R2', 2.2],
    ['1M', 1e6],
    ['0.47', 0.47],
    [' 220 ohm', 220],
  ])('%s → %d', (t, v) => expect(parseResistance(t)).toBeCloseTo(v));
  it.each(['', 'abc', '10uF', '-5'])('%s は読めない', (t) => expect(parseResistance(t)).toBeNull());
});

describe('resistorBands', () => {
  it('10kΩ = 茶 黒 橙 金', () => expect(resistorBands(10000)).toEqual([C[1], C[0], C[3], GOLD]));
  it('330Ω = 橙 橙 茶 金', () => expect(resistorBands(330)).toEqual([C[3], C[3], C[1], GOLD]));
  it('4.7Ω = 黄 紫 金 金', () => expect(resistorBands(4.7)).toEqual([C[4], C[7], GOLD, GOLD]));
  it('0.47Ω = 黄 紫 銀 金', () => expect(resistorBands(0.47)).toEqual([C[4], C[7], SILVER, GOLD]));
  it('100Ω = 茶 黒 茶 金', () => expect(resistorBands(100)).toEqual([C[1], C[0], C[1], GOLD]));
  it('有効数字 3 桁は 5 本帯（4.99kΩ = 黄 白 白 茶 茶）', () => expect(resistorBands(4990)).toEqual([C[4], C[9], C[9], C[1], C[1]]));
});
