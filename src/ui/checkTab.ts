import type { Store } from '../model/store';
import type { Hole } from '../model/types';
import { holeLabel } from '../logic/geometry';
import { esc, html } from './dom';
import { getViews } from './designTab';

export function renderCheckTab(store: Store, el: HTMLElement): void {
  const issues = [...store.analysis.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  const p = store.project;
  const placed = p.parts.filter((x) => x.placement).length;
  el.innerHTML = '';
  const wrap = html(`<div class="check-tab">
    <section class="card">
      <h2>概要</h2>
      <ul class="summary">
        <li>基板: ${p.board.cols} × ${p.board.rows} 穴（${p.board.type === 'single' ? '片面' : '両面スルーホール'}）</li>
        <li>部品: ${p.parts.length} 個（配置済み ${placed} 個）</li>
        <li>配線: ${p.wires.length} 本（部品面 ${p.wires.filter((w) => w.side === 'top').length} 本・はんだ面 ${p.wires.filter((w) => w.side === 'bottom').length} 本）</li>
        <li>ネット: ${[...store.analysis.nets.values()].filter((n) => n.pins.length + n.wires.size > 1).length} 個</li>
      </ul>
    </section>
    <section class="card grow">
      <h2>チェック結果（${issues.length} 件）</h2>
      <p class="muted">項目をクリックすると設計画面の該当箇所へ移動します。</p>
      <ul class="issues">${
        issues
          .map(
            (i, idx) =>
              `<li class="issue ${i.severity}" data-idx="${idx}"><span class="badge ${i.severity}">${i.severity === 'error' ? 'エラー' : '警告'}</span> ${esc(i.message)} <small>${i.holes
                .slice(0, 4)
                .map(([x, y]) => holeLabel(x, y))
                .join(', ')}${i.holes.length > 4 ? '…' : ''}</small></li>`,
          )
          .join('') || '<li class="empty">問題は見つかりませんでした</li>'
      }</ul>
    </section>
  </div>`);
  wrap.querySelector('.issues')!.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>('.issue');
    if (!li) return;
    const issue = issues[Number(li.dataset.idx)];
    store.setUi({
      tab: 'design',
      tool: 'select',
      selParts: issue.partId ? [issue.partId] : [],
      selWires: issue.wireId ? [issue.wireId] : [],
    });
    requestAnimationFrame(() => getViews()[0]?.focusHoles(issue.holes as Hole[]));
  });
  el.appendChild(wrap);
}
