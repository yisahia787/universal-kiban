import type { BoardType, Hole, Wire } from '../model/types';
import { gcd } from './geometry';

/** 線分 a→b 上にちょうど乗っている格子点（両端を含む） */
export function latticePointsOnSegment(a: Hole, b: Hole): Hole[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const g = gcd(dx, dy);
  if (g === 0) return [[a[0], a[1]]];
  const sx = dx / g;
  const sy = dy / g;
  const out: Hole[] = [];
  for (let i = 0; i <= g; i++) out.push([a[0] + sx * i, a[1] + sy * i]);
  return out;
}

/** 配線材が使えるかどうか（使えない場合は理由を返す） */
export function wireUsable(wire: Pick<Wire, 'kind' | 'side'>, boardType: BoardType): string | null {
  if (wire.kind === 'bridge' && wire.side === 'top' && boardType === 'single') {
    return '片面基板の部品面にはランドがないため、はんだブリッジは使えません';
  }
  return null;
}

export function isAdjacent(a: Hole, b: Hole): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
}

/**
 * 配線材が導通する穴の一覧（仕様書 §5.4.3）
 * - すずめっき線: 始点・終点・折れ点、および中心の真上を通る穴
 *   （片面基板の部品面では、差し込んだ点＝始点・終点・折れ点のみ）
 * - はんだブリッジ: 両端の 2 穴
 * - 被覆線: 始点・終点のみ
 */
export function conductingHoles(wire: Wire, boardType: BoardType): Hole[] {
  const pts = wire.points;
  if (pts.length === 0) return [];
  if (wireUsable(wire, boardType)) return [];
  if (wire.kind === 'insulated' || wire.kind === 'bridge') {
    return pts.length === 1 ? [pts[0]] : [pts[0], pts[pts.length - 1]];
  }
  // bare
  if (wire.side === 'top' && boardType === 'single') return dedupe(pts);
  const out: Hole[] = [];
  for (let i = 1; i < pts.length; i++) out.push(...latticePointsOnSegment(pts[i - 1], pts[i]));
  if (pts.length === 1) out.push(pts[0]);
  return dedupe(out);
}

function dedupe(holes: Hole[]): Hole[] {
  const seen = new Set<string>();
  const out: Hole[] = [];
  for (const h of holes) {
    const k = `${h[0]},${h[1]}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push([h[0], h[1]]);
    }
  }
  return out;
}

/**
 * 斜めのすずめっき線が、真上ではないが穴の中心の近く（threshold ピッチ未満）を通る穴。
 * ランドに触れるおそれがある箇所として警告に使う。
 */
export function nearMissHoles(wire: Wire, threshold = 0.35): Hole[] {
  if (wire.kind !== 'bare') return [];
  const out: Hole[] = [];
  const pts = wire.points;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 || dy === 0) continue;
    const len = Math.hypot(dx, dy);
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
        const cross = Math.abs((x - ax) * dy - (y - ay) * dx);
        if (cross === 0) continue; // 真上（導通）
        const dist = cross / len;
        if (dist < threshold) out.push([x, y]);
      }
    }
  }
  return dedupe(out);
}
