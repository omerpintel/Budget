import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { findPeriod, type PeriodRef } from '@/data/periods';
import { periodKey } from '@/lib/money';
import type { BudgetPeriod } from '@/data/types';

function currentRef(): PeriodRef {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function shiftPeriod(ref: PeriodRef, delta: number): PeriodRef {
  const d = new Date(ref.year, ref.month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

interface PeriodContextValue {
  ref: PeriodRef;
  key: string;
  isCurrent: boolean;
  setRef: (ref: PeriodRef) => void;
  shiftBy: (delta: number) => void;
  goToCurrent: () => void;
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [ref, setRef] = useState<PeriodRef>(currentRef);

  const shiftBy = useCallback((delta: number) => {
    setRef((prev) => shiftPeriod(prev, delta));
  }, []);

  const goToCurrent = useCallback(() => setRef(currentRef()), []);

  const value = useMemo<PeriodContextValue>(() => {
    const now = currentRef();
    return {
      ref,
      key: periodKey(ref.year, ref.month),
      isCurrent: ref.year === now.year && ref.month === now.month,
      setRef,
      shiftBy,
      goToCurrent,
    };
  }, [ref, shiftBy, goToCurrent]);

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be used inside a PeriodProvider');
  return ctx;
}

/**
 * The stored row for the selected month, or null when nothing has happened in it yet.
 * Browsing to a month must not create it — only real work does that.
 */
export function usePeriodRecord() {
  const { ref } = usePeriod();
  return useQuery<BudgetPeriod | null>({
    queryKey: ['period', ref.year, ref.month],
    queryFn: () => findPeriod(ref),
  });
}
