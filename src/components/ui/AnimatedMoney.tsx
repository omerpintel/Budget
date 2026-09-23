import { useEffect, useRef, useState } from 'react';
import { formatAgorot } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Counts from the previous value to the new one. Balances change for a reason —
 * seeing the number travel makes it obvious which tile just moved.
 */
export function AnimatedMoney({
  value,
  className,
  signed = false,
  duration = 500,
}: {
  value: number;
  className?: string;
  signed?: boolean;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    if (reduced || from === value) {
      fromRef.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // Ease-out so the last digits settle instead of snapping.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  return <span className={cn('tnum', className)}>{formatAgorot(shown, { signed })}</span>;
}
