/** Animate from the current height, including interrupted transitions. */
export function createExpansion(region: HTMLElement, content: HTMLElement) {
  let expanded = false;
  const resize = () => {
    region.style.height = `${expanded ? content.getBoundingClientRect().height : 0}px`;
  };
  new ResizeObserver(resize).observe(content);
  return (open: boolean) => {
    expanded = open;
    region.inert = !open;
    region.dataset.expanded = String(open);
    resize();
  };
}
