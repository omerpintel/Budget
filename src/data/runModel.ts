export interface RunStatus {
  hasIncome: boolean;
  importedBatches: number;
  unreviewed: number;
  committed: boolean;
}

export const RUN_STEPS = [
  { id: 'bank', label: 'בנק' },
  { id: 'import', label: 'ייבוא' },
  { id: 'triage', label: 'מיון' },
  { id: 'reconcile', label: 'התאמה' },
] as const;

/**
 * The wizard has no stored cursor: the step is derived from what is already done,
 * so closing the app mid-run and coming back lands you exactly where you stopped.
 */
export function deriveStep(status: RunStatus): number {
  if (status.committed) return 3;
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
      return status.committed;
    default:
      return false;
  }
}
