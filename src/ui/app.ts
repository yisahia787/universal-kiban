import { holeLabel, inBoard } from '../logic/geometry';
import { createProject, parseProject } from '../model/project';
import type { ChangeKind, Store, Tab } from '../model/store';
import { cancel, deleteSelection, flipSelection, rotateSelection, setTool, TOOL_LABELS } from './actions';
import { renderBoardTab, renderBoardTabView } from './boardTab';
import { renderCheckTab } from './checkTab';
import { renderDesignTab, renderDesignViews, toggleOverlaySide } from './designTab';
import { download, esc, html, pickFile } from './dom';
import { isTyping } from './keys';
import { renderPartsTab } from './partsTab';

const TABS: [Tab, string][] = [
  ['board', '① 基板'],
  ['parts', '② 部品リスト'],
  ['design', '③ 設計（配置・配線）'],
  ['check', '④ 確認・出力'],
];

export class App {
  private header: HTMLElement;
  private main: HTMLElement;
  private status: HTMLElement;
  private renderedTab: Tab | null = null;
  private pending: ChangeKind | null = null;

  constructor(
    private store: Store,
    root: HTMLElement,
  ) {
    root.innerHTML = '';
    this.header = html('<header class="app-header"></header>');
    this.main = html('<main class="app-main"></main>');
    this.status = html('<footer class="status-bar"></footer>');
    root.append(this.header, this.main, this.status);
    store.subscribe((k) => this.schedule(k));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('beforeunload', () => localStorage.setItem('universal-kiban:autosave', JSON.stringify(store.project)));
    this.renderAll();
  }

  private schedule(kind: ChangeKind): void {
    if (this.pending === 'panel') return;
    const first = this.pending === null;
    this.pending = kind;
    if (first)
      requestAnimationFrame(() => {
        const k = this.pending;
        this.pending = null;
        if (k === 'panel') this.renderAll();
        else this.renderViewOnly();
      });
  }

  private renderAll(): void {
    this.renderHeader();
    const tab = this.store.ui.tab;
    if (tab !== this.renderedTab) {
      this.main.innerHTML = '';
      this.main.dataset.tab = tab;
      this.store.ui.camera = null;
      this.renderedTab = tab;
    }
    if (tab === 'board') renderBoardTab(this.store, this.main);
    else if (tab === 'parts') renderPartsTab(this.store, this.main);
    else if (tab === 'design') renderDesignTab(this.store, this.main);
    else renderCheckTab(this.store, this.main);
    this.renderStatus();
  }

  private renderViewOnly(): void {
    if (this.store.ui.tab === 'design') renderDesignViews();
    else if (this.store.ui.tab === 'board') renderBoardTabView();
    this.renderStatus();
  }

  private renderHeader(): void {
    const s = this.store;
    this.header.innerHTML = `
      <div class="brand">ユニバーサル基板設計</div>
      <input class="project-name" value="${esc(s.project.meta.name)}" title="プロジェクト名">
      <div class="actions">
        <button class="new">新規</button>
        <button class="open">開く</button>
        <button class="save" title="JSON で保存（Ctrl+S）">保存</button>
        <span class="sep"></span>
        <button class="undo"${s.canUndo ? '' : ' disabled'} title="元に戻す（Ctrl+Z）">↶ 元に戻す</button>
        <button class="redo"${s.canRedo ? '' : ' disabled'} title="やり直し（Ctrl+Y）">↷ やり直し</button>
      </div>
      <nav class="tabs">${TABS.map(([t, l]) => `<button data-tab="${t}" class="${s.ui.tab === t ? 'active' : ''}">${l}</button>`).join('')}</nav>`;
    this.header.querySelector('.tabs')!.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (t) s.setUi({ tab: t, draft: null, placing: null });
    });
    this.header.querySelector<HTMLInputElement>('.project-name')!.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value.trim() || '無題';
      s.update((p) => {
        p.meta.name = v;
      });
    });
    this.header.querySelector('.undo')!.addEventListener('click', () => s.undo());
    this.header.querySelector('.redo')!.addEventListener('click', () => s.redo());
    this.header.querySelector('.save')!.addEventListener('click', () => this.save());
    this.header.querySelector('.open')!.addEventListener('click', () => this.open());
    this.header.querySelector('.new')!.addEventListener('click', () => {
      if (confirm('新しいプロジェクトを作成しますか？（現在の内容は破棄されます。必要なら先に保存してください）')) {
        s.replaceProject(createProject());
        s.setUi({ tab: 'board' });
      }
    });
  }

  private renderStatus(): void {
    const s = this.store;
    const ui = s.ui;
    const b = s.project.board;
    const a = s.analysis;
    const errs = a.issues.filter((i) => i.severity === 'error').length;
    const hover = ui.hover && inBoard(b, ui.hover[0], ui.hover[1]) ? holeLabel(ui.hover[0], ui.hover[1]) : '—';
    const zoom = ui.camera ? `${Math.round((ui.camera.zoom / 9.6) * 100)}%` : '—';
    const side = ui.layout === 'overlay' ? (ui.overlaySide === 'top' ? '部品面' : 'はんだ面') : ui.draft ? (ui.draft.side === 'top' ? '部品面' : 'はんだ面') : '両面';
    this.status.innerHTML = `
      <span>座標 <b>${hover}</b></span>
      <span>操作中の面 <b>${side}</b></span>
      <span>ツール <b>${ui.placing ? '部品の配置' : TOOL_LABELS[ui.tool]}</b></span>
      <span>エラー <b class="${errs ? 'err' : ''}">${errs}</b> / 警告 <b>${a.issues.length - errs}</b></span>
      <span>拡大率 <b>${zoom}</b><small>（100% ≒ 実寸）</small></span>
      <span class="message ${ui.message?.level ?? ''}">${esc(ui.message?.text ?? '')}</span>`;
  }

  private save(): void {
    const name = (this.store.project.meta.name || 'project').replace(/[\\/:*?"<>|]/g, '_');
    download(`${name}.ukb.json`, JSON.stringify(this.store.project, null, 2));
    this.store.setMessage('JSON ファイルとして保存しました');
  }

  private async open(): Promise<void> {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const p = parseProject(await file.text());
      this.store.replaceProject(p);
      this.store.setMessage(`${file.name} を開きました`);
    } catch (err) {
      alert(`ファイルを開けませんでした: ${(err as Error).message}`);
    }
  }

  private onKey(e: KeyboardEvent): void {
    const s = this.store;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.save();
      return;
    }
    if (isTyping(e.target)) {
      // パネルの入力欄で Enter を押したら確定してキャンバス操作に戻る
      const t = e.target as HTMLElement;
      if (e.key === 'Enter' && t.tagName === 'INPUT' && t.closest('.panel')) t.blur();
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) s.redo();
      else s.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      s.redo();
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === 'Escape') return cancel(s);
    if (s.ui.tab !== 'design') return;
    switch (e.key) {
      case 'v':
      case 'V':
        return setTool(s, 'select');
      case 'w':
      case 'W':
        return setTool(s, 'bare');
      case 'b':
      case 'B':
        return setTool(s, 'bridge');
      case 'j':
      case 'J':
        return setTool(s, 'insulated');
      case 'n':
      case 'N':
        return setTool(s, 'net');
      case 'r':
        return rotateSelection(s, 1);
      case 'R':
        return rotateSelection(s, -1);
      case 'f':
      case 'F':
        return flipSelection(s);
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        return deleteSelection(s);
      case '0':
        return s.setUi({ camera: null }, 'view');
      case 'Tab':
        if (s.ui.layout === 'overlay') {
          e.preventDefault();
          toggleOverlaySide(s);
        }
        return;
      case ' ':
        e.preventDefault();
        return;
    }
  }
}
