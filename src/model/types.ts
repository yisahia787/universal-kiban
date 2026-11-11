/** 面。座標は常に部品面（top）から見た穴座標で持つ */
export type Side = 'top' | 'bottom';

/** 穴のグリッド座標 [x, y]（0 始まり、部品面から見た位置） */
export type Hole = [number, number];

export type BoardType = 'single' | 'double';

export interface Board {
  preset?: string;
  cols: number;
  rows: number;
  pitchMm: number;
  marginMm: number;
  type: BoardType;
  disabledHoles: Hole[];
  /** 取付穴。基板の左上の角（部品面から見て）からの位置 mm と直径 mm */
  mountingHoles?: MountingHole[];
}

export interface MountingHole {
  xMm: number;
  yMm: number;
  dMm: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface Placement {
  side: Side;
  x: number;
  y: number;
  /** その面から見た時計回りの回転 */
  rot: Rotation;
}

export type ParamValue = number | string;

export interface Part {
  id: string;
  ref: string;
  footprint: string;
  params: Record<string, ParamValue>;
  value: string;
  note: string;
  /** ピン番号ごとにユーザーが付けたピン名（フットプリントの既定名より優先） */
  pinNames?: Record<string, string>;
  /** 旧形式との互換のため null を許すが、現在は常に配置済み */
  placement: Placement | null;
}

export type WireKind = 'bare' | 'bridge' | 'insulated';

export interface Wire {
  id: string;
  kind: WireKind;
  side: Side;
  color: string;
  points: Hole[];
}

export interface NamedNet {
  name: string;
  anchor: Hole;
}

export interface ProjectMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
  note: string;
}

export interface Project {
  format: 'universal-kiban';
  version: 1;
  meta: ProjectMeta;
  board: Board;
  /** 手元に置いた部品の種類（フットプリント ID）。個数は持たない */
  hand: string[];
  /** 配置した部品。配置するたびに 1 つ作られる */
  parts: Part[];
  wires: Wire[];
  nets: NamedNet[];
}
