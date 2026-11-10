import { describe, expect, it } from 'vitest';
import { conductingHoles, latticePointsOnSegment, nearMissHoles, wireUsable } from '../src/logic/conduction';
import type { Wire } from '../src/model/types';

const w = (kind: Wire['kind'], side: Wire['side'], points: Wire['points']): Wire => ({ id: 'w', kind, side, color: '', points });
const keys = (hs: number[][]) => hs.map((h) => h.join(',')).sort();

describe('latticePointsOnSegment', () => {
  it('水平線は通過するすべての穴を含む', () => {
    expect(keys(latticePointsOnSegment([0, 0], [3, 0]))).toEqual(keys([[0, 0], [1, 0], [2, 0], [3, 0]]));
  });
  it('45° の線は穴の中心を通る', () => {
    expect(keys(latticePointsOnSegment([0, 0], [2, 2]))).toEqual(keys([[0, 0], [1, 1], [2, 2]]));
  });
  it('2:1 の傾きで中心を通らない線は端点のみ', () => {
    expect(keys(latticePointsOnSegment([0, 0], [1, 2]))).toEqual(keys([[0, 0], [1, 2]]));
  });
  it('4:2 の傾きは途中の (2,1) を通る', () => {
    expect(keys(latticePointsOnSegment([0, 0], [4, 2]))).toEqual(keys([[0, 0], [2, 1], [4, 2]]));
  });
});

describe('conductingHoles', () => {
  it('すずめっき線（両面基板）は真上を通る穴と導通する', () => {
    const hs = conductingHoles(w('bare', 'top', [[0, 0], [0, 2], [2, 2]]), 'double');
    expect(keys(hs)).toEqual(keys([[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]));
  });
  it('はんだ面のすずめっき線は片面基板でも通過穴と導通する', () => {
    expect(conductingHoles(w('bare', 'bottom', [[0, 0], [3, 0]]), 'single')).toHaveLength(4);
  });
  it('片面基板の部品面のすずめっき線は端点・折れ点のみ', () => {
    const hs = conductingHoles(w('bare', 'top', [[0, 0], [0, 3], [3, 3]]), 'single');
    expect(keys(hs)).toEqual(keys([[0, 0], [0, 3], [3, 3]]));
  });
  it('被覆線は両端のみ', () => {
    const hs = conductingHoles(w('insulated', 'bottom', [[0, 0], [0, 3], [3, 3]]), 'double');
    expect(keys(hs)).toEqual(keys([[0, 0], [3, 3]]));
  });
  it('はんだブリッジは両端の 2 穴', () => {
    expect(keys(conductingHoles(w('bridge', 'bottom', [[1, 1], [2, 1]]), 'single'))).toEqual(keys([[1, 1], [2, 1]]));
  });
  it('片面基板の部品面のはんだブリッジは使えず導通しない', () => {
    const wire = w('bridge', 'top', [[1, 1], [2, 1]]);
    expect(wireUsable(wire, 'single')).not.toBeNull();
    expect(conductingHoles(wire, 'single')).toEqual([]);
    expect(wireUsable(wire, 'double')).toBeNull();
  });
});

describe('nearMissHoles', () => {
  it('真上を通らない斜め線の近くの穴を検出する', () => {
    // (0,0)→(3,1): (1,0) は線から 1/√10≈0.32 の距離
    const near = nearMissHoles(w('bare', 'bottom', [[0, 0], [3, 1]]));
    expect(keys(near)).toContain('1,0');
    expect(keys(near)).not.toContain('0,0');
  });
  it('水平線や被覆線は対象外', () => {
    expect(nearMissHoles(w('bare', 'bottom', [[0, 0], [3, 0]]))).toEqual([]);
    expect(nearMissHoles(w('insulated', 'bottom', [[0, 0], [3, 1]]))).toEqual([]);
  });
});
