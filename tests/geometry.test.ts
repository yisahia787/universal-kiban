import { describe, expect, it } from 'vitest';
import { generateFootprint, FOOTPRINTS } from '../src/library/footprints';
import { colLabel, holeLabel, pinsAt } from '../src/logic/geometry';
import { makePart } from '../src/model/project';

describe('labels', () => {
  it('列ラベル', () => {
    expect(colLabel(0)).toBe('A');
    expect(colLabel(25)).toBe('Z');
    expect(colLabel(26)).toBe('AA');
    expect(colLabel(27)).toBe('AB');
    expect(holeLabel(2, 4)).toBe('C5');
  });
});

describe('footprints', () => {
  it('すべてのフットプリントが既定値で生成でき、ピンが重複しない', () => {
    for (const f of FOOTPRINTS) {
      const g = generateFootprint(f.id, {});
      expect(g.pins.length).toBeGreaterThan(0);
      const ks = new Set(g.pins.map((p) => `${p.x},${p.y}`));
      expect(ks.size).toBe(g.pins.length);
      expect(g.pins[0]).toMatchObject({ num: '1' });
    }
  });
  it('DIP-8 のピン配置（反時計回り）', () => {
    const g = generateFootprint('dip', { pins: 8, rowSpan: 3 });
    const at = (n: string) => g.pins.find((p) => p.num === n)!;
    expect([at('1').x, at('1').y]).toEqual([0, 0]);
    expect([at('4').x, at('4').y]).toEqual([0, 3]);
    expect([at('5').x, at('5').y]).toEqual([3, 3]);
    expect([at('8').x, at('8').y]).toEqual([3, 0]);
  });
});

describe('pinsAt', () => {
  const r = makePart([], 'resistor-axial', { span: 4 });
  it('部品面・回転なし', () => {
    expect(pinsAt(r, { side: 'top', x: 2, y: 3, rot: 0 }).map((p) => [p.x, p.y])).toEqual([[2, 3], [6, 3]]);
  });
  it('部品面・90°回転', () => {
    expect(pinsAt(r, { side: 'top', x: 2, y: 3, rot: 90 }).map((p) => [p.x, p.y])).toEqual([[2, 3], [2, 7]]);
  });
  it('はんだ面に置いた部品は部品面から見て左右反転', () => {
    expect(pinsAt(r, { side: 'bottom', x: 6, y: 3, rot: 0 }).map((p) => [p.x, p.y])).toEqual([[6, 3], [2, 3]]);
  });
});
