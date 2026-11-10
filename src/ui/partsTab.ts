import { FOOTPRINTS, defaultParams, getFootprint, type FootprintDef, type ParamSpec } from '../library/footprints';
import { makePart } from '../model/project';
import type { Store } from '../model/store';
import type { Part, ParamValue } from '../model/types';
import { download, esc, html } from './dom';

export function footprintOptions(selected: string): string {
  const cats = [...new Set(FOOTPRINTS.map((f) => f.category))];
  return cats
    .map(
      (c) =>
        `<optgroup label="${esc(c)}">${FOOTPRINTS.filter((f) => f.category === c)
          .map((f) => `<option value="${f.id}"${f.id === selected ? ' selected' : ''}>${esc(f.name)}</option>`)
          .join('')}</optgroup>`,
    )
    .join('');
}

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

/** 部品追加フォーム。追加した部品の ID を返す */
export function createAddForm(store: Store, onAdded?: (ids: string[]) => void, compact = false): HTMLElement {
  let fpId = 'resistor-axial';
  const form = html<HTMLFormElement>(`<form class="add-form${compact ? ' compact' : ''}">
    <label>部品の種類<select name="footprint">${footprintOptions(fpId)}</select></label>
    <div class="params"></div>
    <label>値<input type="text" name="value" placeholder="例: 10kΩ, 100nF, NE555"></label>
    <label>数量<input type="number" name="qty" min="1" max="50" value="1"></label>
    <button type="submit" class="primary">追加</button>
  </form>`);
  const paramsEl = form.querySelector<HTMLDivElement>('.params')!;
  const drawParams = () => {
    const def = getFootprint(fpId)!;
    paramsEl.innerHTML = paramFields(def, defaultParams(def));
  };
  drawParams();
  form.querySelector('select[name=footprint]')!.addEventListener('change', (e) => {
    fpId = (e.target as HTMLSelectElement).value;
    drawParams();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const def = getFootprint(fpId)!;
    const params = readParams(def, paramsEl);
    const value = (form.elements.namedItem('value') as HTMLInputElement).value.trim();
    const qty = Math.max(1, Math.min(50, Number((form.elements.namedItem('qty') as HTMLInputElement).value) || 1));
    const ids: string[] = [];
    store.update((p) => {
      for (let i = 0; i < qty; i++) {
        const part = makePart(p.parts, fpId, params, value);
        p.parts.push(part);
        ids.push(part.id);
      }
    });
    store.setMessage(`${def.name} を ${qty} 個追加しました`);
    onAdded?.(ids);
  });
  return form;
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
  if (!part.placement) return '<span class="badge unplaced">未配置</span>';
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

export function renderPartsTab(store: Store, el: HTMLElement): void {
  el.innerHTML = '';
  const wrap = html(`<div class="parts-tab">
    <section class="card"><h2>部品を追加</h2><div class="add-slot"></div></section>
    <section class="card grow">
      <div class="row-between"><h2>部品リスト（${store.project.parts.length} 個）</h2>
        <div class="tools">
          <input type="search" class="filter" placeholder="絞り込み" value="${esc(filterText)}">
          <select class="sort"><option value="ref"${sortKey === 'ref' ? ' selected' : ''}>Ref 順</option><option value="type"${sortKey === 'type' ? ' selected' : ''}>種類順</option></select>
          <button class="bom">部品表 CSV</button>
        </div>
      </div>
      <table class="parts-table"><thead><tr><th>Ref</th><th>種類</th><th>仕様</th><th>値</th><th>メモ</th><th>配置</th><th></th></tr></thead><tbody></tbody></table>
    </section>
  </div>`);
  wrap.querySelector('.add-slot')!.appendChild(createAddForm(store));
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
      <td><button class="danger small del" title="部品を削除">削除</button></td>
    </tr></tbody></table>`).querySelector('tr')!;
    tbody.appendChild(tr);
  }
  if (!parts.length) tbody.innerHTML = `<tr><td colspan="7" class="empty">${store.project.parts.length ? '該当する部品がありません' : 'まだ部品がありません。左のフォームから追加してください'}</td></tr>`;

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
    if (!part || !confirm(`${part.ref} を削除しますか？（配線は残ります）`)) return;
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
