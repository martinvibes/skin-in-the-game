/**
 * Top bar and view switcher.
 *
 * The app is four views rather than one long scroll, because "what does it do"
 * and "how has it done" are different questions and a reader arrives with only
 * one of them. Views are local state, not routes: the whole thing ships as a
 * static bundle, and a router would buy nothing but a rewrite rule.
 */

import type { Mode } from '../lib/data';

export const VIEWS = ['console', 'record', 'markets', 'how it works'] as const;
export type View = (typeof VIEWS)[number];

export function Nav({
  view,
  onView,
  mode,
}: {
  view: View;
  onView: (v: View) => void;
  mode: Mode;
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-void/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 md:px-8">
        <a href="#top" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-cream font-display text-base font-bold text-void">
            S
          </span>
          <span className="font-display text-[17px] font-semibold tracking-tight text-cream">
            Skin
          </span>
        </a>
        <span className="chip hidden sm:inline-flex">skin in the game</span>

        <nav className="mx-auto hidden items-center gap-1 md:flex">
          {VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => onView(v)}
              aria-current={view === v ? 'page' : undefined}
              className={`rounded-full px-3.5 py-1.5 font-display text-sm capitalize transition ${
                view === v ? 'bg-raised text-cream' : 'text-muted hover:text-cream'
              }`}
            >
              {v}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <span
            className="chip !border-money/35 !text-money"
            title={
              mode === 'demo'
                ? 'Synthetic fixtures. No wallet, no money moved.'
                : 'Live wallet data.'
            }
          >
            <span className="h-1.5 w-1.5 rounded-full bg-money" />
            {mode}
          </span>
          <a
            className="btn-ghost !px-4 !py-2"
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
      <div className="scrollbar-thin flex gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden">
        {VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
            aria-current={view === v ? 'page' : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 font-display text-sm capitalize transition ${
              view === v ? 'bg-raised text-cream' : 'text-muted'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </header>
  );
}
