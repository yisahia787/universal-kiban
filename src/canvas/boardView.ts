import { getFootprint, RESIZE_MAX, RESIZE_MIN } from '../library/footprints';
import { holeKey, inBoard, localToTop, partGeometry, pinsAt, topToLocal, viewX } from '../logic/geometry';
import { makePart } from '../model/project';
import { checkGroupPlacement, checkPlacement } from '../logic/placement';
import type { Camera, Store } from '../model/store';
import type { Hole, Part, Placement, Side } from '../model/types';
import { cancel, constrain, netClick, placePart, resizedPart, toggleDisabledHole, wireClick } from '../ui/actions';
import { keys } from '../ui/keys';
import { esc, marginP, marginYP, renderBoard, renderDraft, renderHandles, renderPart, renderWire } from './render';

const SVGNS = 'http://www.w3.org/2000/svg';
let uidCounter = 0;

export type ViewMode = 'design' | 'board-edit';

type Drag =
  | { type: 'pan'; lastX: number; lastY: number }
  | {
      type: 'move';
      start: Hole;
      parts: Map<string, Placement>;
      wires: Map<string, Hole[]>;
      moved: boolean;
    }
  | { type: 'vertex'; wireId: string; index: number; orig: Hole[] }
  | { type: 'resize'; partId: string; end: 'start' | 'end'; orig: Part }
  | { type: 'band'; start: [number, number]; cur: [number, number]; additive: boolean };

/** 1 つの面を表示・編集するビュー */
export class BoardView {
  readonly el: HTMLDivElement;
  private svg: SVGSVGElement;
  private uid = `v${uidCounter++}`;
  private drag: Drag | null = null;
  private ro: ResizeObserver;

  constructor(
    private store: Store,
    public side: Side,
    private mode: ViewMode = 'design',
  ) {
    this.el = document.createElement('div');
    this.el.className = 'board-view';
    this.svg = document.createElementNS(SVGNS, 'svg') as SVGSVGElement;
    this.el.appendChild(this.svg);
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.el);
    this.bindEvents();
  }

  destroy(): void {
    this.ro.disconnect();
    this.el.remove();
  }

  // ---- 座標変換 ----

  private viewPoint(e: { clientX: number; clientY: number }): [number, number] {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [pt.x, pt.y];
  }

  /** ビュー座標 → 部品面から見た座標（小数） */
  private toTop(v: [number, number]): [number, number] {
    const b = this.store.project.board;
    return [this.side === 'top' ? v[0] : b.cols - 1 - v[0], v[1]];
  }

  private holeAt(e: { clientX: number; clientY: number }): Hole {
    const [x, y] = this.toTop(this.viewPoint(e));
    return [Math.round(x), Math.round(y)];
  }

  fitCamera(): Camera {
    const b = this.store.project.board;
    const m = marginP(b) + 1.6;
    const my = marginYP(b) + 1.6;
    const w = Math.max(this.el.clientWidth, 100);
    const h = Math.max(this.el.clientHeight, 100);
    const zoom = Math.min(w / (b.cols - 1 + 2 * m), h / (b.rows - 1 + 2 * my + 0.8));
    return { cx: (b.cols - 1) / 2, cy: (b.rows - 1) / 2 + 0.2, zoom };
  }

  private camera(): Camera {
    if (!this.store.ui.camera) this.store.ui.camera = this.fitCamera();
    return this.store.ui.camera;
  }

  private setCamera(c: Camera): void {
    this.store.setUi({ camera: c }, 'view');
  }

  // ---- イベント ----

  private bindEvents(): void {
    const svg = this.svg;
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    svg.addEventListener('pointerdown', (e) => this.onDown(e));
    svg.addEventListener('pointermove', (e) => this.onMove(e));
    svg.addEventListener('pointerup', (e) => this.onUp(e));
    svg.addEventListener('pointerleave', () => {
      if (!this.drag) this.store.setUi({ hover: null }, 'view');
    });
    svg.addEventListener('dragover', (e) => {
      if (this.mode !== 'design' || !dragFootprint || !e.dataTransfer?.types.includes(DND_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const hole = this.holeAt(e);
      const pl = this.store.ui.placing;
      if (!pl || pl.footprint !== dragFootprint || pl.side !== this.side || pl.hole?.[0] !== hole[0] || pl.hole?.[1] !== hole[1]) {
        this.store.setUi({ placing: { footprint: dragFootprint, rot: pl?.rot ?? 0, side: this.side, hole } }, 'view');
      }
    });
    svg.addEventListener('drop', (e) => {
      const fp = e.dataTransfer?.getData(DND_TYPE);
      if (!fp) return;
      e.preventDefault();
      const hole = this.holeAt(e);
      const rot = this.store.ui.placing?.rot ?? 0;
      this.store.setUi({ placing: null }, 'view');
      placePart(this.store, fp, { side: this.side, x: hole[0], y: hole[1], rot });
    });
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const cam = this.camera();
    const factor = Math.exp(-e.deltaY * 0.0015);
    const zoom = Math.min(200, Math.max(2, cam.zoom * factor));
    const [px, py] = this.toTop(this.viewPoint(e));
    const k = cam.zoom / zoom;
    this.setCamera({ zoom, cx: px - (px - cam.cx) * k, cy: py - (py - cam.cy) * k });
  }

  private onDown(e: PointerEvent): void {
    const store = this.store;
    this.svg.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || keys.space) {
      this.drag = { type: 'pan', lastX: e.clientX, lastY: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    const hole = this.holeAt(e);
    const b = store.project.board;

    if (this.mode === 'board-edit') {
      if (inBoard(b, hole[0], hole[1])) toggleDisabledHole(store, hole);
      return;
    }
    // 基板の外をクリックしたら、配線中・配置中の操作を取りやめる
    if (!inBoard(b, hole[0], hole[1]) && (store.ui.draft || store.ui.placing)) {
      cancel(store);
      store.setMessage('取りやめました');
      return;
    }
    if (store.ui.placing) {
      const pl = store.ui.placing;
      placePart(store, pl.footprint, { side: this.side, x: hole[0], y: hole[1], rot: pl.rot });
      return;
    }
    const tool = store.ui.tool;
    if (tool === 'bare' || tool === 'bridge' || tool === 'insulated') {
      wireClick(store, this.side, hole, e.shiftKey);
      return;
    }
    if (tool === 'net') {
      netClick(store, hole);
      return;
    }

    // 選択ツール
    const target = e.target as Element;
    const rh = target.closest('[data-resize]');
    if (rh) {
      const part = store.project.parts.find((p) => p.id === rh.getAttribute('data-resize-part'));
      if (part?.placement) {
        store.begin();
        this.drag = { type: 'resize', partId: part.id, end: rh.getAttribute('data-resize') as 'start' | 'end', orig: structuredClone(part) };
        return;
      }
    }
    const handle = target.closest('[data-wire-handle]');
    if (handle) {
      const wireId = handle.getAttribute('data-wire-handle')!;
      const w = store.project.wires.find((ww) => ww.id === wireId)!;
      store.begin();
      this.drag = { type: 'vertex', wireId, index: Number(handle.getAttribute('data-handle')), orig: w.points.map((p) => [...p] as Hole) };
      return;
    }
    const partEl = target.closest('[data-part]');
    const wireEl = target.closest('[data-wire]');
    if (partEl || wireEl) {
      const id = (partEl ?? wireEl)!.getAttribute(partEl ? 'data-part' : 'data-wire')!;
      const list = partEl ? 'selParts' : 'selWires';
      const selected = store.ui[list].includes(id);
      if (e.shiftKey) {
        const next = selected ? store.ui[list].filter((x) => x !== id) : [...store.ui[list], id];
        store.setUi({ [list]: next });
        return;
      }
      if (!selected) store.setUi(partEl ? { selParts: [id], selWires: [] } : { selParts: [], selWires: [id] });
      const parts = new Map<string, Placement>();
      for (const p of store.project.parts) if (store.ui.selParts.includes(p.id) && p.placement) parts.set(p.id, { ...p.placement });
      const wires = new Map<string, Hole[]>();
      for (const w of store.project.wires) if (store.ui.selWires.includes(w.id)) wires.set(w.id, w.points.map((p) => [...p] as Hole));
      store.begin();
      this.drag = { type: 'move', start: hole, parts, wires, moved: false };
      return;
    }
    const v = this.viewPoint(e);
    this.drag = { type: 'band', start: v, cur: v, additive: e.shiftKey };
    if (!e.shiftKey && (store.ui.selParts.length || store.ui.selWires.length)) store.setUi({ selParts: [], selWires: [] });
  }

  private onMove(e: PointerEvent): void {
    const store = this.store;
    const hole = this.holeAt(e);
    const d = this.drag;
    if (d?.type === 'pan') {
      const cam = this.camera();
      const dx = (e.clientX - d.lastX) / cam.zoom;
      const dy = (e.clientY - d.lastY) / cam.zoom;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      this.setCamera({ ...cam, cx: cam.cx - (this.side === 'top' ? dx : -dx), cy: cam.cy - dy });
      return;
    }
    if (d?.type === 'move') {
      const dx = hole[0] - d.start[0];
      const dy = hole[1] - d.start[1];
      d.moved = d.moved || dx !== 0 || dy !== 0;
      store.live((p) => {
        for (const part of p.parts) {
          const o = d.parts.get(part.id);
          if (o) part.placement = { ...o, x: o.x + dx, y: o.y + dy };
        }
        for (const w of p.wires) {
          const o = d.wires.get(w.id);
          if (o) w.points = o.map(([x, y]) => [x + dx, y + dy]);
        }
      });
    } else if (d?.type === 'resize') {
      const pl = d.orig.placement!;
      const count0 = Number(d.orig.params.count) || 1;
      const [lx] = topToLocal(pl, ...this.toTop(this.viewPoint(e)));
      let next: Part;
      if (d.end === 'end') {
        const count = Math.max(RESIZE_MIN, Math.min(RESIZE_MAX, Math.round(lx) + 1));
        next = resizedPart(d.orig, count, 0);
      } else {
        const shift = Math.max(count0 - RESIZE_MAX, Math.min(count0 - RESIZE_MIN, Math.round(lx)));
        next = resizedPart(d.orig, count0 - shift, shift);
      }
      store.live((p) => {
        const i = p.parts.findIndex((pp) => pp.id === d.partId);
        if (i >= 0) p.parts[i] = next;
      });
    } else if (d?.type === 'vertex') {
      store.live((p) => {
        const w = p.wires.find((ww) => ww.id === d.wireId);
        if (w) w.points = d.orig.map((pt, i) => (i === d.index ? hole : pt));
      });
    } else if (d?.type === 'band') {
      d.cur = this.viewPoint(e);
    }
    const draft = store.ui.draft;
    const cursor = draft && draft.side === this.side && draft.kind !== 'bridge' ? constrain(draft.points[draft.points.length - 1], hole, e.shiftKey) : hole;
    const prevHover = store.ui.hover;
    const placing = store.ui.placing;
    const patch: Partial<typeof store.ui> = {};
    if (!prevHover || prevHover[0] !== hole[0] || prevHover[1] !== hole[1]) patch.hover = hole;
    if (draft && draft.side === this.side) patch.draft = { ...draft, cursor };
    if (placing && (placing.side !== this.side || placing.hole?.[0] !== hole[0] || placing.hole?.[1] !== hole[1])) {
      patch.placing = { ...placing, side: this.side, hole };
    }
    if (Object.keys(patch).length || d?.type === 'band') store.setUi(patch, 'view');
  }

  private onUp(e: PointerEvent): void {
    const store = this.store;
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.type === 'move') {
      if (!d.moved) {
        store.rollback();
        this.maybeEditPin(e);
        return;
      }
      const p = store.project;
      const moves = p.parts.filter((pp) => d.parts.has(pp.id)).map((part) => ({ part, pl: part.placement! }));
      const r = checkGroupPlacement(p, moves);
      const wireOut = p.wires.some((w) => d.wires.has(w.id) && w.points.some(([x, y]) => !inBoard(p.board, x, y)));
      if (!r.ok || wireOut) {
        store.rollback();
        store.setMessage(`移動できません: ${r.errors[0] ?? '配線が基板の外に出ます'}`, 'error');
      } else {
        store.commit();
        if (r.warnings.length) store.setMessage(r.warnings[0]);
      }
    } else if (d.type === 'resize') {
      const part = store.project.parts.find((p) => p.id === d.partId);
      const r = part?.placement ? checkPlacement(store.project, part, part.placement) : null;
      if (!r?.ok) {
        store.rollback();
        if (r) store.setMessage(`長さを変えられません: ${r.errors[0]}`, 'error');
      } else {
        store.commit();
        store.setMessage(`${part!.ref} のピン数: ${part!.params.count}`);
      }
    } else if (d.type === 'vertex') {
      const w = store.project.wires.find((ww) => ww.id === d.wireId);
      const pts = w?.points ?? [];
      const out = pts.some(([x, y]) => !inBoard(store.project.board, x, y));
      const badBridge = w?.kind === 'bridge' && !(Math.abs(pts[0][0] - pts[1][0]) + Math.abs(pts[0][1] - pts[1][1]) === 1);
      const dup = pts.some((pt, i) => i > 0 && pt[0] === pts[i - 1][0] && pt[1] === pts[i - 1][1]);
      if (out || badBridge || dup) {
        store.rollback();
        if (out || badBridge) store.setMessage(out ? '基板の外には置けません' : 'はんだブリッジは隣り合う穴同士だけです', 'error');
      } else store.commit();
    } else if (d.type === 'band') {
      this.finishBand(d);
    }
  }

  /** ピンの位置をクリックしたら、ピン名の編集欄を開く（反対面の部品のピンも対象） */
  private maybeEditPin(e: { clientX: number; clientY: number; viewPoint?: [number, number] }): void {
    if (this.mode !== 'design' || this.store.ui.tool !== 'select') return;
    const [tx, ty] = this.toTop(e.viewPoint ?? this.viewPoint(e));
    const hole: Hole = [Math.round(tx), Math.round(ty)];
    if (Math.hypot(tx - hole[0], ty - hole[1]) > 0.32) return;
    const pin = this.store.analysis.pinsByHole.get(holeKey(hole[0], hole[1]))?.[0];
    if (pin) this.openPinEditor(pin.partId, pin.num, hole);
  }

  openPinEditor(partId: string, num: string, hole: Hole): void {
    const store = this.store;
    const part = store.project.parts.find((p) => p.id === partId);
    if (!part) return;
    this.el.querySelector('.pin-editor')?.remove();
    const defName = partGeometry({ ...part, pinNames: undefined }).pins.find((p) => p.num === num)?.name ?? '';
    const current = part.pinNames?.[num] ?? defName;
    const box = document.createElement('form');
    box.className = 'pin-editor';
    box.innerHTML = `<label>${esc(part.ref)}.${esc(num)} のピン名</label><input type="text" value="${esc(current)}" placeholder="${esc(defName || '名前なし')}">`;
    // 穴の位置に表示
    const b = store.project.board;
    const ctm = this.svg.getScreenCTM();
    const rect = this.el.getBoundingClientRect();
    if (ctm) {
      const pt = new DOMPoint(viewX(b, this.side, hole[0]) + 0.6, hole[1] - 0.6).matrixTransform(ctm);
      box.style.left = `${Math.min(pt.x - rect.left, rect.width - 190)}px`;
      box.style.top = `${Math.max(4, pt.y - rect.top - 30)}px`;
    }
    this.el.appendChild(box);
    const input = box.querySelector('input')!;
    input.focus();
    input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      box.remove();
      const v = input.value.trim();
      if (!save || v === current) return;
      store.update((p) => {
        const pp = p.parts.find((x) => x.id === partId);
        if (!pp) return;
        const names = { ...(pp.pinNames ?? {}) };
        if (v === defName) delete names[num];
        else names[num] = v;
        pp.pinNames = Object.keys(names).length ? names : undefined;
      });
      store.setMessage(`${part.ref}.${num} のピン名を「${v || '（なし）'}」にしました`);
    };
    box.addEventListener('submit', (ev) => {
      ev.preventDefault();
      finish(true);
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  private finishBand(d: Extract<Drag, { type: 'band' }>): void {
    const store = this.store;
    const [ax, ay] = this.toTop(d.start);
    const [bx, by] = this.toTop(d.cur);
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    const y0 = Math.min(ay, by);
    const y1 = Math.max(ay, by);
    if (x1 - x0 < 0.3 && y1 - y0 < 0.3) {
      store.emit('view');
      this.maybeEditPin({ clientX: 0, clientY: 0, viewPoint: d.cur });
      return;
    }
    const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const parts = store.project.parts
      .filter((p) => p.placement?.side === this.side && pinsAt(p, p.placement).every((pin) => inside(pin.x, pin.y)))
      .map((p) => p.id);
    const wires = store.project.wires.filter((w) => w.side === this.side && w.points.every(([x, y]) => inside(x, y))).map((w) => w.id);
    store.setUi({
      selParts: d.additive ? [...new Set([...store.ui.selParts, ...parts])] : parts,
      selWires: d.additive ? [...new Set([...store.ui.selWires, ...wires])] : wires,
    });
  }

  // ---- 描画 ----

  render(): void {
    const store = this.store;
    const b = store.project.board;
    const ui = store.ui;
    const a = store.analysis;
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (w === 0 || h === 0) return;
    const cam = this.camera();
    const vcx = viewX(b, this.side, cam.cx);
    this.svg.setAttribute('viewBox', `${vcx - w / 2 / cam.zoom} ${cam.cy - h / 2 / cam.zoom} ${w / cam.zoom} ${h / cam.zoom}`);
    this.svg.setAttribute('class', `side-${this.side} tool-${ui.tool}${ui.placing ? ' placing' : ''}`);

    const layers = ui.layers;
    const showParts = (s: Side) => (s === 'top' ? layers.topParts : layers.bottomParts);
    const showWires = (s: Side) => (s === 'top' ? layers.topWires : layers.bottomWires);
    const design = this.mode === 'design';

    const netId = ui.netHole ? a.netOfHole.get(holeKey(ui.netHole[0], ui.netHole[1])) : undefined;
    const net = netId ? a.nets.get(netId) : undefined;

    let s = renderBoard(b, this.side, this.uid, layers.coords);

    const drawParts = (opposite: boolean) => {
      for (const part of store.project.parts) {
        const pl = part.placement;
        if (!pl || (pl.side !== this.side) !== opposite || !showParts(pl.side)) continue;
        s += renderPart(b, part, pl, partGeometry(part), this.side, {
          opposite,
          selected: !opposite && ui.selParts.includes(part.id),
          state: a.badParts.has(part.id) ? 'bad' : a.warnParts.has(part.id) ? 'warn' : 'ok',
          labels: layers.labels,
        });
      }
    };
    const drawWires = (opposite: boolean) => {
      for (const wire of store.project.wires) {
        if ((wire.side !== this.side) !== opposite || !showWires(wire.side)) continue;
        s += renderWire(b, wire, this.side, {
          opposite,
          selected: !opposite && ui.selWires.includes(wire.id),
          bad: a.badWires.has(wire.id),
          netHighlight: !!net?.wires.has(wire.id),
          conducting: a.wireHoles.get(wire.id) ?? [],
        });
      }
    };

    if (design) {
      if (layers.opposite) {
        s += '<g class="opposite-layer">';
        drawParts(true);
        drawWires(true);
        s += '</g>';
      }
      drawParts(false);
      drawWires(false);

      // 選択中の配線の編集ハンドル
      if (ui.tool === 'select' && ui.selWires.length === 1 && ui.selParts.length === 0) {
        const wire = store.project.wires.find((ww) => ww.id === ui.selWires[0]);
        if (wire && wire.side === this.side) s += renderHandles(b, wire, this.side);
      }
      // ピンヘッダ等の長さ変更ハンドル
      if (ui.tool === 'select' && ui.selParts.length === 1 && ui.selWires.length === 0) {
        const part = store.project.parts.find((p) => p.id === ui.selParts[0]);
        const pl = part?.placement;
        if (part && pl && pl.side === this.side && getFootprint(part.footprint)?.resizable) {
          const count = Number(part.params.count) || 1;
          const rows = Number(part.params.rows) === 2 ? 2 : 1;
          const cy = (rows - 1) / 2;
          for (const [end, lx] of [['start', -0.75], ['end', count - 0.25]] as const) {
            const [tx, ty] = localToTop(pl, lx, cy);
            const horiz = pl.rot === 0 || pl.rot === 180;
            s += `<rect class="resize-handle${horiz ? ' h' : ' v'}" data-resize="${end}" data-resize-part="${part.id}" x="${viewX(b, this.side, tx) - 0.22}" y="${ty - 0.4}" width="0.44" height="0.8" rx="0.12" transform="rotate(${horiz ? 0 : 90} ${viewX(b, this.side, tx)} ${ty})"/>`;
          }
        }
      }
      // ネットのハイライト
      if (net) {
        s += '<g class="net-holes">';
        for (const k of net.holes) {
          const [x, y] = k.split(',').map(Number);
          s += `<circle cx="${viewX(b, this.side, x)}" cy="${y}" r="0.42"/>`;
        }
        s += '</g>';
      }
      // 配置中の部品（ゴースト）
      const pl = ui.placing;
      if (pl && pl.side === this.side && pl.hole) {
        const part = getFootprint(pl.footprint) ? makePart(store.project.parts, pl.footprint) : null;
        if (part) {
          const placement: Placement = { side: this.side, x: pl.hole[0], y: pl.hole[1], rot: pl.rot };
          const r = checkPlacement(store.project, part, placement);
          s += renderPart(b, part, placement, partGeometry(part), this.side, {
            opposite: false,
            selected: false,
            state: r.ok ? (r.warnings.length ? 'warn' : 'ok') : 'bad',
            ghost: true,
            labels: false,
          });
        }
      }
      // 配線中の下書き
      const d = ui.draft;
      if (d && d.side === this.side) {
        const pts = d.cursor && d.kind !== 'bridge' ? [...d.points, d.cursor] : d.points;
        s += renderDraft(b, this.side, pts, d.kind, d.kind === 'insulated' ? ui.wireColor : '#4b535d');
      }
    }

    // カーソル位置（両方のビューに表示）
    if (ui.hover && inBoard(b, ui.hover[0], ui.hover[1])) {
      const hx = viewX(b, this.side, ui.hover[0]);
      const hy = ui.hover[1];
      s += `<circle class="hover" cx="${hx}" cy="${hy}" r="0.45"/>`;
      // ピンの情報（どちらの面の部品でも表示する）
      const pins = design && !this.drag ? a.pinsByHole.get(holeKey(ui.hover[0], ui.hover[1])) : undefined;
      if (pins?.length) {
        const lines = pins.map((p) => {
          const part = store.project.parts.find((pp) => pp.id === p.partId);
          const side = part?.placement?.side === this.side ? '' : '（反対面）';
          return `${part?.ref ?? '?'}.${p.num}${p.name ? ` ${p.name}` : ''}${side}`;
        });
        const fs = 13 / cam.zoom;
        const w = Math.max(...lines.map((l) => [...l].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 1 : 0.6), 0))) * fs + fs;
        const h = lines.length * fs * 1.35 + fs * 0.5;
        const x = hx + 0.55;
        const y = hy - 0.55 - h;
        s += `<g class="pin-tip"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${fs * 0.3}"/>${lines
          .map((l, i) => `<text x="${x + fs * 0.5}" y="${y + fs * (1.15 + i * 1.35)}" style="font-size:${fs}px">${esc(l)}</text>`)
          .join('')}</g>`;
      }
    }
    // 範囲選択の枠
    if (this.drag?.type === 'band') {
      const [ax, ay] = this.drag.start;
      const [bx, by] = this.drag.cur;
      s += `<rect class="band" x="${Math.min(ax, bx)}" y="${Math.min(ay, by)}" width="${Math.abs(ax - bx)}" height="${Math.abs(ay - by)}"/>`;
    }
    this.svg.innerHTML = s;
  }

  /** 指定の穴群が見えるように移動 */
  focusHoles(holes: Hole[]): void {
    if (!holes.length) return;
    const xs = holes.map((h) => h[0]);
    const ys = holes.map((h) => h[1]);
    const cam = this.camera();
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // すでに見えている場合は動かさない
    const hw = this.el.clientWidth / 2 / cam.zoom - 1;
    const hh = this.el.clientHeight / 2 / cam.zoom - 1;
    if (Math.abs(cx - cam.cx) < hw && Math.abs(cy - cam.cy) < hh) return;
    this.setCamera({ ...cam, cx, cy });
  }
}

/** HTML5 ドラッグ中の部品 ID（dragover では dataTransfer の中身を読めないため） */
export const DND_TYPE = 'application/x-ukb-footprint';
export let dragFootprint: string | null = null;
export const setDragFootprint = (id: string | null): void => {
  dragFootprint = id;
};

