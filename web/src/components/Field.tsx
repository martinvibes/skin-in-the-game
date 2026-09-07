/**
 * The moving ground behind the console.
 *
 * Not a fluid or a mesh gradient — a slowly drifting contour field, the shape
 * you get if you plot a probability density and then draw its level sets. It is
 * the picture the agent is actually working from, running at a speed you notice
 * only if you stop and look at it.
 *
 * Cheap on purpose: each line is a polyline whose height is three summed sines,
 * so there is no noise library, no per-pixel work, and the whole thing is a
 * couple of hundred `lineTo` calls a frame. It draws one static frame and stops
 * when the reader has asked for reduced motion.
 */
import { useEffect, useRef } from 'react';

const LINES = 34;
const STEP = 14; // horizontal sample spacing, px

export function Field({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let frame = 0;
    let t = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const mid = LINES / 2;

      for (let i = 0; i < LINES; i++) {
        // Amplitude and opacity peak in the middle of the stack, so the field
        // reads as a ridge rather than as evenly spaced wallpaper.
        const d = 1 - Math.abs(i - mid) / mid;
        const amp = 8 + d * d * 64;
        const alpha = 0.05 + Math.pow(d, 1.6) * 0.22;
        const y0 = ((i + 0.5) / LINES) * h;

        ctx.beginPath();
        for (let x = -STEP; x <= w + STEP; x += STEP) {
          const p = x / w;
          const y =
            y0 +
            Math.sin(p * 3.1 + t * 0.9 + i * 0.34) * amp +
            Math.sin(p * 6.7 - t * 1.4 + i * 0.19) * amp * 0.34 +
            Math.sin(p * 1.3 + t * 0.5 - i * 0.11) * amp * 0.5;
          if (x <= 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(245, 245, 243, ${alpha})`;
        ctx.lineWidth = 1 + d * 0.4;
        ctx.stroke();
      }
    };

    const loop = () => {
      t += 0.0022;
      draw();
      frame = requestAnimationFrame(loop);
    };

    resize();
    if (reduced) {
      draw();
    } else {
      frame = requestAnimationFrame(loop);
    }

    const observer = new ResizeObserver(() => {
      resize();
      draw();
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
