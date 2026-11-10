import { isAdjacent, wireUsable } from '../logic/conduction';
import { getFootprint } from '../library/footprints';
import { holeKey, inBoard, localToTop, nextRot } from '../logic/geometry';
import { checkGroupPlacement, checkPlacement } from '../logic/placement';
import { DEFAULT_WIRE_COLORS, makePart, newId } from '../model/project';
import type { Store, Tool } from '../model/store';
import type { Hole, Part, Placement, Side, Wire, WireKind } from '../model/types';

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

/** 手元の部品を 1 つ作って配置する */
export function placePart(store: Store, footprint: string, pl: Placement): boolean {
  if (!getFootprint(footprint)) return false;
  const part = makePart(store.project.parts, footprint);
  const r = checkPlacement(store.project, part, pl);
  if (!r.ok) {
    store.setMessage(r.errors[0].replace(part.ref, getFootprint(footprint)!.name), 'error');
    return false;
  }
  part.placement = pl;
  store.update((p) => {
    p.parts.push(part);
  });
  store.setUi({ selParts: [part.id], selWires: [], tool: 'select' });
  store.setMessage(
    (r.warnings[0] ? `${r.warnings[0]}。` : `${part.ref} を配置しました。`) + (store.ui.placing ? '続けて配置できます（Esc で終了）' : ''),
  );
  return true;
}

export function startPlacing(store: Store, footprint: string): void {
  store.setUi({ placing: { footprint, rot: 0, side: null, hole: null }, tool: 'select', draft: null });
  store.setMessage(`${getFootprint(footprint)?.name ?? ''} を置く穴をクリックしてください（続けて何個でも置けます。R で回転、Esc で終了）`);
}

/** 手元と棚の間で部品の種類を移す */
export function toggleHand(store: Store, footprint: string): void {
  const inHand = store.project.hand.includes(footprint);
  store.update((p) => {
    p.hand = inHand ? p.hand.filter((id) => id !== footprint) : [...p.hand, footprint];
  });
  if (inHand && store.ui.placing?.footprint === footprint) store.setUi({ placing: null });
}

/** ピンヘッダ等の長さ（ピン数）と原点を変える */
export function resizedPart(part: Part, count: number, shift: number): Part {
  const pl = part.placement!;
  const [x, y] = localToTop(pl, shift, 0);
  return { ...part, params: { ...part.params, count }, placement: { ...pl, x: Math.round(x), y: Math.round(y) } };
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
    p.parts = p.parts.filter((part) => !selParts.includes(part.id));
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

/** 水平・垂直にそろえる（orthogonal が true のとき。Shift を押している間） */
export function constrain(from: Hole, to: Hole, orthogonal: boolean): Hole {
  if (!orthogonal) return to;
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
  store.setMessage(`${TOOL_LABELS[kind]}を追加しました（導通する穴 ${n} 個）。次のクリックで新しい配線を始めます`);
}

/**
 * 配線ツールで穴をクリックしたとき。
 * 1 回目のクリックで始点、2 回目のクリックで終点を決めて 1 本の配線を作る。
 * 次のクリックは新しい配線の始点になる（終点から続けない）。
 */
export function wireClick(store: Store, side: Side, hole: Hole, orthogonal: boolean): void {
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
        : '終点の穴をクリックすると配線を作ります（斜めも可。Shift で水平・垂直にそろえる、Esc で中止）',
    );
    return;
  }
  const last = d.points[d.points.length - 1];
  if (kind === 'bridge') {
    if (isAdjacent(last, hole)) addWire(store, kind, side, [last, hole]);
    else store.setUi({ draft: { ...d, points: [hole], cursor: hole } }, 'view');
    return;
  }
  const end = constrain(last, hole, orthogonal);
  if (end[0] === last[0] && end[1] === last[1]) return;
  if (!inBoard(b, end[0], end[1])) return;
  addWire(store, kind, side, [last, end]);
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
