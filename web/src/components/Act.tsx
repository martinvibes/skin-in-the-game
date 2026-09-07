/**
 * A section that owns its own ground.
 *
 * `theme` picks the palette the section declares on itself — nothing above it
 * changes, so scrolling from a smoke-white section onto a black one moves a
 * hard edge up the screen instead of repainting the document. The only thing
 * that reacts to which section you are over is the nav, which has to stay
 * legible on both.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

export function Act({
  theme,
  id,
  className = '',
  children,
  bare = false,
}: {
  theme: Theme;
  id?: string;
  className?: string;
  children: ReactNode;
  /** Skip the standard wrap, for sections that lay out their own container. */
  bare?: boolean;
}) {
  return (
    <section
      id={id}
      data-theme={theme}
      className={`${theme === 'dark' ? 'sect-dark' : 'sect-light'} py-24 md:py-36 ${className}`}
    >
      {bare ? children : <div className="wrap">{children}</div>}
    </section>
  );
}

/** Fades its children up once, when they first reach the viewport. */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          el.dataset.shown = 'true';
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.02 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** Section heading: kicker, headline, lede. */
export function Heading({
  kicker,
  title,
  lede,
  center = false,
}: {
  kicker: string;
  title: ReactNode;
  lede?: string;
  center?: boolean;
}) {
  return (
    <Reveal className={`mb-12 md:mb-16 ${center ? 'text-center' : ''}`}>
      <p className={`kicker mb-6 ${center ? 'justify-center' : ''}`}>{kicker}</p>
      <h2
        className={`font-display text-[clamp(30px,4.6vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-ink ${
          center ? 'mx-auto max-w-4xl' : 'max-w-3xl'
        }`}
      >
        {title}
      </h2>
      {lede && (
        <p
          className={`mt-5 text-[16px] leading-relaxed text-muted md:text-[17px] ${
            center ? 'mx-auto max-w-2xl' : 'max-w-2xl'
          }`}
        >
          {lede}
        </p>
      )}
    </Reveal>
  );
}
