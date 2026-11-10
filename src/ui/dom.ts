export { esc } from '../canvas/render';

/** HTML 文字列から要素を作る */
export function html<T extends HTMLElement = HTMLElement>(s: string): T {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild as T;
}

export function download(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
