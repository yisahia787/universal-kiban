/** 押下中の修飾キー（スペースでのスクロール用） */
export const keys = { space: false };

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !isTyping(e.target)) keys.space = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') keys.space = false;
});
window.addEventListener('blur', () => {
  keys.space = false;
});

export function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}
