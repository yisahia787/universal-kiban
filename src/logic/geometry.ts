import { generateFootprint, type FpGeometry, type Rect } from '../library/footprints';
import type { Board, Hole, Part, Placement, Rotation, Side } from '../model/types';

export const holeKey = (x: number, y: number): string => `${x},${y}`;
export const keyToHole = (k: string): Hole => k.split(',').map(Number) as Hole;

/** 列番号 → A, B, …, Z, AA, AB … */
export function colLabel(x: number): string {
  let s = '';
  let n = x + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const holeLabel = (x: number, y: number): string => `${colLabel(x)}${y + 1}`;

export const inBoard = (b: Board, x: number, y: number): boolean => x >= 0 && y >= 0 && x < b.cols && y < b.rows;

/** その面から見たビュー座標の X（はんだ面は左右反転） */
export const viewX = (b: Board, side: Side, x: number): number => (side === 'top' ? x : b.cols - 1 - x);

/** 時計回りの回転（y 軸下向き） */
export function rotate(dx: number, dy: number, rot: Rotation): [number, number] {
  switch (rot) {
    case 90:
      return [-dy, dx];
    case 180:
      return [-dx, -dy];
    case 270:
      return [dy, -dx];
    default:
      return [dx, dy];
  }
}

/** 部品ローカル座標 → 部品面から見た穴座標（小数可） */
export function localToTop(pl: Placement, lx: number, ly: number): [number, number] {
  const [rx, ry] = rotate(lx, ly, pl.rot);
  return [pl.x + (pl.side === 'bottom' ? -rx : rx), pl.y + ry];
}

/** 部品面から見た座標 → 部品ローカル座標（localToTop の逆） */
export function topToLocal(pl: Placement, tx: number, ty: number): [number, number] {
  let dx = tx - pl.x;
  const dy = ty - pl.y;
  if (pl.side === 'bottom') dx = -dx;
  return rotate(dx, dy, ((360 - pl.rot) % 360) as Rotation);
}

export interface PlacedPin {
  partId: string;
  num: string;
  name: string;
  x: number;
  y: number;
}

export function partGeometry(part: Part): FpGeometry {
  return generateFootprint(part.footprint, part.params);
}

export function pinsAt(part: Part, pl: Placement, geo: FpGeometry = partGeometry(part)): PlacedPin[] {
  return geo.pins.map((p) => {
    const [x, y] = localToTop(pl, p.x, p.y);
    return { partId: part.id, num: p.num, name: p.name, x: Math.round(x), y: Math.round(y) };
  });
}

/** 外接矩形を部品面座標に変換 */
export function boundsAt(pl: Placement, r: Rect): Rect {
  const a = localToTop(pl, r.x0, r.y0);
  const b = localToTop(pl, r.x1, r.y1);
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  const eps = 1e-6;
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;
}

export const nextRot = (r: Rotation, dir: 1 | -1): Rotation => (((r + dir * 90 + 360) % 360) as Rotation);

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** 線分の長さ（ピッチ単位） */
export function polylineLength(points: Hole[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return len;
}
