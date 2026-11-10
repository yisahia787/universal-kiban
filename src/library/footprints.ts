import type { ParamValue } from '../model/types';

/** フットプリント上のピン。座標は 1 番ピン（原点）からの相対穴数 */
export interface FpPin {
  num: string;
  name: string;
  x: number;
  y: number;
}

/** 外形の矩形（穴中心が整数座標になる単位系、ピッチ単位） */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type BodyShape =
  | { type: 'rect'; rect: Rect; notch?: boolean }
  | { type: 'axial'; rect: Rect; band?: 'end' }
  | { type: 'circle'; cx: number; cy: number; r: number; flat?: boolean }
  | { type: 'to92'; rect: Rect }
  | { type: 'to220'; rect: Rect };

export interface FpGeometry {
  pins: FpPin[];
  /** 当たり判定・選択に使う外接矩形 */
  bounds: Rect;
  shape: BodyShape;
  /** 部品内部で導通しているピン番号の組（タクトスイッチなど） */
  internal?: string[][];
  /** 極性表示（＋ を表示するピン番号） */
  plusPin?: string;
}

export type ParamSpec =
  | { key: string; label: string; type: 'int'; min: number; max: number; step?: number; default: number }
  | { key: string; label: string; type: 'select'; options: { value: ParamValue; label: string }[]; default: ParamValue }
  | { key: string; label: string; type: 'text'; default: string };

export interface FootprintDef {
  id: string;
  name: string;
  category: string;
  refPrefix: string;
  params: ParamSpec[];
  generate(params: Record<string, ParamValue>): FpGeometry;
}

const num = (p: Record<string, ParamValue>, k: string, d: number): number => {
  const v = Number(p[k]);
  return Number.isFinite(v) ? v : d;
};
const str = (p: Record<string, ParamValue>, k: string, d: string): string =>
  p[k] === undefined || p[k] === '' ? d : String(p[k]);

const pinNames = (text: string, count: number): string[] => {
  const names = text.split(',').map((s) => s.trim());
  return Array.from({ length: count }, (_, i) => names[i] ?? '');
};

const spanParam = (min: number, max: number, def: number): ParamSpec => ({
  key: 'span',
  label: 'リード間隔（穴）',
  type: 'int',
  min,
  max,
  default: def,
});

function axial(span: number, names: [string, string], band: boolean): FpGeometry {
  const half = Math.min(1.25, span / 2 - 0.35);
  const rect = { x0: span / 2 - half, y0: -0.4, x1: span / 2 + half, y1: 0.4 };
  return {
    pins: [
      { num: '1', name: names[0], x: 0, y: 0 },
      { num: '2', name: names[1], x: span, y: 0 },
    ],
    bounds: { x0: -0.3, y0: -0.45, x1: span + 0.3, y1: 0.45 },
    shape: { type: 'axial', rect, band: band ? 'end' : undefined },
  };
}

function radialCircle(span: number, diameterMm: number, names: [string, string]): FpGeometry {
  const r = diameterMm / 2 / 2.54;
  const cx = span / 2;
  return {
    pins: [
      { num: '1', name: names[0], x: 0, y: 0 },
      { num: '2', name: names[1], x: span, y: 0 },
    ],
    bounds: { x0: Math.min(-0.3, cx - r), y0: -r, x1: Math.max(span + 0.3, cx + r), y1: r },
    shape: { type: 'circle', cx, cy: 0, r },
  };
}

export const FOOTPRINTS: FootprintDef[] = [
  {
    id: 'resistor-axial',
    name: '抵抗（アキシャル）',
    category: '受動部品',
    refPrefix: 'R',
    params: [spanParam(3, 10, 4)],
    generate: (p) => axial(num(p, 'span', 4), ['', ''], false),
  },
  {
    id: 'ceramic-cap',
    name: 'セラミックコンデンサ',
    category: '受動部品',
    refPrefix: 'C',
    params: [spanParam(1, 4, 2)],
    generate: (p) => {
      const span = num(p, 'span', 2);
      const rect = { x0: -0.35, y0: -0.55, x1: span + 0.35, y1: 0.3 };
      return {
        pins: [
          { num: '1', name: '', x: 0, y: 0 },
          { num: '2', name: '', x: span, y: 0 },
        ],
        bounds: rect,
        shape: { type: 'rect', rect },
      };
    },
  },
  {
    id: 'electrolytic-cap',
    name: '電解コンデンサ',
    category: '受動部品',
    refPrefix: 'C',
    params: [
      spanParam(1, 4, 1),
      {
        key: 'diameter',
        label: '直径',
        type: 'select',
        options: [4, 5, 6.3, 8, 10, 12.5].map((d) => ({ value: d, label: `φ${d}mm` })),
        default: 5,
      },
    ],
    generate: (p) => {
      const g = radialCircle(num(p, 'span', 1), num(p, 'diameter', 5), ['+', '-']);
      return { ...g, plusPin: '1' };
    },
  },
  {
    id: 'trimmer',
    name: '半固定抵抗（3ピン）',
    category: '受動部品',
    refPrefix: 'VR',
    params: [
      {
        key: 'layout',
        label: 'ピン配置',
        type: 'select',
        options: [
          { value: 'inline', label: '直線' },
          { value: 'triangle', label: '三角' },
        ],
        default: 'inline',
      },
    ],
    generate: (p) => {
      if (str(p, 'layout', 'inline') === 'triangle') {
        const rect = { x0: -0.5, y0: -2.5, x1: 2.5, y1: 0.5 };
        return {
          pins: [
            { num: '1', name: '', x: 0, y: 0 },
            { num: '2', name: 'W', x: 1, y: -2 },
            { num: '3', name: '', x: 2, y: 0 },
          ],
          bounds: rect,
          shape: { type: 'rect', rect },
        };
      }
      const rect = { x0: -0.6, y0: -1.4, x1: 2.6, y1: 0.5 };
      return {
        pins: [
          { num: '1', name: '', x: 0, y: 0 },
          { num: '2', name: 'W', x: 1, y: 0 },
          { num: '3', name: '', x: 2, y: 0 },
        ],
        bounds: rect,
        shape: { type: 'rect', rect },
      };
    },
  },
  {
    id: 'inductor-axial',
    name: 'インダクタ（アキシャル）',
    category: '受動部品',
    refPrefix: 'L',
    params: [spanParam(3, 10, 4)],
    generate: (p) => axial(num(p, 'span', 4), ['', ''], false),
  },
  {
    id: 'inductor-radial',
    name: 'インダクタ（ラジアル）',
    category: '受動部品',
    refPrefix: 'L',
    params: [spanParam(1, 4, 2)],
    generate: (p) => radialCircle(num(p, 'span', 2), 8, ['', '']),
  },
  {
    id: 'diode-axial',
    name: 'ダイオード（アキシャル）',
    category: '半導体',
    refPrefix: 'D',
    params: [spanParam(3, 10, 4)],
    generate: (p) => axial(num(p, 'span', 4), ['A', 'K'], true),
  },
  {
    id: 'led',
    name: 'LED',
    category: '半導体',
    refPrefix: 'LED',
    params: [
      {
        key: 'size',
        label: 'サイズ',
        type: 'select',
        options: [
          { value: 3, label: 'φ3' },
          { value: 5, label: 'φ5' },
        ],
        default: 5,
      },
    ],
    generate: (p) => {
      const g = radialCircle(1, num(p, 'size', 5) + 0.8, ['A', 'K']);
      return { ...g, shape: { ...(g.shape as { type: 'circle'; cx: number; cy: number; r: number }), flat: true }, plusPin: '1' };
    },
  },
  {
    id: 'to92',
    name: 'トランジスタ等（TO-92）',
    category: '半導体',
    refPrefix: 'Q',
    params: [{ key: 'pinNames', label: 'ピン名（カンマ区切り）', type: 'text', default: 'E,B,C' }],
    generate: (p) => {
      const names = pinNames(str(p, 'pinNames', 'E,B,C'), 3);
      const rect = { x0: -0.6, y0: -0.4, x1: 2.6, y1: 0.85 };
      return {
        pins: names.map((name, i) => ({ num: String(i + 1), name, x: i, y: 0 })),
        bounds: rect,
        shape: { type: 'to92', rect },
      };
    },
  },
  {
    id: 'to220',
    name: 'レギュレータ等（TO-220）',
    category: '半導体',
    refPrefix: 'U',
    params: [{ key: 'pinNames', label: 'ピン名（カンマ区切り）', type: 'text', default: 'IN,GND,OUT' }],
    generate: (p) => {
      const names = pinNames(str(p, 'pinNames', 'IN,GND,OUT'), 3);
      const rect = { x0: -0.97, y0: -1.4, x1: 2.97, y1: 0.4 };
      return {
        pins: names.map((name, i) => ({ num: String(i + 1), name, x: i, y: 0 })),
        bounds: rect,
        shape: { type: 'to220', rect },
      };
    },
  },
  {
    id: 'dip',
    name: 'IC（DIP）',
    category: '半導体',
    refPrefix: 'U',
    params: [
      { key: 'pins', label: 'ピン数', type: 'int', min: 4, max: 40, step: 2, default: 8 },
      {
        key: 'rowSpan',
        label: '列の間隔',
        type: 'select',
        options: [
          { value: 3, label: '3 ピッチ（300mil）' },
          { value: 6, label: '6 ピッチ（600mil）' },
          { value: 9, label: '9 ピッチ（900mil）' },
        ],
        default: 3,
      },
      { key: 'pinNames', label: 'ピン名（カンマ区切り）', type: 'text', default: '' },
    ],
    generate: (p) => {
      let n = Math.round(num(p, 'pins', 8));
      if (n % 2) n += 1;
      n = Math.max(4, Math.min(40, n));
      const span = num(p, 'rowSpan', 3);
      const half = n / 2;
      const names = pinNames(str(p, 'pinNames', ''), n);
      const pins: FpPin[] = [];
      for (let i = 0; i < n; i++) {
        const x = i < half ? 0 : span;
        const y = i < half ? i : n - 1 - i;
        pins.push({ num: String(i + 1), name: names[i], x, y });
      }
      const rect = { x0: 0.3, y0: -0.6, x1: span - 0.3, y1: half - 0.4 };
      return {
        pins,
        bounds: { x0: -0.3, y0: -0.6, x1: span + 0.3, y1: half - 0.4 },
        shape: { type: 'rect', rect, notch: true },
      };
    },
  },
  {
    id: 'pin-header',
    name: 'ピンヘッダ',
    category: 'コネクタ等',
    refPrefix: 'J',
    params: [
      {
        key: 'rows',
        label: '列数',
        type: 'select',
        options: [
          { value: 1, label: '1 列' },
          { value: 2, label: '2 列' },
        ],
        default: 1,
      },
      { key: 'count', label: '1 列のピン数', type: 'int', min: 1, max: 40, default: 4 },
      { key: 'pinNames', label: 'ピン名（カンマ区切り）', type: 'text', default: '' },
    ],
    generate: (p) => {
      const rows = num(p, 'rows', 1) === 2 ? 2 : 1;
      const count = Math.max(1, Math.min(40, Math.round(num(p, 'count', 4))));
      const names = pinNames(str(p, 'pinNames', ''), rows * count);
      const pins: FpPin[] = [];
      for (let i = 0; i < count; i++) {
        for (let r = 0; r < rows; r++) {
          const idx = i * rows + r;
          pins.push({ num: String(idx + 1), name: names[idx], x: i, y: r });
        }
      }
      const rect = { x0: -0.5, y0: -0.5, x1: count - 0.5, y1: rows - 0.5 };
      return { pins, bounds: rect, shape: { type: 'rect', rect } };
    },
  },
  {
    id: 'terminal-block',
    name: '端子台',
    category: 'コネクタ等',
    refPrefix: 'CN',
    params: [
      { key: 'count', label: '極数', type: 'int', min: 2, max: 12, default: 2 },
      {
        key: 'step',
        label: 'ピッチ',
        type: 'select',
        options: [
          { value: 1, label: '2.54mm' },
          { value: 2, label: '5.08mm' },
        ],
        default: 2,
      },
    ],
    generate: (p) => {
      const count = Math.max(2, Math.min(12, Math.round(num(p, 'count', 2))));
      const step = num(p, 'step', 2) === 1 ? 1 : 2;
      const pins = Array.from({ length: count }, (_, i) => ({ num: String(i + 1), name: '', x: i * step, y: 0 }));
      const last = (count - 1) * step;
      const rect = { x0: -step / 2 - 0.1, y0: -1.3, x1: last + step / 2 + 0.1, y1: 1.3 };
      return { pins, bounds: rect, shape: { type: 'rect', rect } };
    },
  },
  {
    id: 'tact-switch',
    name: 'タクトスイッチ（4ピン）',
    category: 'コネクタ等',
    refPrefix: 'SW',
    params: [],
    generate: () => {
      const rect = { x0: -0.35, y0: -0.35, x1: 3.35, y1: 2.35 };
      return {
        pins: [
          { num: '1', name: '', x: 0, y: 0 },
          { num: '2', name: '', x: 3, y: 0 },
          { num: '3', name: '', x: 0, y: 2 },
          { num: '4', name: '', x: 3, y: 2 },
        ],
        bounds: rect,
        shape: { type: 'rect', rect },
        internal: [
          ['1', '2'],
          ['3', '4'],
        ],
      };
    },
  },
  {
    id: 'test-pin',
    name: 'テストピン（1ピン）',
    category: 'コネクタ等',
    refPrefix: 'TP',
    params: [],
    generate: () => {
      const rect = { x0: -0.4, y0: -0.4, x1: 0.4, y1: 0.4 };
      return { pins: [{ num: '1', name: '', x: 0, y: 0 }], bounds: rect, shape: { type: 'circle', cx: 0, cy: 0, r: 0.4 } };
    },
  },
];

const byId = new Map(FOOTPRINTS.map((f) => [f.id, f]));

export function getFootprint(id: string): FootprintDef | undefined {
  return byId.get(id);
}

export function defaultParams(def: FootprintDef): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

const UNKNOWN: FpGeometry = {
  pins: [{ num: '1', name: '', x: 0, y: 0 }],
  bounds: { x0: -0.4, y0: -0.4, x1: 0.4, y1: 0.4 },
  shape: { type: 'rect', rect: { x0: -0.4, y0: -0.4, x1: 0.4, y1: 0.4 } },
};

export function generateFootprint(id: string, params: Record<string, ParamValue>): FpGeometry {
  const def = byId.get(id);
  if (!def) return UNKNOWN;
  return def.generate({ ...defaultParams(def), ...params });
}
