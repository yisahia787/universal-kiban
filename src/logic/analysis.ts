import type { Hole, Project } from '../model/types';
import { conductingHoles, nearMissHoles, wireUsable } from './conduction';
import { holeKey, holeLabel, inBoard, partGeometry, pinsAt, type PlacedPin } from './geometry';
import { checkPlacement } from './placement';

export class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a);
    if (p === undefined) {
      this.parent.set(a, a);
      return a;
    }
    if (p === a) return a;
    p = this.find(p);
    this.parent.set(a, p);
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface Net {
  id: string;
  name?: string;
  holes: Set<string>;
  pins: PlacedPin[];
  wires: Set<string>;
}

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  message: string;
  holes: Hole[];
  partId?: string;
  wireId?: string;
}

export interface Analysis {
  pinsByHole: Map<string, PlacedPin[]>;
  pinsByPart: Map<string, PlacedPin[]>;
  /** 穴キー → ネット ID（何かが接続している穴のみ） */
  netOfHole: Map<string, string>;
  nets: Map<string, Net>;
  /** 配線 ID → 導通する穴 */
  wireHoles: Map<string, Hole[]>;
  issues: Issue[];
  /** 配置エラーのある部品 ID */
  badParts: Set<string>;
  warnParts: Set<string>;
  badWires: Set<string>;
}

export function analyze(project: Project): Analysis {
  const b = project.board;
  const uf = new UnionFind();
  const pinsByHole = new Map<string, PlacedPin[]>();
  const pinsByPart = new Map<string, PlacedPin[]>();
  const issues: Issue[] = [];
  const badParts = new Set<string>();
  const warnParts = new Set<string>();
  const badWires = new Set<string>();

  for (const part of project.parts) {
    if (!part.placement) continue;
    const geo = partGeometry(part);
    const pins = pinsAt(part, part.placement, geo);
    pinsByPart.set(part.id, pins);
    for (const p of pins) {
      const k = holeKey(p.x, p.y);
      uf.find(k);
      const arr = pinsByHole.get(k) ?? [];
      arr.push(p);
      pinsByHole.set(k, arr);
    }
    for (const group of geo.internal ?? []) {
      const hs = group.map((n) => pins.find((p) => p.num === n)).filter((p): p is PlacedPin => !!p);
      for (let i = 1; i < hs.length; i++) uf.union(holeKey(hs[0].x, hs[0].y), holeKey(hs[i].x, hs[i].y));
    }
    const r = checkPlacement(project, part, part.placement);
    const holes = pins.map((p) => [p.x, p.y] as Hole);
    for (const e of r.errors) issues.push({ severity: 'error', message: e, holes, partId: part.id });
    for (const otherId of r.overlaps) {
      if (otherId < part.id) continue; // 同じ組み合わせを 2 回報告しない
      const other = project.parts.find((pp) => pp.id === otherId)!;
      issues.push({ severity: 'warning', message: `${part.ref} と ${other.ref} の外形が重なっています`, holes, partId: part.id });
    }
    if (!r.ok) badParts.add(part.id);
    else if (r.overlaps.length) warnParts.add(part.id);
  }

  const wireHoles = new Map<string, Hole[]>();
  for (const w of project.wires) {
    const why = wireUsable(w, b.type);
    if (why) {
      issues.push({ severity: 'error', message: why, holes: w.points, wireId: w.id });
      badWires.add(w.id);
    }
    if (w.points.some(([x, y]) => !inBoard(b, x, y))) {
      issues.push({ severity: 'error', message: '配線が基板の外にはみ出しています', holes: w.points, wireId: w.id });
      badWires.add(w.id);
    }
    const hs = conductingHoles(w, b.type).filter(([x, y]) => inBoard(b, x, y));
    wireHoles.set(w.id, hs);
    for (let i = 0; i < hs.length; i++) {
      uf.find(holeKey(hs[i][0], hs[i][1]));
      if (i > 0) uf.union(holeKey(hs[0][0], hs[0][1]), holeKey(hs[i][0], hs[i][1]));
    }
    const near = nearMissHoles(w);
    if (near.length) {
      issues.push({
        severity: 'warning',
        message: `すずめっき線が ${near.map(([x, y]) => holeLabel(x, y)).join(', ')} の近くを通っています（真上ではないため導通しませんが、ランドに触れるおそれがあります）`,
        holes: near,
        wireId: w.id,
      });
    }
  }

  // ネットを組み立てる
  const nets = new Map<string, Net>();
  const netOfHole = new Map<string, string>();
  const getNet = (k: string): Net => {
    const root = uf.find(k);
    netOfHole.set(k, root);
    let n = nets.get(root);
    if (!n) {
      n = { id: root, holes: new Set(), pins: [], wires: new Set() };
      nets.set(root, n);
    }
    n.holes.add(k);
    return n;
  };
  for (const [k, pins] of pinsByHole) getNet(k).pins.push(...pins);
  for (const [id, hs] of wireHoles) for (const [x, y] of hs) getNet(holeKey(x, y)).wires.add(id);

  // ネット名の割り当て
  for (const nn of project.nets) {
    const k = holeKey(nn.anchor[0], nn.anchor[1]);
    const id = netOfHole.get(k);
    if (!id) continue;
    const net = nets.get(id)!;
    if (net.name && net.name !== nn.name) {
      issues.push({
        severity: 'error',
        message: `名前の違うネット「${net.name}」と「${nn.name}」がつながっています`,
        holes: [...net.holes].map((h) => h.split(',').map(Number) as Hole),
      });
    } else net.name = nn.name;
  }

  // 未接続ピン（C1）
  for (const [, pins] of pinsByPart) {
    for (const p of pins) {
      const net = nets.get(netOfHole.get(holeKey(p.x, p.y))!);
      if (!net) continue;
      if (net.wires.size === 0 && net.pins.length <= 1 && net.holes.size <= 1) {
        const part = project.parts.find((pp) => pp.id === p.partId);
        issues.push({
          severity: 'warning',
          message: `${part?.ref ?? '?'}.${p.num}${p.name ? `（${p.name}）` : ''} はどこにも接続されていません`,
          holes: [[p.x, p.y]],
          partId: p.partId,
        });
      }
    }
  }

  return { pinsByHole, pinsByPart, netOfHole, nets, wireHoles, issues, badParts, warnParts, badWires };
}
