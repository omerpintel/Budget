export interface RunStatus {
  hasIncome: boolean;
  importedBatches: number;
  unreviewed: number;
  committed: boolean;
  /** True when the plan assigns more than income + joint buffer carryover. */
  overAllocated: boolean;
  /** Joint spending that no plan line covers yet. */
  unassignedActual: number;
  /** Joint spending still without a category, so it cannot be assigned at all. */
  uncategorized: number;
}

export const RUN_STEPS = [
  { id: 'bank', label: 'בנק' },
  { id: 'import', label: 'ייבוא' },
  { id: 'triage', label: 'מיון' },
  { id: 'allocate', label: 'שיוך' },
  { id: 'reconcile', label: 'התאמה' },
] as const;

export const FINAL_STEP = RUN_STEPS.length - 1;

/**
 * The wizard has no stored cursor: the step is derived from what is already done,
 * so closing the app mid-run and coming back lands you exactly where you stopped.
 * Allocation is a judgement call rather than a checklist item, so a fully sorted
 * month stops there and waits instead of skipping ahead to reconcile.
 */
export function deriveStep(status: RunStatus): number {
  if (status.committed) return FINAL_STEP;
  if (!status.hasIncome) return 0;
  if (status.importedBatches === 0) return 1;
  if (status.unreviewed > 0) return 2;
  return 3;
}

export function isStepComplete(status: RunStatus, step: number): boolean {
  switch (step) {
    case 0:
      return status.hasIncome;
    case 1:
      return status.importedBatches > 0;
    case 2:
      return status.importedBatches > 0 && status.unreviewed === 0;
    case 3:
      return (
        status.importedBatches > 0 &&
        status.unreviewed === 0 &&
        !status.overAllocated &&
        status.unassignedActual === 0
      );
    case 4:
      return status.committed;
    default:
      return false;
  }
}
