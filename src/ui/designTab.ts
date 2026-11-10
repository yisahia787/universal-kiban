import { BoardView, DND_TYPE, setDragFootprint } from '../canvas/boardView';
import { getFootprint, type FootprintDef } from '../library/footprints';
import { holeKey, holeLabel, partGeometry, pinsAt, polylineLength } from '../logic/geometry';
import { checkPlacement } from '../logic/placement';
import type { Layers, Store, Tool } from '../model/store';
import type { Part, Rotation, Side } from '../model/types';
import { deleteSelection, flipSelection, rotateSelection, setTool, startPlacing, TOOL_LABELS } from './actions';
import { esc, html } from './dom';
import { paramFields, partCard, placementLabel, readParams, sortedParts } from './partsTab';

let views: BoardView[] = [];
let viewsKey = '';
let shell: HTMLElement | null = null;

const TOOL_KEYS: Record<Tool, string> = { select: 'V', bare: 'W', bridge: 'B', insulated: 'J', net: 'N' };
const LAYER_LABELS: [keyof Layers, string][] = [
  ['topParts', '部品面の部品'],
  ['topWires', '部品面の配線'],
  ['bottomParts', 'はんだ面の部品'],
  ['bottomWires', 'はんだ面の配線'],
  ['opposite', '反対面を半透明で表示'],
  ['labels', '部品ラベル'],
  ['coords', '座標'],
];

export function getViews(): BoardView[] {
  return views;
}

function ensureViews(store: Store, container: HTMLElement): void {
  const { layout, overlaySide } = store.ui;
  const key = layout === 'overlay' ? `overlay-${overlaySide}` : layout;
  if (key !== viewsKey) {
    for (const v of views) v.destroy();
    views = layout === 'overlay' ? [new BoardView(store, overlaySide)] : [new BoardView(store, 'top'), new BoardView(store, 'bottom')];
    viewsKey = key;
  }
  container.className = `views layout-${layout}`;
  for (const v of views) if (v.el.parentElement !== container) container.appendChild(v.el);
}

export function renderDesignViews(): void {
  for (const v of views) v.render();
}

function toolbar(store: Store): HTMLElement {
  const ui = store.ui;
  const tb = html(`<div class="toolbar">
    <div class="group tools">
      ${(Object.keys(TOOL_LABELS) as Tool[])
        .map((t) => `<button data-tool="${t}" class="tool tool-${t}${ui.tool === t ? ' active' : ''}" title="${TOOL_LABELS[t]}（${TOOL_KEYS[t]}）"><span class="swatch"></span>${TOOL_LABELS[t]}</button>`)
        .join('')}
      <label class="inline color" title="被覆線の色"><input type="color" name="wireColor" value="${esc(ui.wireColor)}"></label>
    </div>
    <div class="group">
      <label class="inline">表示<select name="layout">
        <option value="lr"${ui.layout === 'lr' ? ' selected' : ''}>左右に並べる</option>
        <option value="tb"${ui.layout === 'tb' ? ' selected' : ''}>上下に並べる</option>
        <option value="overlay"${ui.layout === 'overlay' ? ' selected' : ''}>重ねて表示</option>
      </select></label>
      ${ui.layout === 'overlay' ? `<button class="switch-side" title="操作する面を切り替え（Tab）">操作中: ${ui.overlaySide === 'top' ? '部品面' : 'はんだ面'} ⇄</button>` : ''}
      <details class="layers"><summary>レイヤー</summary><div class="menu">
        ${LAYER_LABELS.map(([k, l]) => `<label class="inline"><input type="checkbox" name="${k}"${ui.layers[k] ? ' checked' : ''}> ${l}</label>`).join('')}
      </div></details>
      <button class="fit" title="全体表示（0）">全体表示</button>
    </div>
  </div>`);
  tb.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    if (btn.dataset.tool) setTool(store, btn.dataset.tool as Tool);
    else if (btn.classList.contains('fit')) store.setUi({ camera: null }, 'view');
    else if (btn.classList.contains('switch-side')) toggleOverlaySide(store);
  });
  tb.querySelector<HTMLInputElement>('[name=wireColor]')!.addEventListener('input', (e) => {
    store.setUi({ wireColor: (e.target as HTMLInputElement).value }, 'view');
  });
  tb.querySelector<HTMLSelectElement>('[name=layout]')!.addEventListener('change', (e) => {
    store.setUi({ layout: (e.target as HTMLSelectElement).value as Store['ui']['layout'], camera: null });
  });
  tb.querySelectorAll<HTMLInputElement>('.layers input').forEach((i) =>
    i.addEventListener('change', () => store.setUi({ layers: { ...store.ui.layers, [i.name]: i.checked } }, 'view')),
  );
  return tb;
}

export function toggleOverlaySide(store: Store): void {
  if (store.ui.layout !== 'overlay') return;
  store.setUi({ overlaySide: store.ui.overlaySide === 'top' ? 'bottom' : 'top', draft: null, selParts: [], selWires: [] });
}

function leftPanel(store: Store): HTMLElement {
  const placed = sortedParts(store.project.parts.filter((p) => p.placement));
  const counts = new Map<string, number>();
  for (const p of placed) counts.set(p.footprint, (counts.get(p.footprint) ?? 0) + 1);
  const hand = store.project.hand.map((id) => getFootprint(id)).filter((d): d is FootprintDef => !!d);
  const item = (p: Part) => {
    const fp = getFootprint(p.footprint);
    const sel = store.ui.selParts.includes(p.id);
    return `<li class="part-item${sel ? ' selected' : ''}" data-id="${esc(p.id)}" title="クリックで選択">
      <span class="ref">${esc(p.ref)}</span><span class="val">${esc(p.value || fp?.name || '')}</span>${placementLabel(p)}</li>`;
  };
  const panel = html(`<aside class="panel left">
    <div class="row-between"><h3>手元の部品</h3><button class="small goto-shelf" title="② 部品リストで手元の部品を選びます">部品棚</button></div>
    <p class="muted hint">クリック→穴をクリックで配置（続けて置けます）。ビューへドラッグしても置けます。</p>
    <div class="cards compact">${
      hand.map((d) => partCard(d, { inHand: true, count: counts.get(d.id), draggable: true, active: store.ui.placing?.footprint === d.id })).join('') ||
      '<p class="empty">手元に部品がありません。「部品棚」から選んでください</p>'
    }</div>
    <h3>配置済み（${placed.length}）</h3>
    <ul class="part-list">${placed.map(item).join('') || '<li class="empty">なし</li>'}</ul>
  </aside>`);
  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.goto-shelf')) return store.setUi({ tab: 'parts', placing: null, draft: null });
    const card = t.closest<HTMLElement>('.part-card');
    if (card?.dataset.fp) {
      if (store.ui.placing?.footprint === card.dataset.fp) {
        store.setUi({ placing: null });
        store.setMessage('');
      } else startPlacing(store, card.dataset.fp);
      return;
    }
    const li = t.closest<HTMLLIElement>('.part-item');
    const part = li && store.project.parts.find((p) => p.id === li.dataset.id);
    if (!part?.placement) return;
    store.setUi({ selParts: [part.id], selWires: [], tool: 'select', placing: null });
    const pins = pinsAt(part, part.placement).map((pin) => [pin.x, pin.y] as [number, number]);
    views[0]?.focusHoles(pins);
  });
  panel.addEventListener('dragstart', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.part-card');
    if (!card?.dataset.fp || !e.dataTransfer) return;
    e.dataTransfer.setData(DND_TYPE, card.dataset.fp);
    e.dataTransfer.effectAllowed = 'copy';
    setDragFootprint(card.dataset.fp);
  });
  panel.addEventListener('dragend', () => {
    setDragFootprint(null);
    if (store.ui.placing) store.setUi({ placing: null });
  });
  return panel;
}

function partProps(store: Store, part: Part): string {
  const fp = getFootprint(part.footprint);
  const pl = part.placement!;
  const geo = partGeometry(part);
  const pins = pinsAt(part, pl, geo);
  const a = store.analysis;
  const pinRows = pins
    .map((p) => {
      const net = a.nets.get(a.netOfHole.get(holeKey(p.x, p.y)) ?? '');
      return `<tr><td>${esc(p.num)}</td><td>${esc(p.name)}</td><td>${holeLabel(p.x, p.y)}</td><td>${esc(net?.name ?? '')}</td></tr>`;
    })
    .join('');
  return `<section class="props part-props" data-id="${esc(part.id)}">
    <h3>${esc(part.ref)} <small>${esc(fp?.name ?? part.footprint)}</small></h3>
    <label>Ref<input name="ref" value="${esc(part.ref)}"></label>
    <label>値<input name="value" value="${esc(part.value)}"></label>
    ${fp ? `<div class="params">${paramFields(fp, part.params)}</div>` : ''}
    <label>面<select name="side"><option value="top"${pl.side === 'top' ? ' selected' : ''}>部品面</option><option value="bottom"${pl.side === 'bottom' ? ' selected' : ''}>はんだ面</option></select></label>
    <label>回転<select name="rot">${[0, 90, 180, 270].map((r) => `<option value="${r}"${pl.rot === r ? ' selected' : ''}>${r}°</option>`).join('')}</select></label>
    <p class="muted">1 番ピン: ${holeLabel(pins[0].x, pins[0].y)}</p>
    <div class="buttons"><button class="small rot">回転（R）</button><button class="small flip">反対面へ（F）</button><button class="small danger unplace">削除（Delete）</button></div>
    <table class="pins"><thead><tr><th>ピン</th><th>名前</th><th>穴</th><th>ネット</th></tr></thead><tbody>${pinRows}</tbody></table>
  </section>`;
}

function rightPanel(store: Store): HTMLElement {
  const ui = store.ui;
  const a = store.analysis;
  let body = '';
  const selParts = store.project.parts.filter((p) => ui.selParts.includes(p.id) && p.placement);
  const selWires = store.project.wires.filter((w) => ui.selWires.includes(w.id));
  const pitch = store.project.board.pitchMm;
  if (selParts.length === 1 && selWires.length === 0) body += partProps(store, selParts[0]);
  else if (selWires.length === 1 && selParts.length === 0) {
    const w = selWires[0];
    const kindName = { bare: 'すずめっき線', bridge: 'はんだブリッジ', insulated: '被覆線' }[w.kind];
    const conducting = a.wireHoles.get(w.id) ?? [];
    body += `<section class="props wire-props" data-id="${esc(w.id)}">
      <h3>${kindName} <small>${w.side === 'top' ? '部品面' : 'はんだ面'}</small></h3>
      <label>色<input type="color" name="color" value="${esc(w.color)}"></label>
      <p>経路: ${w.points.map(([x, y]) => holeLabel(x, y)).join(' → ')}</p>
      <p>長さ: 約 ${(polylineLength(w.points) * pitch).toFixed(1)} mm</p>
      <p class="muted">導通する穴: ${conducting.map(([x, y]) => holeLabel(x, y)).join(', ') || 'なし'}</p>
      <p class="muted">端点・折れ点はドラッグで動かせます</p>
      <div class="buttons"><button class="small danger del-wire">削除（Delete）</button></div>
    </section>`;
  } else if (selParts.length + selWires.length > 1) {
    body += `<section class="props"><h3>${selParts.length} 個の部品・${selWires.length} 本の配線を選択中</h3>
      <div class="buttons"><button class="small rot">回転（R）</button><button class="small flip">反対面へ（F）</button><button class="small danger del-sel">削除（Delete）</button></div></section>`;
  } else {
    body += `<section class="props"><h3>操作のヒント</h3><ul class="hints">
      <li>左の手元の部品をクリックして穴をクリック（またはビューへドラッグ）して配置</li>
      <li>部品面ビューに置くと部品面、はんだ面ビューに置くとはんだ面に配置されます</li>
      <li>配線ツールで穴をクリックして経路を指定、ダブルクリックか Enter で確定</li>
      <li>ホイールでズーム、スペース＋ドラッグ／右ドラッグでスクロール</li>
    </ul></section>`;
  }

  // ネット
  const netId = ui.netHole ? a.netOfHole.get(holeKey(ui.netHole[0], ui.netHole[1])) : undefined;
  const net = netId ? a.nets.get(netId) : undefined;
  if (net) {
    const pins = net.pins
      .map((p) => {
        const part = store.project.parts.find((pp) => pp.id === p.partId);
        return `${esc(part?.ref ?? '?')}.${esc(p.num)}${p.name ? `(${esc(p.name)})` : ''}`;
      })
      .join(', ');
    body += `<section class="props net-props"><h3>ネット ${net.name ? esc(net.name) : '（名前なし）'}</h3>
      <label>名前<input name="netName" value="${esc(net.name ?? '')}" placeholder="例: VCC, GND"></label>
      <p>ピン: ${pins || 'なし'}</p><p class="muted">穴 ${net.holes.size} 個・配線 ${net.wires.size} 本</p></section>`;
  }
  const named = [...a.nets.values()].filter((n) => n.name);
  body += `<section class="props"><h3>名前付きネット</h3>${
    named.length
      ? `<ul class="net-list">${named.map((n) => `<li data-hole="${esc([...n.holes][0])}">${esc(n.name!)} <small>${n.pins.length} ピン</small></li>`).join('')}</ul>`
      : '<p class="muted">ネット表示ツール（N）で穴をクリックし、名前を付けられます</p>'
  }</section>`;
  const errs = a.issues.filter((i) => i.severity === 'error').length;
  const warns = a.issues.length - errs;
  body += `<section class="props"><h3>チェック</h3><p><span class="badge error">エラー ${errs}</span> <span class="badge warning">警告 ${warns}</span> <button class="small goto-check">一覧</button></p></section>`;

  const panel = html(`<aside class="panel right">${body}</aside>`);
  bindRightPanel(store, panel);
  return panel;
}

function bindRightPanel(store: Store, panel: HTMLElement): void {
  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('rot')) rotateSelection(store, 1);
    else if (t.classList.contains('flip')) flipSelection(store);
    else if (t.classList.contains('del-wire') || t.classList.contains('del-sel') || t.classList.contains('unplace')) deleteSelection(store);
    else if (t.classList.contains('goto-check')) store.setUi({ tab: 'check' });
    const li = t.closest<HTMLLIElement>('.net-list li');
    if (li?.dataset.hole) store.setUi({ netHole: li.dataset.hole.split(',').map(Number) as [number, number], tool: 'net' });
  });
  panel.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const partSec = t.closest<HTMLElement>('.part-props');
    if (partSec) return onPartPropChange(store, partSec, t);
    const wireSec = t.closest<HTMLElement>('.wire-props');
    if (wireSec && t.name === 'color') {
      store.update((p) => {
        const w = p.wires.find((ww) => ww.id === wireSec.dataset.id);
        if (w) w.color = t.value;
      });
    }
    if (t.name === 'netName') setNetName(store, t.value.trim());
  });
}

function onPartPropChange(store: Store, sec: HTMLElement, t: HTMLInputElement): void {
  const id = sec.dataset.id!;
  const part = store.project.parts.find((p) => p.id === id)!;
  if (t.name === 'ref' || t.name === 'value') {
    const v = t.value.trim();
    if (t.name === 'ref' && !v) return store.emit('panel');
    store.update((p) => {
      p.parts.find((pp) => pp.id === id)![t.name as 'ref' | 'value'] = v;
    });
    return;
  }
  const fp = getFootprint(part.footprint);
  const params = fp ? { ...part.params, ...readParams(fp, sec) } : part.params;
  const side = (sec.querySelector<HTMLSelectElement>('[name=side]')!.value as Side) ?? part.placement!.side;
  const rot = Number(sec.querySelector<HTMLSelectElement>('[name=rot]')!.value) as Rotation;
  const next: Part = { ...part, params, placement: { ...part.placement!, side, rot } };
  const r = checkPlacement(store.project, next, next.placement!);
  if (!r.ok) {
    store.setMessage(`変更できません: ${r.errors[0]}`, 'error');
    store.emit('panel');
    return;
  }
  store.update((p) => {
    const pp = p.parts.find((x) => x.id === id)!;
    pp.params = params;
    pp.placement = next.placement;
  });
}

function setNetName(store: Store, name: string): void {
  const hole = store.ui.netHole;
  if (!hole) return;
  const a = store.analysis;
  const netId = a.netOfHole.get(holeKey(hole[0], hole[1]));
  const net = netId ? a.nets.get(netId) : undefined;
  if (!net) return;
  store.update((p) => {
    // このネットに属する既存の名前を外してから付け直す
    p.nets = p.nets.filter((n) => !net.holes.has(holeKey(n.anchor[0], n.anchor[1])));
    if (name) p.nets.push({ name, anchor: hole });
  });
}

export function renderDesignTab(store: Store, el: HTMLElement): void {
  if (!shell || !el.contains(shell)) {
    el.innerHTML = '';
    shell = html(`<div class="design-tab"><div class="toolbar-slot"></div><div class="design-body"><div class="left-slot"></div><div class="views"></div><div class="right-slot"></div></div></div>`);
    el.appendChild(shell);
  }
  const tbSlot = shell.querySelector('.toolbar-slot')!;
  const layersOpen = tbSlot.querySelector<HTMLDetailsElement>('details.layers')?.open;
  tbSlot.replaceChildren(toolbar(store));
  if (layersOpen) tbSlot.querySelector<HTMLDetailsElement>('details.layers')!.open = true;
  const leftScroll = shell.querySelector('.left-slot .panel')?.scrollTop ?? 0;
  shell.querySelector('.left-slot')!.replaceChildren(leftPanel(store));
  shell.querySelector('.left-slot .panel')!.scrollTop = leftScroll;
  shell.querySelector('.right-slot')!.replaceChildren(rightPanel(store));
  ensureViews(store, shell.querySelector<HTMLElement>('.views')!);
  requestAnimationFrame(renderDesignViews);
}
