import type { Part, Placement, Project } from '../model/types';
import { boundsAt, holeKey, holeLabel, inBoard, partGeometry, pinsAt, rectsOverlap } from './geometry';

export interface PlacementResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** 外形が重なっている同じ面の部品 ID */
  overlaps: string[];
}

/**
 * 部品を指定位置に置けるか判定する（仕様書 §5.3.3）。
 * ignore に含まれる部品 ID は判定から除く（移動中の部品自身など）。
 */
export function checkPlacement(project: Project, part: Part, pl: Placement, ignore: Set<string> = new Set()): PlacementResult {
  const b = project.board;
  const errors: string[] = [];
  const warnings: string[] = [];
  const overlaps: string[] = [];
  const geo = partGeometry(part);
  const pins = pinsAt(part, pl, geo);
  const disabled = new Set(b.disabledHoles.map(([x, y]) => holeKey(x, y)));

  const occupied = new Map<string, string>();
  for (const other of project.parts) {
    if (other.id === part.id || ignore.has(other.id) || !other.placement) continue;
    for (const p of pinsAt(other, other.placement)) occupied.set(holeKey(p.x, p.y), other.ref);
  }

  for (const p of pins) {
    const lbl = `${part.ref}.${p.num}`;
    if (!inBoard(b, p.x, p.y)) {
      errors.push(`${lbl} が基板の外にはみ出しています`);
      continue;
    }
    const k = holeKey(p.x, p.y);
    if (disabled.has(k)) errors.push(`${lbl} が使用禁止穴 ${holeLabel(p.x, p.y)} に入っています`);
    const o = occupied.get(k);
    if (o) errors.push(`${lbl} が ${o} のピンと同じ穴 ${holeLabel(p.x, p.y)} に入っています`);
  }

  const myBounds = boundsAt(pl, geo.bounds);
  for (const other of project.parts) {
    if (other.id === part.id || ignore.has(other.id) || !other.placement) continue;
    if (other.placement.side !== pl.side) continue;
    const ob = boundsAt(other.placement, partGeometry(other).bounds);
    if (rectsOverlap(myBounds, ob)) {
      warnings.push(`${part.ref} と ${other.ref} の外形が重なっています`);
      overlaps.push(other.id);
    }
  }

  return { ok: errors.length === 0, errors, warnings, overlaps };
}

/** 複数部品をまとめて移動する場合の判定（グループ内同士の重複も見る） */
export function checkGroupPlacement(project: Project, moves: { part: Part; pl: Placement }[]): PlacementResult {
  // 移動後の状態を仮に作って 1 つずつ判定する
  const temp: Project = {
    ...project,
    parts: project.parts.map((p) => {
      const m = moves.find((mm) => mm.part.id === p.id);
      return m ? { ...p, placement: m.pl } : p;
    }),
  };
  const errors: string[] = [];
  const warnings: string[] = [];
  const overlaps: string[] = [];
  for (const m of moves) {
    const r = checkPlacement(temp, m.part, m.pl);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    overlaps.push(...r.overlaps);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], overlaps: [...new Set(overlaps)] };
}
