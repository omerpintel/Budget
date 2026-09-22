import { describe, expect, it } from 'vitest';
import { deriveStep, FINAL_STEP, isStepComplete, type RunStatus } from './runModel';

const status = (partial: Partial<RunStatus> = {}): RunStatus => ({
  hasIncome: false,
  importedBatches: 0,
  unreviewed: 0,
  committed: false,
  ...partial,
});

describe('deriveStep', () => {
  it('starts at the bank step on a fresh month', () => {
    expect(deriveStep(status())).toBe(0);
  });

  it('moves to import once income is entered', () => {
    expect(deriveStep(status({ hasIncome: true }))).toBe(1);
  });

  it('moves to triage once a statement is in and rows need review', () => {
    expect(deriveStep(status({ hasIncome: true, importedBatches: 1, unreviewed: 5 }))).toBe(2);
  });

  it('stops at allocation when nothing is left to review', () => {
    expect(deriveStep(status({ hasIncome: true, importedBatches: 1, unreviewed: 0 }))).toBe(3);
  });

  it('pins a committed period to the final step regardless of anything else', () => {
    expect(deriveStep(status({ committed: true }))).toBe(FINAL_STEP);
    expect(deriveStep(status({ committed: true, unreviewed: 99 }))).toBe(FINAL_STEP);
  });

  it('resumes mid-run rather than restarting', () => {
    const interrupted = status({ hasIncome: true, importedBatches: 2, unreviewed: 12 });
    expect(deriveStep(interrupted)).toBe(2);
  });
});

describe('isStepComplete', () => {
  it('marks the bank step done only when income exists', () => {
    expect(isStepComplete(status(), 0)).toBe(false);
    expect(isStepComplete(status({ hasIncome: true }), 0)).toBe(true);
  });

  it('does not call triage complete when nothing was imported', () => {
    expect(isStepComplete(status({ unreviewed: 0 }), 2)).toBe(false);
    expect(isStepComplete(status({ importedBatches: 1, unreviewed: 0 }), 2)).toBe(true);
  });

  it('marks reconcile complete only after commit', () => {
    expect(isStepComplete(status({ hasIncome: true, importedBatches: 1 }), FINAL_STEP)).toBe(false);
    expect(isStepComplete(status({ committed: true }), FINAL_STEP)).toBe(true);
  });

  it('opens allocation once triage is clear, without needing a commit', () => {
    expect(isStepComplete(status({ importedBatches: 1, unreviewed: 0 }), 3)).toBe(true);
    expect(isStepComplete(status({ importedBatches: 1, unreviewed: 4 }), 3)).toBe(false);
  });
});
