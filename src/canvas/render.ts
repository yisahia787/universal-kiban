import { defaultParams, generateFootprint, getFootprint, type BodyShape, type FpGeometry } from '../library/footprints';
import type { Board, Hole, Part, Placement, Side, Wire } from '../model/types';
import { parseResistance, resistorBands } from '../logic/colorCode';
import { colLabel, localToTop, viewX } from '../logic/geometry';

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const f = (n: number): string => (Math.round(n * 1000) / 1000).toString();

export const marginP = (b: Board): number => b.marginMm / b.pitchMm;
export const marginYP = (b: Board): number => (b.marginYMm ?? b.marginMm) / b.pitchMm;

/** 基板・穴・座標ラベル */
export function renderBoard(b: Board, side: Side, uid: string, coords: boolean): string {
  const m = marginP(b);
  const my = marginYP(b);
  const hasLand = side === 'bottom' || b.type === 'double';
  const pat = hasLand
    ? `<circle cx="0.5" cy="0.5" r="0.34" class="land"/><circle cx="0.5" cy="0.5" r="0.15" class="hole"/>`
    : `<circle cx="0.5" cy="0.5" r="0.17" class="hole-ring"/><circle cx="0.5" cy="0.5" r="0.15" class="hole"/>`;
  let s = `<defs><pattern id="hp-${uid}" x="-0.5" y="-0.5" width="1" height="1" patternUnits="userSpaceOnUse">${pat}</pattern></defs>`;
  s += `<rect class="board board-${side}" x="${f(-m)}" y="${f(-my)}" width="${f(b.cols - 1 + 2 * m)}" height="${f(b.rows - 1 + 2 * my)}" rx="0.3"/>`;
  s += `<rect x="-0.5" y="-0.5" width="${b.cols}" height="${b.rows}" fill="url(#hp-${uid})"/>`;
  for (const mh of b.mountingHoles ?? []) {
    const cx = mh.xMm / b.pitchMm - m;
    const vx = side === 'top' ? cx : b.cols - 1 - cx;
    s += `<circle class="mounting-hole" cx="${f(vx)}" cy="${f(mh.yMm / b.pitchMm - my)}" r="${f(mh.dMm / 2 / b.pitchMm)}"/>`;
  }
  for (const [x, y] of b.disabledHoles) {
    const vx = viewX(b, side, x);
    s += `<g class="disabled-hole"><path d="M${f(vx - 0.3)} ${f(y - 0.3)}L${f(vx + 0.3)} ${f(y + 0.3)}M${f(vx + 0.3)} ${f(y - 0.3)}L${f(vx - 0.3)} ${f(y + 0.3)}"/></g>`;
  }
  if (coords) {
    s += '<g class="coord-label">';
    for (let x = 0; x < b.cols; x++) s += `<text x="${viewX(b, side, x)}" y="${f(-my - 0.45)}">${colLabel(x)}</text>`;
    for (let y = 0; y < b.rows; y++) s += `<text x="${f(-m - 0.6)}" y="${f(y + 0.17)}" text-anchor="end">${y + 1}</text>`;
    s += '</g>';
  }
  s += `<text class="side-label" x="${f(b.cols - 1 + m)}" y="${f(b.rows - 1 + my + 0.9)}" text-anchor="end">${side === 'top' ? '部品面（表）から見た図' : 'はんだ面（裏）から見た図・左右反転'}</text>`;
  return s;
}

/** 部品ローカル座標 → ビュー座標への SVG transform */
export function partTransform(b: Board, pl: Placement, viewSide: Side): string {
  const vx = viewX(b, viewSide, pl.x);
  const mirror = pl.side !== viewSide ? ' scale(-1,1)' : '';
  return `translate(${vx} ${pl.y})${mirror} rotate(${pl.rot})`;
}

function shapeSvg(shape: BodyShape, footprint: string): string {
  const cls = `body body-${footprint}`;
  switch (shape.type) {
    case 'rect': {
      const r = shape.rect;
      let s = `<rect class="${cls}" x="${f(r.x0)}" y="${f(r.y0)}" width="${f(r.x1 - r.x0)}" height="${f(r.y1 - r.y0)}" rx="0.08"/>`;
      if (shape.notch) {
        const cx = (r.x0 + r.x1) / 2;
        s += `<path class="notch" d="M${f(cx - 0.3)} ${f(r.y0)} A0.3 0.3 0 0 0 ${f(cx + 0.3)} ${f(r.y0)}"/>`;
      }
      return s;
    }
    case 'axial': {
      const r = shape.rect;
      let s = `<rect class="${cls}" x="${f(r.x0)}" y="${f(r.y0)}" width="${f(r.x1 - r.x0)}" height="${f(r.y1 - r.y0)}" rx="0.3"/>`;
      if (shape.band) s += `<rect class="band" x="${f(r.x1 - 0.45)}" y="${f(r.y0)}" width="0.22" height="${f(r.y1 - r.y0)}"/>`;
      return s;
    }
    case 'circle': {
      let s = `<circle class="${cls}" cx="${f(shape.cx)}" cy="${f(shape.cy)}" r="${f(shape.r)}"/>`;
      if (shape.flat) s += `<line class="flat" x1="${f(shape.cx + shape.r * 0.8)}" y1="${f(-shape.r * 0.6)}" x2="${f(shape.cx + shape.r * 0.8)}" y2="${f(shape.r * 0.6)}"/>`;
      return s;
    }
    case 'to92': {
      const r = shape.rect;
      return `<path class="${cls}" d="M${f(r.x0)} ${f(r.y0)} L${f(r.x1)} ${f(r.y0)} L${f(r.x1)} ${f(r.y0 + 0.4)} Q${f((r.x0 + r.x1) / 2)} ${f(r.y1 + 0.5)} ${f(r.x0)} ${f(r.y0 + 0.4)} Z"/>`;
    }
    case 'to220': {
      const r = shape.rect;
      return `<rect class="${cls}" x="${f(r.x0)}" y="${f(r.y0)}" width="${f(r.x1 - r.x0)}" height="${f(r.y1 - r.y0)}"/><rect class="tab" x="${f(r.x0)}" y="${f(r.y0)}" width="${f(r.x1 - r.x0)}" height="0.35"/>`;
    }
    case 'xh': {
      const r = shape.rect;
      const w = shape.wall;
      // 外形（実寸）と内側の壁。ロック用の切り欠きはピン中心から 3.4mm 側
      return `<rect class="${cls}" x="${f(r.x0)}" y="${f(r.y0)}" width="${f(r.x1 - r.x0)}" height="${f(r.y1 - r.y0)}" rx="0.04"/>
        <rect class="xh-inner" x="${f(r.x0 + w)}" y="${f(r.y0 + w)}" width="${f(r.x1 - r.x0 - 2 * w)}" height="${f(r.y1 - r.y0 - 2 * w)}"/>
        <rect class="xh-slot" x="${f(r.x0 + w * 2)}" y="${f(r.y1 - w)}" width="${f(w * 1.6)}" height="${f(w)}"/>
        <rect class="xh-slot" x="${f(r.x1 - w * 3.6)}" y="${f(r.y1 - w)}" width="${f(w * 1.6)}" height="${f(w)}"/>`;
    }
    case 'outline': {
      const r = shape.rect;
      return `<rect class="outline" x="${f(r.x0)}" y="${f(r.y0)}" width="${f(r.x1 - r.x0)}" height="${f(r.y1 - r.y0)}" rx="0.15"/>`;
    }
    case 'text':
      return `<text class="fp-text" x="${f(shape.x)}" y="${f(shape.y)}">${esc(shape.text)}</text>`;
    case 'multi':
      return shape.shapes.map((sh) => shapeSvg(sh, footprint)).join('');
  }
}

/** 抵抗のカラーコードの帯（値から決める） */
function resistorBandsSvg(shape: BodyShape, value: string): string {
  if (shape.type !== 'axial') return '';
  const ohms = parseResistance(value);
  const bands = ohms ? resistorBands(ohms) : null;
  if (!bands) return '';
  const r = shape.rect;
  const w = r.x1 - r.x0;
  const bw = w * 0.085;
  const xs = bands.length === 4 ? [0.17, 0.31, 0.45, 0.8] : [0.14, 0.26, 0.38, 0.5, 0.8];
  return bands
    .map((c, i) => `<rect class="cband" x="${f(r.x0 + w * xs[i] - bw / 2)}" y="${f(r.y0 + 0.02)}" width="${f(bw)}" height="${f(r.y1 - r.y0 - 0.04)}" style="fill:${c}"/>`)
    .join('');
}

export interface PartRenderOpts {
  opposite: boolean;
  selected: boolean;
  state: 'ok' | 'warn' | 'bad';
  ghost?: boolean;
  /** 部品棚のアイコン用（操作対象にしない） */
  icon?: boolean;
  labels: boolean;
}

/** 部品の描画（本体 + ピン）。ラベルは読みやすいよう反転させずに別に描く */
export function renderPart(b: Board, part: Part, pl: Placement, geo: FpGeometry, viewSide: Side, o: PartRenderOpts): string {
  const classes = ['part', `fp-${part.footprint}`, `state-${o.state}`];
  if (o.opposite) classes.push('opposite');
  if (o.selected) classes.push('selected');
  if (o.ghost) classes.push('ghost');
  const data = o.opposite || o.ghost || o.icon ? '' : ` data-part="${esc(part.id)}"`;
  let s = `<g class="${classes.join(' ')}"${data}><g transform="${partTransform(b, pl, viewSide)}">`;
  s += shapeSvg(geo.shape, part.footprint);
  if (part.footprint === 'resistor-axial') s += resistorBandsSvg(geo.shape, part.value);
  for (const p of geo.pins) {
    s += p.num === '1' || p.num.endsWith('-1')
      ? `<rect class="pin pin1" x="${f(p.x - 0.2)}" y="${f(p.y - 0.2)}" width="0.4" height="0.4"/>`
      : `<circle class="pin" cx="${f(p.x)}" cy="${f(p.y)}" r="0.2"/>`;
  }
  if (geo.plusPin) {
    const pp = geo.pins.find((p) => p.num === geo.plusPin);
    if (pp) s += `<g class="plus" transform="translate(${f(pp.x)} ${f(pp.y - 0.62)}) rotate(${-pl.rot})"><path d="M-0.18 0H0.18M0 -0.18V0.18"/></g>`;
  }
  s += '</g>';
  // 常に表示するピン名（ESP32 用ソケットなど）。読めるよう反転させずに描く
  if (!o.icon && geo.pins.some((p) => p.labelDir)) {
    s += '<g class="pin-names">';
    for (const p of geo.pins) {
      if (!p.labelDir) continue;
      const name = part.pinNames?.[p.num] ?? p.name;
      if (!name) continue;
      const [px, py] = localToTop(pl, p.x, p.y);
      const [lx, ly] = localToTop(pl, p.x + p.labelDir * 0.42, p.y);
      const vpx = viewX(b, viewSide, px);
      const vlx = viewX(b, viewSide, lx);
      const anchor = vlx - vpx > 0.1 ? 'start' : vlx - vpx < -0.1 ? 'end' : 'middle';
      const dy = anchor === 'middle' ? (ly > py ? 0.45 : -0.25) : 0.13;
      s += `<text x="${f(vlx)}" y="${f(ly + dy)}" text-anchor="${anchor}">${esc(name)}</text>`;
    }
    s += '</g>';
  }
  if (o.labels && !o.ghost) {
    const r = geo.bounds;
    const [cx, cy] = localToTop(pl, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
    let vx = viewX(b, viewSide, cx);
    let vy = cy + 0.15;
    let anchor = '';
    // アキシャル部品（抵抗のカラーコードなど）は本体を隠さないよう、ラベルを本体の外に出す
    if (geo.shape.type === 'axial') {
      if (pl.rot === 0 || pl.rot === 180) vy -= 0.75;
      else {
        vx += 0.6;
        anchor = ' text-anchor="start"';
      }
    }
    const text = part.value ? `${part.ref} ${part.value}` : part.ref;
    s += `<text class="part-label" x="${f(vx)}" y="${f(vy)}"${anchor}>${esc(text)}</text>`;
  }
  s += '</g>';
  return s;
}

const pts = (b: Board, side: Side, points: Hole[]): string => points.map(([x, y]) => `${viewX(b, side, x)},${y}`).join(' ');

export interface WireRenderOpts {
  opposite: boolean;
  selected: boolean;
  bad: boolean;
  netHighlight: boolean;
  conducting: Hole[];
}

export function renderWire(b: Board, w: Wire, viewSide: Side, o: WireRenderOpts): string {
  const p = pts(b, viewSide, w.points);
  const classes = ['wire', `wire-${w.kind}`];
  if (o.opposite) classes.push('opposite');
  if (o.selected) classes.push('selected');
  if (o.bad) classes.push('bad');
  if (o.netHighlight) classes.push('net-hl');
  let s = `<g class="${classes.join(' ')}"${o.opposite ? '' : ` data-wire="${esc(w.id)}"`}>`;
  if (o.selected || o.netHighlight) s += `<polyline class="halo" points="${p}"/>`;
  if (w.kind !== 'bridge') s += `<polyline class="outline" points="${p}"/>`;
  // 色を選べるのは被覆線だけ。すずめっき線・ブリッジは見やすい既定の色で描く
  s += w.kind === 'insulated' ? `<polyline class="core" points="${p}" style="stroke:${esc(w.color)}"/>` : `<polyline class="core" points="${p}"/>`;
  if (!o.opposite && w.kind !== 'bridge') {
    for (const [x, y] of o.conducting) s += `<circle class="solder" cx="${viewX(b, viewSide, x)}" cy="${y}" r="0.17"/>`;
  }
  if (!o.opposite) s += `<polyline class="hit" points="${p}"/>`;
  s += '</g>';
  return s;
}

export function renderHandles(b: Board, w: Wire, viewSide: Side): string {
  return w.points
    .map(([x, y], i) => `<circle class="handle" data-handle="${i}" data-wire-handle="${esc(w.id)}" cx="${viewX(b, viewSide, x)}" cy="${y}" r="0.24"/>`)
    .join('');
}

export function renderDraft(b: Board, side: Side, points: Hole[], kind: Wire['kind'], color: string): string {
  if (points.length === 0) return '';
  const p = pts(b, side, points);
  const ends = points.map(([x, y]) => `<circle cx="${viewX(b, side, x)}" cy="${y}" r="0.15"/>`).join('');
  return `<g class="draft draft-${kind}"><polyline points="${p}" style="stroke:${esc(color)}"/>${ends}</g>`;
}

/** 部品棚・手元に並べるイメージ（既定パラメータの部品を部品面から見た図） */
export function renderFootprintIcon(footprint: string): string {
  const def = getFootprint(footprint);
  const params = def ? defaultParams(def) : {};
  const geo = generateFootprint(footprint, params);
  const r = geo.bounds;
  const pad = 0.35;
  const x0 = Math.min(r.x0, ...geo.pins.map((p) => p.x - 0.3)) - pad;
  const y0 = Math.min(r.y0, ...geo.pins.map((p) => p.y - 0.3), geo.plusPin ? -0.9 : 0) - pad;
  const x1 = Math.max(r.x1, ...geo.pins.map((p) => p.x + 0.3)) + pad;
  const y1 = Math.max(r.y1, ...geo.pins.map((p) => p.y + 0.3)) + pad;
  // 小さい部品が大きく見えすぎないよう、最小の表示範囲をとる
  const w = Math.max(x1 - x0, 4);
  const h = Math.max(y1 - y0, 2.4);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const board: Board = { cols: 1, rows: 1, pitchMm: 2.54, marginMm: 0, type: 'single', disabledHoles: [] };
  const part: Part = { id: '', ref: '', footprint, params, value: '', note: '', placement: null };
  const body = renderPart(board, part, { side: 'top', x: 0, y: 0, rot: 0 }, geo, 'top', {
    opposite: false,
    selected: false,
    state: 'ok',
    labels: false,
    icon: true,
  });
  return `<svg class="fp-icon" viewBox="${f(cx - w / 2)} ${f(cy - h / 2)} ${f(w)} ${f(h)}" aria-hidden="true">${body}</svg>`;
}
