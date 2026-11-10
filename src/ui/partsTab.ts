import { renderFootprintIcon } from '../canvas/render';
import { CATEGORIES, FOOTPRINTS, getFootprint, type FootprintDef, type ParamSpec } from '../library/footprints';
import type { Store } from '../model/store';
import type { Part, ParamValue } from '../model/types';
import { toggleHand } from './actions';
import { download, esc, html } from './dom';

function paramField(spec: ParamSpec, value: ParamValue): string {
  const name = `param-${spec.key}`;
  if (spec.type === 'select') {
    return `<label>${esc(spec.label)}<select name="${name}">${spec.options
      .map((o) => `<option value="${esc(String(o.value))}"${String(o.value) === String(value) ? ' selected' : ''}>${esc(o.label)}</option>`)
      .join('')}</select></label>`;
  }
  if (spec.type === 'int') {
    return `<label>${esc(spec.label)}<input type="number" name="${name}" min="${spec.min}" max="${spec.max}" step="${spec.step ?? 1}" value="${esc(String(value))}"></label>`;
  }
  return `<label>${esc(spec.label)}<input type="text" name="${name}" value="${esc(String(value))}"></label>`;
}

export function paramFields(def: FootprintDef, params: Record<string, ParamValue>): string {
  return def.params.map((p) => paramField(p, params[p.key] ?? p.default)).join('');
}

/** フォーム内の param-* 入力からパラメータを読み取る */
export function readParams(def: FootprintDef, root: HTMLElement): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const spec of def.params) {
    const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="param-${spec.key}"]`);
    if (!el) continue;
    if (spec.type === 'int') {
      let v = Math.round(Number(el.value));
      if (!Number.isFinite(v)) v = spec.default;
      out[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
    } else if (spec.type === 'select') {
      const opt = spec.options.find((o) => String(o.value) === el.value);
      out[spec.key] = opt ? opt.value : spec.default;
    } else out[spec.key] = el.value;
  }
  return out;
}

export function paramSummary(part: Part): string {
  const def = getFootprint(part.footprint);
  if (!def) return '';
  return def.params
    .filter((p) => p.type !== 'text' || part.params[p.key])
    .map((p) => {
      const v = part.params[p.key];
      if (p.type === 'select') return p.options.find((o) => String(o.value) === String(v))?.label ?? String(v);
      if (p.type === 'int') return `${p.label.replace(/（.*）/, '')} ${v}`;
      return String(v);
    })
    .join(' / ');
}

type SortKey = 'ref' | 'type';
let filterText = '';
let sortKey: SortKey = 'ref';

const refCompare = (a: string, b: string) => a.localeCompare(b, 'ja', { numeric: true });

export function sortedParts(parts: Part[], key: SortKey = 'ref'): Part[] {
  return [...parts].sort((a, b) =>
    key === 'type' ? a.footprint.localeCompare(b.footprint) || refCompare(a.ref, b.ref) : refCompare(a.ref, b.ref),
  );
}

export function placementLabel(part: Part): string {
  if (!part.placement) return '';
  return part.placement.side === 'top' ? '<span class="badge top">部品面</span>' : '<span class="badge bottom">はんだ面</span>';
}

export function bomCsv(parts: Part[]): string {
  const groups = new Map<string, Part[]>();
  for (const p of sortedParts(parts)) {
    const k = `${p.footprint}\u0000${JSON.stringify(p.params)}\u0000${p.value}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [['Ref', '種類', '仕様', '値', '数量', 'メモ'].map(q).join(',')];
  for (const g of groups.values()) {
    const p = g[0];
    rows.push(
      [g.map((x) => x.ref).join(' '), getFootprint(p.footprint)?.name ?? p.footprint, paramSummary(p), p.value, String(g.length), g.map((x) => x.note).filter(Boolean).join(' / ')]
        .map(q)
        .join(','),
    );
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}

/** 部品カード（イメージ＋名前）。棚と手元で共通 */
export function partCard(def: FootprintDef, opts: { inHand: boolean; count?: number; draggable?: boolean; active?: boolean }): string {
  const title = opts.inHand ? 'クリックで棚に戻す' : 'クリックで手元に置く';
  return `<button type="button" class="part-card${opts.inHand ? ' in-hand' : ''}${opts.active ? ' active' : ''}" data-fp="${def.id}" title="${title}"${opts.draggable ? ' draggable="true"' : ''}>
    ${renderFootprintIcon(def.id)}
    <span class="name">${esc(def.name)}</span>
    ${opts.count ? `<span class="count" title="配置済みの数">${opts.count}</span>` : ''}
  </button>`;
}

let category = CATEGORIES[0];

export function renderPartsTab(store: Store, el: HTMLElement): void {
  el.innerHTML = '';
  const hand = store.project.hand.map((id) => getFootprint(id)).filter((d): d is FootprintDef => !!d);
  const counts = new Map<string, number>();
  for (const p of store.project.parts) counts.set(p.footprint, (counts.get(p.footprint) ?? 0) + 1);
  const shelf = FOOTPRINTS.filter((f) => (category === 'all' || f.category === category) && !store.project.hand.includes(f.id));
  const wrap = html(`<div class="parts-tab">
    <div class="shelf-row">
      <section class="card shelf">
        <div class="row-between"><h2>部品棚</h2>
          <select class="category" aria-label="カテゴリ">
            ${CATEGORIES.map((c) => `<option value="${esc(c)}"${c === category ? ' selected' : ''}>${esc(c)}</option>`).join('')}
            <option value="all"${category === 'all' ? ' selected' : ''}>すべて</option>
          </select>
        </div>
        <p class="muted">使いそうな部品をクリックすると手元に置きます。</p>
        <div class="cards">${shelf.map((d) => partCard(d, { inHand: false })).join('') || '<p class="empty">このカテゴリの部品はすべて手元にあります</p>'}</div>
      </section>
      <section class="card hand">
        <div class="row-between"><h2>手元（${hand.length} 種類）</h2></div>
        <p class="muted">手元の部品は設計画面の左に並び、何個でも配置できます。クリックすると棚に戻します。</p>
        <div class="cards">${hand.map((d) => partCard(d, { inHand: true, count: counts.get(d.id) })).join('') || '<p class="empty">まだありません。左の棚から選んでください</p>'}</div>
      </section>
    </div>
    <section class="card">
      <div class="row-between"><h2>配置済みの部品（${store.project.parts.length} 個）</h2>
        <div class="tools">
          <input type="search" class="filter" placeholder="絞り込み" value="${esc(filterText)}">
          <select class="sort"><option value="ref"${sortKey === 'ref' ? ' selected' : ''}>Ref 順</option><option value="type"${sortKey === 'type' ? ' selected' : ''}>種類順</option></select>
          <button class="bom">部品表 CSV</button>
        </div>
      </div>
      <table class="parts-table"><thead><tr><th>Ref</th><th>種類</th><th>仕様</th><th>値</th><th>メモ</th><th>面</th><th></th></tr></thead><tbody></tbody></table>
    </section>
  </div>`);
  wrap.querySelectorAll('.cards').forEach((c) =>
    c.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.part-card');
      if (card?.dataset.fp) toggleHand(store, card.dataset.fp);
    }),
  );
  wrap.querySelector<HTMLSelectElement>('.category')!.addEventListener('change', (e) => {
    category = (e.target as HTMLSelectElement).value;
    renderPartsTab(store, el);
  });
  const tbody = wrap.querySelector('tbody')!;
  const refs = new Map<string, number>();
  for (const p of store.project.parts) refs.set(p.ref, (refs.get(p.ref) ?? 0) + 1);
  const f = filterText.trim().toLowerCase();
  const parts = sortedParts(store.project.parts, sortKey).filter((p) => {
    if (!f) return true;
    const name = getFootprint(p.footprint)?.name ?? '';
    return [p.ref, p.value, p.note, name].some((s) => s.toLowerCase().includes(f));
  });
  for (const p of parts) {
    const dup = (refs.get(p.ref) ?? 0) > 1;
    const tr = html<HTMLTableRowElement>(`<table><tbody><tr data-id="${esc(p.id)}">
      <td><input class="ref${dup ? ' invalid' : ''}" value="${esc(p.ref)}" title="${dup ? 'Ref が重複しています' : ''}"></td>
      <td>${esc(getFootprint(p.footprint)?.name ?? p.footprint)}</td>
      <td class="muted">${esc(paramSummary(p))}</td>
      <td><input class="value" value="${esc(p.value)}"></td>
      <td><input class="note" value="${esc(p.note)}"></td>
      <td>${placementLabel(p)}</td>
      <td><button class="danger small del" title="部品を基板から取り除く">削除</button></td>
    </tr></tbody></table>`).querySelector('tr')!;
    tbody.appendChild(tr);
  }
  if (!parts.length) tbody.innerHTML = `<tr><td colspan="7" class="empty">${store.project.parts.length ? '該当する部品がありません' : 'まだ配置した部品はありません（③ 設計で手元の部品を配置します）'}</td></tr>`;

  tbody.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const id = t.closest('tr')?.dataset.id;
    if (!id) return;
    const field = t.classList.contains('ref') ? 'ref' : t.classList.contains('value') ? 'value' : t.classList.contains('note') ? 'note' : null;
    if (!field) return;
    const v = t.value.trim();
    if (field === 'ref' && !v) {
      store.emit('panel');
      return;
    }
    store.update((p) => {
      const part = p.parts.find((pp) => pp.id === id);
      if (part) part[field] = v;
    });
  });
  tbody.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains('del')) return;
    const id = t.closest('tr')?.dataset.id;
    const part = store.project.parts.find((p) => p.id === id);
    if (!part || !confirm(`${part.ref} を基板から取り除きますか？（配線は残ります）`)) return;
    store.update((p) => {
      p.parts = p.parts.filter((pp) => pp.id !== id);
    });
  });
  const filter = wrap.querySelector<HTMLInputElement>('.filter')!;
  filter.addEventListener('input', () => {
    filterText = filter.value;
    renderPartsTab(store, el);
    const nf = el.querySelector<HTMLInputElement>('.filter')!;
    nf.focus();
    nf.setSelectionRange(nf.value.length, nf.value.length);
  });
  wrap.querySelector<HTMLSelectElement>('.sort')!.addEventListener('change', (e) => {
    sortKey = (e.target as HTMLSelectElement).value as SortKey;
    renderPartsTab(store, el);
  });
  wrap.querySelector('.bom')!.addEventListener('click', () => {
    download(`${store.project.meta.name || 'project'}-BOM.csv`, bomCsv(store.project.parts), 'text/csv');
  });
  el.appendChild(wrap);
}
