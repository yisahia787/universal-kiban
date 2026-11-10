import './style.css';
import { Store } from './model/store';
import { App } from './ui/app';

const store = new Store();
if (store.project.parts.length === 0 && store.project.wires.length === 0) store.ui.tab = 'board';
new App(store, document.getElementById('app')!);

// デバッグ・自動テスト用
(window as unknown as { ukb: Store }).ukb = store;
