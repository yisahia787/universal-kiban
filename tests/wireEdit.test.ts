import { describe, expect, it } from 'vitest';
import { eraseOverlap } from '../src/logic/wireEdit';
import type { Wire } from '../src/model/types';

let n = 0;
const id = () => `n${++n}`;
const w = (wid: string, points: Wire['points'], kind: Wire['kind'] = 'bare', side: Wire['side'] = 'bottom'): Wire => ({ id: wid, kind, side, color: '', points });
const pts = (ws: Wire[] | null) => ws?.map((x) => JSON.stringify(x.points)).sort();

describe('eraseOverlap', () => {
  it('同じ位置に重ねると配線ごと消える', () => {
    expect(eraseOverlap([w('a', [[0, 0], [5, 0]])], w('x', [[5, 0], [0, 0]]), id)).toEqual([]);
  });
  it('真ん中に重ねると 2 本に分かれる', () => {
    const r = eraseOverlap([w('a', [[0, 0], [6, 0]])], w('x', [[2, 0], [4, 0]]), id);
    expect(pts(r)).toEqual(['[[0,0],[2,0]]', '[[4,0],[6,0]]']);
    expect(r!.some((x) => x.id === 'a')).toBe(true);
  });
  it('端に重ねると短くなる（斜めの線）', () => {
    const r = eraseOverlap([w('a', [[0, 0], [4, 4]])], w('x', [[2, 2], [4, 4]]), id);
    expect(pts(r)).toEqual(['[[0,0],[2,2]]']);
  });
  it('はみ出す場合や種類・面が違う場合は削除しない', () => {
    const base = [w('a', [[0, 0], [4, 0]])];
    expect(eraseOverlap(base, w('x', [[2, 0], [6, 0]]), id)).toBeNull();
    expect(eraseOverlap(base, w('x', [[1, 0], [3, 0]], 'insulated'), id)).toBeNull();
    expect(eraseOverlap(base, w('x', [[1, 0], [3, 0]], 'bare', 'top'), id)).toBeNull();
    expect(eraseOverlap(base, w('x', [[1, 1], [3, 1]]), id)).toBeNull();
  });
  it('つながった 2 本にまたがって重ねても削除できる', () => {
    const r = eraseOverlap([w('a', [[0, 0], [3, 0]]), w('b', [[3, 0], [6, 0]])], w('x', [[2, 0], [4, 0]]), id);
    expect(pts(r)).toEqual(['[[0,0],[2,0]]', '[[4,0],[6,0]]']);
  });
  it('はんだブリッジも同じ位置に置くと消える', () => {
    expect(eraseOverlap([w('a', [[1, 1], [2, 1]], 'bridge')], w('x', [[2, 1], [1, 1]], 'bridge'), id)).toEqual([]);
  });
  it('折れ線の配線は該当する線分だけを取り除く', () => {
    const r = eraseOverlap([w('a', [[0, 0], [0, 4], [4, 4]])], w('x', [[0, 2], [0, 4]]), id);
    expect(pts(r)).toEqual(['[[0,0],[0,2]]', '[[0,4],[4,4]]']);
  });
});
