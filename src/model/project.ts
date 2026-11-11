import { defaultParams, getFootprint } from '../library/footprints';
import { getPreset, holesBlockedByMounting, PRESETS } from '../library/presets';
import type { Board, Part, Project, Wire } from './types';

export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultBoard(): Board {
  const p = PRESETS[0];
  const b = { cols: p.cols, rows: p.rows, pitchMm: 2.54, marginMm: p.marginMm };
  return { preset: p.id, ...b, type: p.type, mountingHoles: p.mountingHoles, disabledHoles: holesBlockedByMounting(b, p.mountingHoles) };
}

export function createProject(name = '新しいプロジェクト'): Project {
  const now = new Date().toISOString();
  return {
    format: 'universal-kiban',
    version: 1,
    meta: { name, createdAt: now, updatedAt: now, note: '' },
    board: defaultBoard(),
    hand: [],
    parts: [],
    wires: [],
    nets: [],
  };
}

/** 接頭辞ごとに未使用の最小番号で Ref を作る */
export function nextRef(parts: Part[], prefix: string): string {
  const used = new Set(parts.map((p) => p.ref));
  for (let i = 1; ; i++) {
    const r = `${prefix}${i}`;
    if (!used.has(r)) return r;
  }
}

export function makePart(parts: Part[], footprintId: string, params?: Part['params'], value = ''): Part {
  const def = getFootprint(footprintId);
  if (!def) throw new Error(`unknown footprint ${footprintId}`);
  return {
    id: newId('p'),
    ref: nextRef(parts, def.refPrefix),
    footprint: footprintId,
    params: { ...defaultParams(def), ...(params ?? {}) },
    value,
    note: '',
    placement: null,
  };
}

export const DEFAULT_WIRE_COLORS: Record<Wire['kind'], string> = {
  bare: '#b8bcc2',
  bridge: '#8d939b',
  insulated: '#d33b3b',
};

/** 読み込んだ JSON を検証・補完してプロジェクトにする */
export function parseProject(text: string): Project {
  const raw = JSON.parse(text);
  if (!raw || raw.format !== 'universal-kiban') throw new Error('universal-kiban のプロジェクトファイルではありません');
  if (raw.version !== 1) throw new Error(`未対応のファイル形式バージョンです: ${raw.version}`);
  const base = createProject();
  const board: Board = { ...base.board, ...(raw.board ?? {}) };
  if (board.preset && !getPreset(board.preset)) delete board.preset;
  const allParts: Part[] = Array.isArray(raw.parts) ? raw.parts : [];
  // 手元: 保存されていなければ、部品に使われている種類から作る（旧形式の互換）
  const handSrc: string[] = Array.isArray(raw.hand) ? raw.hand : allParts.map((p) => p.footprint);
  const hand = [...new Set(handSrc)].filter((id) => getFootprint(id));
  return {
    ...base,
    meta: { ...base.meta, ...(raw.meta ?? {}) },
    board,
    hand,
    // 旧形式の未配置部品は手元に移したので捨てる
    parts: allParts.filter((p) => p.placement),
    wires: Array.isArray(raw.wires) ? raw.wires : [],
    nets: Array.isArray(raw.nets) ? raw.nets : [],
  };
}
