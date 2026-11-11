import { BoardView } from '../canvas/boardView';
import { PRESETS, getPreset, holesBlockedByMounting } from '../library/presets';
import { inBoard, pinsAt } from '../logic/geometry';
import type { Store } from '../model/store';
import type { Board, BoardType } from '../model/types';
import { esc, html } from './dom';

let view: BoardView | null = null;
let sizeMode: 'holes' | 'mm' = 'holes';

const holesFromMm = (mm: number, pitch: number, margin: number) => Math.max(2, Math.floor((mm - 2 * margin) / pitch + 1e-6) + 1);
const mmFromHoles = (n: number, pitch: number, margin: number) => Math.round(((n - 1) * pitch + 2 * margin) * 100) / 100;

/** 基板サイズ・種類を変更する。範囲外になるものがあれば確認する */
export function applyBoard(store: Store, next: Partial<Board>): boolean {
  const nb: Board = { ...store.project.board, ...next };
  nb.cols = Math.max(2, Math.min(200, Math.round(nb.cols)));
  nb.rows = Math.max(2, Math.min(200, Math.round(nb.rows)));
  const outParts = store.project.parts.filter((p) => p.placement && pinsAt(p, p.placement).some((pin) => !inBoard(nb, pin.x, pin.y)));
  const outWires = store.project.wires.filter((w) => w.points.some(([x, y]) => !inBoard(nb, x, y)));
  if (outParts.length || outWires.length) {
    const msg = `新しいサイズでは、部品 ${outParts.length} 個（${outParts.map((p) => p.ref).join(', ')}）と配線 ${outWires.length} 本が基板の外に出ます。\n部品を未配置に戻し、配線を削除して変更しますか？`;
    if (!confirm(msg)) return false;
  }
  const partIds = new Set(outParts.map((p) => p.id));
  const wireIds = new Set(outWires.map((w) => w.id));
  store.update((p) => {
    p.board = { ...nb, disabledHoles: nb.disabledHoles.filter(([x, y]) => inBoard(nb, x, y)) };
    for (const part of p.parts) if (partIds.has(part.id)) part.placement = null;
    p.wires = p.wires.filter((w) => !wireIds.has(w.id));
  });
  store.setUi({ camera: null }, 'view');
  return true;
}

export function renderBoardTab(store: Store, el: HTMLElement): void {
  const b = store.project.board;
  const preset = getPreset(b.preset);
  el.innerHTML = '';
  const wrap = html(`<div class="board-tab">
    <section class="card settings">
      <h2>基板の設定</h2>
      <label>プリセット<select name="preset">
        <option value="">カスタム</option>
        ${PRESETS.map((p) => `<option value="${p.id}"${p.id === b.preset ? ' selected' : ''}>${esc(p.name)}（${p.cols}×${p.rows} 穴）</option>`).join('')}
      </select></label>
      ${preset ? `<p class="note">外形 ${preset.widthMm}×${preset.heightMm}mm・${preset.type === 'single' ? '片面' : '両面スルーホール'}・取付穴 φ${preset.mountingHoles[0]?.dMm ?? '-'}mm（取付穴に重なる穴があれば使用禁止にします）。<a href="${esc(preset.url ?? '')}" target="_blank" rel="noopener">商品ページ</a></p>` : ''}
      ${preset?.unverified ? `<p class="note warn">${esc(preset.unverified)}。実物と違う場合は穴数を直してください。</p>` : ''}
      <fieldset class="size-mode">
        <legend>サイズの指定方法</legend>
        <label class="inline"><input type="radio" name="mode" value="holes"${sizeMode === 'holes' ? ' checked' : ''}> 穴数</label>
        <label class="inline"><input type="radio" name="mode" value="mm"${sizeMode === 'mm' ? ' checked' : ''}> 外形寸法（mm）</label>
      </fieldset>
      <div class="size-holes"${sizeMode === 'holes' ? '' : ' hidden'}>
        <label>列数（横）<input type="number" name="cols" min="2" max="200" value="${b.cols}"></label>
        <label>行数（縦）<input type="number" name="rows" min="2" max="200" value="${b.rows}"></label>
      </div>
      <div class="size-mm"${sizeMode === 'mm' ? '' : ' hidden'}>
        <label>幅（mm）<input type="number" name="width" min="5" step="0.1" value="${mmFromHoles(b.cols, b.pitchMm, b.marginMm)}"></label>
        <label>高さ（mm）<input type="number" name="height" min="5" step="0.1" value="${mmFromHoles(b.rows, b.pitchMm, b.marginYMm ?? b.marginMm)}"></label>
        <p class="note computed"></p>
      </div>
      <p class="muted">端の余白（基板の端から最初の穴の中心まで, mm）</p>
      <div class="size-holes">
        <label>横方向<input type="number" name="margin" min="0" max="20" step="0.01" value="${b.marginMm}"></label>
        <label>縦方向<input type="number" name="marginY" min="0" max="20" step="0.01" value="${b.marginYMm ?? b.marginMm}"></label>
      </div>
      <label>基板の種類<select name="type">
        <option value="single"${b.type === 'single' ? ' selected' : ''}>片面（ランドははんだ面のみ）</option>
        <option value="double"${b.type === 'double' ? ' selected' : ''}>両面スルーホール</option>
      </select></label>
      <div class="buttons"><button class="primary apply">サイズを適用</button></div>
      <p class="muted">現在: ${b.cols} × ${b.rows} 穴（約 ${mmFromHoles(b.cols, b.pitchMm, b.marginMm)} × ${mmFromHoles(b.rows, b.pitchMm, b.marginYMm ?? b.marginMm)} mm）、ピッチ ${b.pitchMm}mm</p>
      <h3>使用禁止穴</h3>
      <p class="muted">右の図で穴をクリックすると、使用禁止（×）を切り替えます。ネジ穴の周りなどに使います。</p>
      <p>${b.disabledHoles.length} 個 <button class="small clear-disabled"${b.disabledHoles.length ? '' : ' disabled'}>すべて解除</button></p>
    </section>
    <section class="card grow preview"><div class="view-slot"></div></section>
  </div>`);

  const q = <T extends HTMLElement>(s: string) => wrap.querySelector<T>(s)!;
  const computed = q<HTMLParagraphElement>('.computed');
  const updateComputed = () => {
    const margin = Number(q<HTMLInputElement>('[name=margin]').value) || 0;
    const marginY = Number(q<HTMLInputElement>('[name=marginY]').value) || 0;
    const cols = holesFromMm(Number(q<HTMLInputElement>('[name=width]').value), b.pitchMm, margin);
    const rows = holesFromMm(Number(q<HTMLInputElement>('[name=height]').value), b.pitchMm, marginY);
    computed.textContent = `→ ${cols} × ${rows} 穴`;
    return { cols, rows };
  };
  updateComputed();
  wrap.querySelectorAll<HTMLInputElement>('[name=width],[name=height],[name=margin],[name=marginY]').forEach((i) => i.addEventListener('input', updateComputed));

  wrap.querySelectorAll<HTMLInputElement>('[name=mode]').forEach((r) =>
    r.addEventListener('change', () => {
      sizeMode = r.value as typeof sizeMode;
      renderBoardTab(store, el);
    }),
  );
  q<HTMLSelectElement>('[name=preset]').addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    const p = getPreset(id);
    if (!p) {
      store.update((pr) => {
        delete pr.board.preset;
      });
      return;
    }
    const geo = { cols: p.cols, rows: p.rows, pitchMm: b.pitchMm, marginMm: p.marginMm, marginYMm: p.marginYMm };
    if (!applyBoard(store, { preset: p.id, ...geo, type: p.type, mountingHoles: p.mountingHoles, disabledHoles: holesBlockedByMounting(geo, p.mountingHoles) }))
      store.emit('panel');
  });
  q('.apply').addEventListener('click', () => {
    const margin = Math.max(0, Number(q<HTMLInputElement>('[name=margin]').value) || 0);
    const marginY = Math.max(0, Number(q<HTMLInputElement>('[name=marginY]').value) || 0);
    const size =
      sizeMode === 'holes'
        ? { cols: Number(q<HTMLInputElement>('[name=cols]').value), rows: Number(q<HTMLInputElement>('[name=rows]').value) }
        : updateComputed();
    const changed = size.cols !== b.cols || size.rows !== b.rows;
    applyBoard(store, { ...size, marginMm: margin, marginYMm: marginY, ...(changed ? { preset: undefined, mountingHoles: [] } : {}) });
  });
  for (const name of ['margin', 'marginY'] as const) {
    q<HTMLInputElement>(`[name=${name}]`).addEventListener('change', (e) => {
      const v = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
      store.update((p) => {
        if (name === 'margin') p.board.marginMm = v;
        else p.board.marginYMm = v;
      });
    });
  }
  q<HTMLSelectElement>('[name=type]').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value as BoardType;
    store.update((p) => {
      p.board.type = v;
    });
  });
  q('.clear-disabled').addEventListener('click', () =>
    store.update((p) => {
      p.board.disabledHoles = [];
    }),
  );

  if (!view) view = new BoardView(store, 'top', 'board-edit');
  q('.view-slot').appendChild(view.el);
  el.appendChild(wrap);
  requestAnimationFrame(() => view?.render());
}

export function renderBoardTabView(): void {
  view?.render();
}
