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
