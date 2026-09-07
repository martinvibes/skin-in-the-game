/**
 * Top bar and view switcher.
 *
 * The app is four views rather than one long scroll, because "what does it do"
 * and "how has it done" are different questions and a reader arrives with only
 * one of them. Views are local state, not routes: the whole thing ships as a
 * static bundle, and a router would buy nothing but a rewrite rule.
 *
 * The bar is the only element that reacts to the section behind it. Sections
 * own their own ground, so a fixed bar would otherwise be unreadable over half
 * of them; it reads the `data-theme` of whatever is painted under its own
 * bottom edge and adopts that palette. Nothing else on the page changes colour.
 */

import { useEffect, useState } from 'react';
import { Logo } from './Logo';
import type { Mode } from '../lib/data';

export const VIEWS = ['console', 'record', 'markets', 'how it works'] as const;
export type View = (typeof VIEWS)[number];

const BAR_H = 64;
/** How long the eased scroll takes to land, plus a frame of margin. */
const SETTLE_MS = 1100;

/** Views are lowercase in code and title case on screen. */
function title(v: string): string {
  return v.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A label that rolls out of the way and back in on hover. */
export function Roll({ children }: { children: string }) {
  return (
    <span className="roll" data-text={children}>
      <span>{children}</span>
    </span>
  );
}

function useSectionUnderBar(deps: unknown[]): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    let frame = 0;
    let until = 0;

    const sample = () => {
      // elementFromPoint answers with whatever is actually painted there, which
      // survives the smooth-scroll transform that offsets every layout box.
      const el = document.elementFromPoint(24, BAR_H + 24);
      const section = el?.closest<HTMLElement>('[data-theme]');
      setTheme(section?.dataset.theme === 'dark' ? 'dark' : 'light');
    };

    const loop = () => {
      sample();
      frame = performance.now() < until ? requestAnimationFrame(loop) : 0;
    };

    const onScroll = () => {
      // Scroll events stop the instant the wheel does, but the content is still
      // easing into place for most of a second afterwards, so the pixel under
      // the bar keeps changing after the last event. Sampling only on the event
      // reads the ground the page is leaving rather than the one it lands on.
      until = performance.now() + SETTLE_MS;
      if (!frame) frame = requestAnimationFrame(loop);
    };

    sample();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return theme;
}

export function Nav({
  view,
  onView,
  mode,
}: {
  view: View;
  onView: (v: View) => void;
  mode: Mode;
}) {
  const over = useSectionUnderBar([view]);

  return (
    <header
      className={`${over === 'dark' ? 'sect-dark' : 'sect-light'} fixed inset-x-0 top-0 z-50`}
      style={{ background: 'transparent' }}
    >
      <div
        className="glass border-b transition-colors duration-500 hair"
        style={{ background: 'rgb(var(--c-bg) / 0.62)' }}
      >
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-6 md:px-10">
          <Logo onClick={() => onView('console')} />

          <nav className="mx-auto hidden items-center gap-1 md:flex">
            {VIEWS.map((v) => (
              <button
                key={v}
                onClick={() => onView(v)}
                aria-current={view === v ? 'page' : undefined}
                className={`roll-host rounded-full px-3.5 py-1.5 text-sm transition-colors duration-300 ${
                  view === v ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                <Roll>{title(v)}</Roll>
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <span
              className="chip !text-accent"
              style={{ borderColor: 'rgb(var(--c-accent) / 0.35)' }}
              title={
                mode === 'demo'
                  ? 'Synthetic fixtures. No wallet, no money moved.'
                  : 'Live wallet data.'
              }
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {mode}
            </span>
            <a
              className="btn-ghost ink-well roll-host !px-4 !py-2 !text-sm"
              href="https://github.com/martinvibes/skin-in-the-game"
              target="_blank"
              rel="noreferrer"
            >
              <Roll>GitHub</Roll> <span aria-hidden>↗</span>
            </a>
          </div>
        </div>

        {/* Mobile view switcher: the desktop nav collapses, but the four views
            still have to be reachable, so they become a scrollable rail. */}
        <div className="scrollbar-thin flex gap-1 overflow-x-auto border-t px-6 py-2 hair md:hidden">
          {VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => onView(v)}
              aria-current={view === v ? 'page' : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors duration-300 ${
                view === v ? 'bg-raised text-ink' : 'text-muted'
              }`}
            >
              {title(v)}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
