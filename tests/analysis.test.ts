import { describe, expect, it } from 'vitest';
import { analyze } from '../src/logic/analysis';
import { holeKey } from '../src/logic/geometry';
import { checkPlacement } from '../src/logic/placement';
import { createProject, makePart } from '../src/model/project';
import type { Project, Wire } from '../src/model/types';

function setup(): Project {
  const p = createProject();
  p.board = { ...p.board, cols: 20, rows: 10, type: 'single', disabledHoles: [[19, 9]] };
  return p;
}
const wire = (id: string, kind: Wire['kind'], side: Wire['side'], points: Wire['points']): Wire => ({ id, kind, side, color: '', points });

describe('checkPlacement', () => {
  it('基板外・使用禁止穴・穴の重複を検出する', () => {
    const p = setup();
    const r1 = makePart(p.parts, 'resistor-axial');
    r1.placement = { side: 'top', x: 2, y: 2, rot: 0 };
    p.parts.push(r1);
    const r2 = makePart(p.parts, 'resistor-axial');
    expect(checkPlacement(p, r2, { side: 'top', x: 18, y: 0, rot: 0 }).ok).toBe(false);
    expect(checkPlacement(p, r2, { side: 'top', x: 15, y: 9, rot: 0 }).ok).toBe(false);
    // はんだ面の部品でも同じ穴は使えない
    expect(checkPlacement(p, r2, { side: 'bottom', x: 6, y: 2, rot: 0 }).ok).toBe(false);
    expect(checkPlacement(p, r2, { side: 'top', x: 2, y: 5, rot: 0 }).ok).toBe(true);
  });
  it('同じ面の外形の重なりは警告、反対面なら警告なし', () => {
    const p = setup();
    const r1 = makePart(p.parts, 'resistor-axial');
    r1.placement = { side: 'top', x: 2, y: 2, rot: 0 };
    p.parts.push(r1);
    const c = makePart(p.parts, 'ceramic-cap');
    const top = checkPlacement(p, c, { side: 'top', x: 3, y: 3, rot: 0 });
    expect(top.ok).toBe(true);
    // 3,3 と 5,3 → 抵抗(y=2, 範囲 y-0.45..0.45) とは y 方向で離れているので重ならない
    expect(top.warnings).toHaveLength(0);
    const over = checkPlacement(p, c, { side: 'top', x: 3, y: 2, rot: 90 });
    expect(over.warnings.length).toBeGreaterThan(0);
  });
});

describe('analyze nets', () => {
  it('はんだ面のすずめっき線で 2 つの部品のピンがつながる', () => {
    const p = setup();
    const r1 = makePart(p.parts, 'resistor-axial');
    r1.placement = { side: 'top', x: 0, y: 0, rot: 0 }; // (0,0) (4,0)
    p.parts.push(r1);
    const r2 = makePart(p.parts, 'resistor-axial');
    r2.placement = { side: 'top', x: 0, y: 4, rot: 0 }; // (0,4) (4,4)
    p.parts.push(r2);
    p.wires.push(wire('w1', 'bare', 'bottom', [[4, 0], [4, 4]]));
    const a = analyze(p);
    expect(a.netOfHole.get(holeKey(4, 0))).toBe(a.netOfHole.get(holeKey(4, 4)));
    expect(a.netOfHole.get(holeKey(0, 0))).not.toBe(a.netOfHole.get(holeKey(0, 4)));
    // 途中の穴 (4,2) も同じネット
    expect(a.netOfHole.get(holeKey(4, 2))).toBe(a.netOfHole.get(holeKey(4, 0)));
    // 未接続警告は (0,0) と (0,4) の 2 件
    expect(a.issues.filter((i) => i.message.includes('接続されていません'))).toHaveLength(2);
  });

  it('部品面の配線とはんだ面の配線は同じ穴でつながる', () => {
    const p = setup();
    p.wires.push(wire('a', 'insulated', 'top', [[0, 0], [5, 5]]));
    p.wires.push(wire('b', 'bare', 'bottom', [[5, 5], [8, 5]]));
    const a = analyze(p);
    expect(a.netOfHole.get(holeKey(0, 0))).toBe(a.netOfHole.get(holeKey(8, 5)));
    // 被覆線の途中は導通しない
    expect(a.netOfHole.get(holeKey(2, 2))).toBeUndefined();
  });

  it('斜めの線で真上を通らない穴とは導通しない', () => {
    const p = setup();
    p.wires.push(wire('a', 'bare', 'bottom', [[0, 0], [1, 2]]));
    p.wires.push(wire('b', 'bare', 'bottom', [[1, 1], [5, 1]]));
    const a = analyze(p);
    expect(a.netOfHole.get(holeKey(0, 0))).not.toBe(a.netOfHole.get(holeKey(1, 1)));
  });

  it('タクトスイッチの内部導通', () => {
    const p = setup();
    const sw = makePart(p.parts, 'tact-switch');
    sw.placement = { side: 'top', x: 1, y: 1, rot: 0 };
    p.parts.push(sw);
    const a = analyze(p);
    expect(a.netOfHole.get(holeKey(1, 1))).toBe(a.netOfHole.get(holeKey(4, 1)));
    expect(a.netOfHole.get(holeKey(1, 1))).not.toBe(a.netOfHole.get(holeKey(1, 3)));
  });

  it('名前の違うネットがつながるとエラー', () => {
    const p = setup();
    p.wires.push(wire('a', 'bare', 'bottom', [[0, 0], [3, 0]]));
    p.nets.push({ name: 'VCC', anchor: [0, 0] }, { name: 'GND', anchor: [3, 0] });
    const a = analyze(p);
    expect(a.issues.some((i) => i.severity === 'error' && i.message.includes('VCC'))).toBe(true);
  });
});

describe('プリセット', () => {
  it('P-03229 は取付穴に重なる穴を使用禁止にする', async () => {
    const { defaultBoard } = await import('../src/model/project');
    const b = defaultBoard();
    expect(b.mountingHoles).toHaveLength(4);
    const keys = b.disabledHoles.map((h) => h.join(','));
    expect(keys).toContain('0,0');
    expect(keys).toContain('27,17');
    expect(keys).not.toContain('5,5');
  });
});
