import { describe, expect, it } from 'vitest';
import { formatAgorot, parseMoneyInput, toAgorot, toMajor, periodKey } from './money';

describe('money', () => {
  it('round-trips major units through agorot without drift', () => {
    for (const value of [0, 0.01, 12.34, 1999.99, 48000]) {
      expect(toMajor(toAgorot(value))).toBeCloseTo(value, 10);
    }
  });

  it('formats as LTR shekel with no bidi control characters', () => {
    const out = formatAgorot(3_000_000);
    expect(out).toBe('₪30,000');
    expect(out).not.toMatch(/[\u200e\u200f\u202a-\u202e]/);
  });

  it('uses a true minus sign for negative balances', () => {
    expect(formatAgorot(-125_000)).toBe('−₪1,250');
  });

  it('adds an explicit plus only when signed output is requested', () => {
    expect(formatAgorot(50_000, { signed: true })).toBe('+₪500');
    expect(formatAgorot(0, { signed: true })).toBe('₪0');
  });

  it('parses user input with separators and currency noise', () => {
    expect(parseMoneyInput('₪12,500')).toBe(1_250_000);
    expect(parseMoneyInput('48000')).toBe(4_800_000);
    expect(parseMoneyInput('-250.5')).toBe(-25_050);
    expect(parseMoneyInput('')).toBeNull();
  });

  it('zero-pads period keys so they sort lexicographically', () => {
    expect(periodKey(2026, 9)).toBe('2026-09');
    expect(periodKey(2026, 12) > periodKey(2026, 9)).toBe(true);
  });
});
