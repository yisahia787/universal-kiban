import { describe, expect, it } from 'vitest';
import { generateFootprint } from '../src/library/footprints';
import { localToTop, pinsAt, topToLocal } from '../src/logic/geometry';
import { createProject, makePart, parseProject } from '../src/model/project';
import type { Placement } from '../src/model/types';
import { resizedPart } from '../src/ui/actions';

describe('parseProject', () => {
  it('旧形式（hand なし・未配置部品あり）を読み込むと、種類を手元に移して未配置部品を捨てる', () => {
    const old = createProject() as unknown as Record<string, unknown>;
    delete old.hand;
    old.parts = [
      { id: 'a', ref: 'R1', footprint: 'resistor-axial', params: {}, value: '', note: '', placement: null },
      { id: 'b', ref: 'U1', footprint: 'dip', params: {}, value: '', note: '', placement: { side: 'top', x: 1, y: 1, rot: 0 } },
      { id: 'c', ref: 'X1', footprint: 'no-such-part', params: {}, value: '', note: '', placement: null },
    ];
    const p = parseProject(JSON.stringify(old));
    expect(p.hand).toEqual(['resistor-axial', 'dip']);
    expect(p.parts.map((x) => x.ref)).toEqual(['U1']);
  });
  it('hand があればそのまま使う', () => {
    const p = createProject();
    p.hand = ['led', 'pin-socket'];
    expect(parseProject(JSON.stringify(p)).hand).toEqual(['led', 'pin-socket']);
  });
});

describe('topToLocal', () => {
  it('localToTop の逆変換になる（両面・全回転）', () => {
    for (const side of ['top', 'bottom'] as const) {
      for (const rot of [0, 90, 180, 270] as const) {
        const pl: Placement = { side, x: 5, y: 7, rot };
        const [tx, ty] = localToTop(pl, 3, 1);
        const [lx, ly] = topToLocal(pl, tx, ty);
        expect([Math.round(lx), Math.round(ly)]).toEqual([3, 1]);
      }
    }
  });
});

describe('ピンヘッダ・ピンソケットの長さ変更', () => {
  it('ピンソケットが生成できる', () => {
    expect(generateFootprint('pin-socket', { count: 6 }).pins).toHaveLength(6);
  });
  it('終端側を伸ばすと原点はそのまま', () => {
    const h = makePart([], 'pin-header');
    h.placement = { side: 'top', x: 2, y: 2, rot: 0 };
    const r = resizedPart(h, 7, 0);
    expect(pinsAt(r, r.placement!).map((p) => [p.x, p.y])[6]).toEqual([8, 2]);
    expect(r.placement).toMatchObject({ x: 2, y: 2 });
  });
  it('始端側を縮めると反対の端は動かない（90°回転・はんだ面でも）', () => {
    const h = makePart([], 'pin-socket', { count: 5 });
    h.placement = { side: 'bottom', x: 10, y: 3, rot: 90 };
    const lastBefore = pinsAt(h, h.placement).at(-1);
    const r = resizedPart(h, 3, 2);
    const pins = pinsAt(r, r.placement!);
    expect(pins).toHaveLength(3);
    expect(pins.at(-1)).toMatchObject({ x: lastBefore!.x, y: lastBefore!.y });
  });
});

describe('XH コネクタ', () => {
  it('外形は実寸（幅 (n-1)×2.5+4.9mm、奥行 5.75mm）', () => {
    const g = generateFootprint('xh', { count: 4 });
    expect(g.pins).toHaveLength(4);
    expect((g.bounds.x1 - g.bounds.x0) * 2.54).toBeCloseTo(12.4);
    expect((g.bounds.y1 - g.bounds.y0) * 2.54).toBeCloseTo(5.75);
  });
});

describe('ESP32-DevKitC 用ソケット', () => {
  it('19 ピン×2 列、列の間隔 10 ピッチ、ピン名つき', () => {
    const g = generateFootprint('esp32-devkitc', {});
    expect(g.pins).toHaveLength(38);
    const at = (n: string) => g.pins.find((p) => p.num === n)!;
    expect(at('J2-1')).toMatchObject({ name: '3V3', x: 0, y: 0 });
    expect(at('J2-19')).toMatchObject({ name: '5V', x: 0, y: 18 });
    expect(at('J3-1')).toMatchObject({ name: 'GND', x: 10, y: 0 });
    expect(at('J3-19')).toMatchObject({ name: 'CLK', x: 10, y: 18 });
  });
  it('ピン名を部品ごとに変更できる', () => {
    const u = makePart([], 'esp32-devkitc');
    u.placement = { side: 'top', x: 0, y: 0, rot: 0 };
    u.pinNames = { 'J2-3': 'SENSOR' };
    expect(pinsAt(u, u.placement).find((p) => p.num === 'J2-3')!.name).toBe('SENSOR');
  });
});

describe('XH コネクタの長さ変更', () => {
  it('ドラッグで変えられる範囲は極数の範囲（2〜16）', async () => {
    const { getFootprint, resizeRange } = await import('../src/library/footprints');
    expect(getFootprint('xh')!.resizable).toBe(true);
    expect(resizeRange(getFootprint('xh')!)).toEqual([2, 16]);
    expect(resizeRange(getFootprint('pin-header')!)).toEqual([1, 40]);
  });
  it('極数を変えると外形も実寸で伸びる', () => {
    const cn = makePart([], 'xh');
    cn.placement = { side: 'top', x: 3, y: 3, rot: 0 };
    const r = resizedPart(cn, 5, 0);
    const g = generateFootprint('xh', r.params);
    expect(g.pins).toHaveLength(5);
    expect((g.bounds.x1 - g.bounds.x0) * 2.54).toBeCloseTo(14.9);
  });
});
