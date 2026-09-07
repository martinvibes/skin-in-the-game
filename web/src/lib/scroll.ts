/**
 * Smooth scrolling, and the anchor handling it costs.
 *
 * The page scrolls natively — the wheel still moves `window.scrollY` — but the
 * content is drawn at a position that eases toward it instead of tracking it
 * exactly. That is the whole trick: one lerp per frame on a single transform.
 * It costs no library and it degrades to ordinary scrolling the moment the
 * reader has asked for reduced motion or is on a touch device, where the
 * platform already has momentum of its own and a second one fights it.
 *
 * The cost is that the content is `position: fixed`, so it no longer answers to
 * `scrollIntoView` or `#anchor` navigation. `scrollToId` below is the
 * replacement, and the nav uses it.
 */
import { useEffect } from 'react';

const EASE = 0.072;
const CONTENT_ID = 'scroll-content';

function wantsSmooth(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  // Touch surfaces already have inertia; layering ours on top feels like drag.
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function useSmoothScroll(deps: unknown[] = []): void {
  useEffect(() => {
    const content = document.getElementById(CONTENT_ID);
    if (!content) return;

    if (!wantsSmooth()) {
      document.body.style.height = '';
      content.removeAttribute('style');
      return;
    }

    let current = window.scrollY;
    let frame = 0;

    const syncHeight = () => {
      document.body.style.height = `${content.scrollHeight}px`;
    };

    Object.assign(content.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      willChange: 'transform',
    });

    const observer = new ResizeObserver(syncHeight);
    observer.observe(content);
    syncHeight();

    const tick = () => {
      const target = window.scrollY;
      current += (target - current) * EASE;
      // Snap the last fraction of a pixel so the transform can settle and the
      // compositor is not handed a new matrix every frame forever.
      if (Math.abs(target - current) < 0.08) current = target;
      content.style.transform = `translate3d(0, ${-current}px, 0)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      content.removeAttribute('style');
      document.body.style.height = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Scroll to an element by id, through the window rather than the element. */
export function scrollToId(id: string): void {
  const el = document.getElementById(id);
  const content = document.getElementById(CONTENT_ID);
  if (!el) return;
  const withinContent = content?.style.position === 'fixed';
  const top = withinContent
    ? el.getBoundingClientRect().top + window.scrollY - contentOffset(content)
    : el.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: Math.max(0, top - 84), behavior: 'smooth' });
}

/** How far the eased transform currently lags the real scroll position. */
function contentOffset(content: HTMLElement | null): number {
  if (!content) return 0;
  const m = /translate3d\(0px,\s*(-?[\d.]+)px/.exec(content.style.transform);
  return m?.[1] ? Number(m[1]) + window.scrollY : 0;
}

/** Jump to the top instantly — used when the reader switches views. */
export function resetScroll(): void {
  window.scrollTo({ top: 0, behavior: 'auto' });
}
