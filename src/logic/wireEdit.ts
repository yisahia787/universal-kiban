import type { Hole, Wire } from '../model/types';
import { gcd } from './geometry';

type Seg = [Hole, Hole];

/** 線分 s を、新しい線分 n の向き（格子 1 ステップ単位）の数直線上の区間で表す。同じ直線上でなければ null */
function intervalOn(n: Seg, s: Seg): [number, number] | null {
  const [a, b] = n;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const g = gcd(dx, dy);
  if (g === 0) return null;
  const ux = dx / g;
  const uy = dy / g;
  const onLine = (p: Hole) => (p[0] - a[0]) * uy - (p[1] - a[1]) * ux === 0;
  if (!onLine(s[0]) || !onLine(s[1])) return null;
  const t = (p: Hole) => ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / (ux * ux + uy * uy);
  const t0 = t(s[0]);
  const t1 = t(s[1]);
  return [Math.min(t0, t1), Math.max(t0, t1)];
}

const segsOf = (w: Wire): Seg[] => w.points.slice(1).map((p, i) => [w.points[i], p]);

/**
 * 同じ種類・同じ面の既存の配線に完全に重なる位置に配線したとき、重なった部分を削除する。
 * 新しい線分全体が既存の配線で覆われている場合だけ削除として扱い、結果の配線一覧を返す。
 * 覆われていなければ null（通常どおり配線を追加する）。
 */
export function eraseOverlap(wires: Wire[], next: Pick<Wire, 'kind' | 'side' | 'points'>, newId: () => string): Wire[] | null {
  if (next.points.length !== 2) return null;
  const n: Seg = [next.points[0], next.points[1]];
  const len = gcd(n[1][0] - n[0][0], n[1][1] - n[0][1]);
  if (len === 0) return null;
  const same = wires.filter((w) => w.kind === next.kind && w.side === next.side);

  // 新しい線分 [0, len] が既存の配線の区間で覆われているか
  const intervals: [number, number][] = [];
  for (const w of same) for (const s of segsOf(w)) {
    const iv = intervalOn(n, s);
    if (iv && iv[1] > 0 && iv[0] < len) intervals.push(iv);
  }
  intervals.sort((p, q) => p[0] - q[0]);
  let reach = 0;
  for (const [s0, s1] of intervals) {
    if (s0 > reach) break;
    reach = Math.max(reach, s1);
  }
  if (reach < len) return null;

  // 覆っていた配線から [0, len] の部分を取り除く
  const ux = (n[1][0] - n[0][0]) / len;
  const uy = (n[1][1] - n[0][1]) / len;
  const at = (t: number): Hole => [n[0][0] + ux * t, n[0][1] + uy * t];
  const out: Wire[] = [];
  for (const w of wires) {
    if (!same.includes(w)) {
      out.push(w);
      continue;
    }
    let changed = false;
    const remain: Seg[] = [];
    for (const s of segsOf(w)) {
      const iv = intervalOn(n, s);
      if (!iv || iv[1] <= 0 || iv[0] >= len) {
        remain.push(s);
        continue;
      }
      changed = true;
      // 元の線分の向きを保って、残る部分を作る
      const t0 = iv[0];
      const t1 = iv[1];
      const forward = intervalOn(n, [s[0], s[0]])![0] === t0;
      const pieces: [number, number][] = [];
      if (t0 < 0) pieces.push([t0, 0]);
      if (t1 > len) pieces.push([len, t1]);
      const segs = pieces.map(([p, q]) => [at(p), at(q)] as Seg);
      if (!forward) segs.reverse().forEach((sg) => sg.reverse());
      remain.push(...segs);
    }
    if (!changed) {
      out.push(w);
      continue;
    }
    // つながっている線分ごとに配線をまとめ直す
    const groups: Hole[][] = [];
    for (const [p, q] of remain) {
      const g = groups[groups.length - 1];
      const last = g?.[g.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) g.push(q);
      else groups.push([p, q]);
    }
    groups.forEach((points, i) => out.push({ ...w, id: i === 0 ? w.id : newId(), points }));
  }
  return out;
}
