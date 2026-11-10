import { analyze, type Analysis } from '../logic/analysis';
import { createProject, parseProject } from './project';
import type { Hole, Project, Rotation, Side, WireKind } from './types';

export type Tab = 'board' | 'parts' | 'design' | 'check';
export type Tool = 'select' | 'bare' | 'bridge' | 'insulated' | 'net';
export type Layout = 'lr' | 'tb' | 'overlay';

export interface Camera {
  /** 中心（部品面から見た穴座標） */
  cx: number;
  cy: number;
  /** 1 ピッチあたりのピクセル数 */
  zoom: number;
}

export interface Layers {
  topParts: boolean;
  topWires: boolean;
  bottomParts: boolean;
  bottomWires: boolean;
  opposite: boolean;
  labels: boolean;
  coords: boolean;
}

export interface UiState {
  tab: Tab;
  tool: Tool;
  layout: Layout;
  overlaySide: Side;
  layers: Layers;
  selParts: string[];
  selWires: string[];
  hover: Hole | null;
  camera: Camera | null;
  /** ネット表示の基準となる穴 */
  netHole: Hole | null;
  /** 手元の部品を配置中（クリックするたびに 1 つ置く） */
  placing: { footprint: string; rot: Rotation; side: Side | null; hole: Hole | null } | null;
  draft: { kind: WireKind; side: Side; points: Hole[]; cursor: Hole | null } | null;
  wireColor: string;
  message: { text: string; level: 'info' | 'error' } | null;
}

/** 変更の種類。panel は部品リスト等の再描画が必要、view はキャンバスのみ */
export type ChangeKind = 'panel' | 'view';

const AUTOSAVE_KEY = 'universal-kiban:autosave';

export class Store {
  project: Project;
  analysis: Analysis;
  ui: UiState;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private txBefore: string | null = null;
  private listeners = new Set<(k: ChangeKind) => void>();
  private saveTimer: number | undefined;

  constructor(project?: Project) {
    this.project = project ?? Store.loadAutosave() ?? createProject();
    this.analysis = analyze(this.project);
    this.ui = {
      tab: 'design',
      tool: 'select',
      layout: 'lr',
      overlaySide: 'top',
      layers: { topParts: true, topWires: true, bottomParts: true, bottomWires: true, opposite: true, labels: true, coords: true },
      selParts: [],
      selWires: [],
      hover: null,
      camera: null,
      netHole: null,
      placing: null,
      draft: null,
      wireColor: '#d33b3b',
      message: null,
    };
  }

  static loadAutosave(): Project | null {
    try {
      const t = localStorage.getItem(AUTOSAVE_KEY);
      return t ? parseProject(t) : null;
    } catch {
      return null;
    }
  }

  subscribe(fn: (k: ChangeKind) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(kind: ChangeKind): void {
    for (const l of this.listeners) l(kind);
  }

  private changed(kind: ChangeKind = 'panel'): void {
    this.analysis = analyze(this.project);
    this.emit(kind);
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.project));
      } catch {
        this.setMessage('ブラウザへの自動保存に失敗しました。JSON で保存してください', 'error');
      }
    }, 300);
  }

  private pushUndo(before: string): void {
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.project.meta.updatedAt = new Date().toISOString();
    this.scheduleSave();
  }

  /** 履歴に残る変更 */
  update(fn: (p: Project) => void): void {
    const before = JSON.stringify(this.project);
    fn(this.project);
    if (JSON.stringify(this.project) === before) return;
    this.pushUndo(before);
    this.cleanSelection();
    this.changed('panel');
  }

  /** ドラッグなど連続操作の開始 */
  begin(): void {
    this.txBefore = JSON.stringify(this.project);
  }

  /** 連続操作中の変更（履歴に残さない） */
  live(fn: (p: Project) => void): void {
    fn(this.project);
    this.changed('view');
  }

  commit(): void {
    if (this.txBefore === null) return;
    const before = this.txBefore;
    this.txBefore = null;
    if (JSON.stringify(this.project) !== before) this.pushUndo(before);
    this.changed('panel');
  }

  rollback(): void {
    if (this.txBefore === null) return;
    this.project = JSON.parse(this.txBefore);
    this.txBefore = null;
    this.changed('panel');
  }

  get inTransaction(): boolean {
    return this.txBefore !== null;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(prev);
    this.cleanSelection();
    this.scheduleSave();
    this.changed('panel');
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(next);
    this.cleanSelection();
    this.scheduleSave();
    this.changed('panel');
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  replaceProject(p: Project): void {
    this.project = p;
    this.undoStack = [];
    this.redoStack = [];
    this.ui = { ...this.ui, selParts: [], selWires: [], netHole: null, placing: null, draft: null, camera: null };
    this.scheduleSave();
    this.changed('panel');
  }

  setUi(patch: Partial<UiState>, kind: ChangeKind = 'panel'): void {
    this.ui = { ...this.ui, ...patch };
    this.emit(kind);
  }

  setMessage(text: string, level: 'info' | 'error' = 'info'): void {
    this.setUi({ message: { text, level } }, 'view');
  }

  private cleanSelection(): void {
    const placed = new Set(this.project.parts.filter((p) => p.placement).map((p) => p.id));
    const wires = new Set(this.project.wires.map((w) => w.id));
    this.ui.selParts = this.ui.selParts.filter((id) => placed.has(id));
    this.ui.selWires = this.ui.selWires.filter((id) => wires.has(id));
  }
}
