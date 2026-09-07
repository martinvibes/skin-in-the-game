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
 * of them; it reads the `data-theme` of whatever is under its own bottom edge
 * and adopts that palette. Nothing else on the page changes colour.
 */

import { useEffect, useRef, useState } from 'react';
import type { Mode } from '../lib/data';

export const VIEWS = ['console', 'record', 'markets', 'how it works'] as const;
export type View = (typeof VIEWS)[number];

const BAR_H = 64;

function useSectionUnderBar(deps: unknown[]): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const frame = useRef(0);

  useEffect(() => {
    const read = () => {
      frame.current = 0;
      // elementFromPoint answers with whatever is actually painted there, which
      // survives the smooth-scroll transform that offsets every layout box.
      const el = document.elementFromPoint(24, BAR_H + 24);
      const section = el?.closest<HTMLElement>('[data-theme]');
      setTheme(section?.dataset.theme === 'dark' ? 'dark' : 'light');
    };
    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame.current);
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
        className="border-b backdrop-blur-xl transition-colors duration-300 hair"
        style={{ background: 'rgb(var(--c-bg) / 0.82)' }}
      >
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-6 md:px-10">
          <button onClick={() => onView('console')} className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-ink font-display text-base font-bold text-bg">
              S
            </span>
            <span className="font-display text-[17px] font-semibold tracking-tight text-ink">
              Skin
            </span>
          </button>
          <span className="chip hidden sm:inline-flex">skin in the game</span>

          <nav className="mx-auto hidden items-center gap-1 md:flex">
            {VIEWS.map((v) => (
              <button
                key={v}
                onClick={() => onView(v)}
                aria-current={view === v ? 'page' : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm capitalize transition ${
                  view === v ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {v}
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
              className="btn-ghost !px-4 !py-2 !text-sm"
              href="https://github.com/martinvibes/skin-in-the-game"
              target="_blank"
              rel="noreferrer"
            >
              GitHub <span aria-hidden>↗</span>
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
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm capitalize transition ${
                view === v ? 'bg-raised text-ink' : 'text-muted'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
