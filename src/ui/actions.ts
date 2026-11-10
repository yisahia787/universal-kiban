import { isAdjacent, wireUsable } from '../logic/conduction';
import { holeKey, inBoard, nextRot } from '../logic/geometry';
import { checkGroupPlacement, checkPlacement } from '../logic/placement';
import { DEFAULT_WIRE_COLORS, newId } from '../model/project';
import type { Store, Tool } from '../model/store';
import type { Hole, Placement, Side, Wire, WireKind } from '../model/types';

export const TOOL_LABELS: Record<Tool, string> = {
  select: '選択・移動',
  bare: 'すずめっき線',
  bridge: 'はんだブリッジ',
  insulated: '被覆線',
  net: 'ネット表示',
};

export function setTool(store: Store, tool: Tool): void {
  store.setUi({ tool, draft: null, placing: null });
}

export function placePart(store: Store, partId: string, pl: Placement): boolean {
  const part = store.project.parts.find((p) => p.id === partId);
  if (!part) return false;
  const r = checkPlacement(store.project, part, pl);
  if (!r.ok) {
    store.setMessage(r.errors[0], 'error');
    return false;
  }
  store.update((p) => {
    p.parts.find((pp) => pp.id === partId)!.placement = pl;
  });
  store.setUi({ placing: null, selParts: [partId], selWires: [], tool: 'select' });
  store.setMessage(r.warnings[0] ?? `${part.ref} を配置しました`, 'info');
  return true;
}

export function startPlacing(store: Store, partId: string): void {
  store.setUi({ placing: { partId, rot: 0, side: null, hole: null }, tool: 'select', draft: null });
  const part = store.project.parts.find((p) => p.id === partId);
  store.setMessage(`${part?.ref ?? ''} を置く穴をクリックしてください（R で回転、Esc で中止）`);
}

function transformSelection(store: Store, fn: (pl: Placement) => Placement, verb: string): void {
  const { selParts } = store.ui;
  const parts = store.project.parts.filter((p) => selParts.includes(p.id) && p.placement);
  if (parts.length === 0) return;
  const moves = parts.map((part) => ({ part, pl: fn(part.placement!) }));
  const r = checkGroupPlacement(store.project, moves);
  if (!r.ok) {
    store.setMessage(`${verb}できません: ${r.errors[0]}`, 'error');
    return;
  }
  store.update((p) => {
    for (const m of moves) p.parts.find((pp) => pp.id === m.part.id)!.placement = m.pl;
  });
  if (r.warnings.length) store.setMessage(r.warnings[0]);
}

export function rotateSelection(store: Store, dir: 1 | -1): void {
  if (store.ui.placing) {
    store.setUi({ placing: { ...store.ui.placing, rot: nextRot(store.ui.placing.rot, dir) } }, 'view');
    return;
  }
  transformSelection(store, (pl) => ({ ...pl, rot: nextRot(pl.rot, dir) }), '回転');
}

export function flipSelection(store: Store): void {
  transformSelection(store, (pl) => ({ ...pl, side: pl.side === 'top' ? 'bottom' : 'top' }), '反対面へ移動');
}

export function deleteSelection(store: Store): void {
  const { selParts, selWires } = store.ui;
  if (!selParts.length && !selWires.length) return;
  store.update((p) => {
    for (const part of p.parts) if (selParts.includes(part.id)) part.placement = null;
    p.wires = p.wires.filter((w) => !selWires.includes(w.id));
  });
  store.setUi({ selParts: [], selWires: [] });
}

export function cancel(store: Store): void {
  if (store.ui.draft) store.setUi({ draft: null }, 'view');
  else if (store.ui.placing) store.setUi({ placing: null });
  else if (store.ui.netHole) store.setUi({ netHole: null });
  else store.setUi({ selParts: [], selWires: [] });
  store.setUi({ message: null }, 'view');
}

const toolKind = (tool: Tool): WireKind | null => (tool === 'bare' || tool === 'bridge' || tool === 'insulated' ? tool : null);

/** 直交拘束（Shift を押していない場合、水平または垂直にそろえる） */
export function constrain(from: Hole, to: Hole, free: boolean): Hole {
  if (free) return to;
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  return dx >= dy ? [to[0], from[1]] : [from[0], to[1]];
}

function addWire(store: Store, kind: WireKind, side: Side, points: Hole[]): void {
  const clean: Hole[] = [];
  for (const p of points) {
    const last = clean[clean.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) clean.push(p);
  }
  if (clean.length < 2) {
    store.setUi({ draft: null }, 'view');
    return;
  }
  const color = kind === 'insulated' ? store.ui.wireColor : DEFAULT_WIRE_COLORS[kind];
  const wire: Wire = { id: newId('w'), kind, side, color, points: clean };
  store.update((p) => {
    p.wires.push(wire);
  });
  store.setUi({ draft: null }, 'view');
  const n = store.analysis.wireHoles.get(wire.id)?.length ?? 0;
  store.setMessage(`${TOOL_LABELS[kind]}を追加しました（導通する穴 ${n} 個）`);
}

/** 配線ツールで穴をクリックしたとき */
export function wireClick(store: Store, side: Side, hole: Hole, free: boolean): void {
  const kind = toolKind(store.ui.tool);
  if (!kind) return;
  const b = store.project.board;
  if (!inBoard(b, hole[0], hole[1])) return;
  const usable = wireUsable({ kind, side }, b.type);
  if (usable) {
    store.setMessage(usable, 'error');
    return;
  }
  const d = store.ui.draft;
  if (!d || d.side !== side) {
    store.setUi({ draft: { kind, side, points: [hole], cursor: hole } }, 'view');
    store.setMessage(
      kind === 'bridge'
        ? '隣の穴をクリックするとブリッジを作ります'
        : '折れ点の穴をクリック、終点でダブルクリックまたは Enter で確定（Shift で斜め、Esc で中止）',
    );
    return;
  }
  const last = d.points[d.points.length - 1];
  if (kind === 'bridge') {
    if (isAdjacent(last, hole)) addWire(store, kind, side, [last, hole]);
    else store.setUi({ draft: { ...d, points: [hole], cursor: hole } }, 'view');
    return;
  }
  const next = constrain(last, hole, free);
  if (next[0] === last[0] && next[1] === last[1]) return;
  store.setUi({ draft: { ...d, points: [...d.points, next], cursor: next } }, 'view');
}

export function finishDraft(store: Store): void {
  const d = store.ui.draft;
  if (!d || d.kind === 'bridge') return;
  addWire(store, d.kind, d.side, d.points);
}

export function netClick(store: Store, hole: Hole): void {
  const has = store.analysis.netOfHole.has(holeKey(hole[0], hole[1]));
  store.setUi({ netHole: has ? hole : null });
  if (!has) store.setMessage('この穴には何も接続されていません');
}

export function toggleDisabledHole(store: Store, hole: Hole): void {
  store.update((p) => {
    const i = p.board.disabledHoles.findIndex(([x, y]) => x === hole[0] && y === hole[1]);
    if (i >= 0) p.board.disabledHoles.splice(i, 1);
    else p.board.disabledHoles.push(hole);
  });
}
