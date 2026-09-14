import { describe, expect, it } from 'vitest';
import { displayMerchant, merchantPrefixKey, normalizeMerchant } from './normalize';

describe('normalizeMerchant', () => {
  it('collapses branch cities and card suffixes into one identity', () => {
    expect(normalizeMerchant('שופרסל דיל רמת גן 4471')).toBe('שופרסל דיל');
    expect(normalizeMerchant('שופרסל דיל תל אביב')).toBe('שופרסל דיל');
    expect(normalizeMerchant('ארומה תל אביב')).toBe('ארומה');
  });

  it('strips installment and subscription noise', () => {
    expect(normalizeMerchant('איקאה נתניה תשלום 3 מתוך 12')).toBe('איקאה');
    expect(normalizeMerchant('נטפליקס מנוי חודשי')).toBe('נטפליקס');
  });

  it('unwraps payment aggregators to the real vendor', () => {
    expect(normalizeMerchant('PAYPAL *STEAM')).toBe('steam');
    expect(normalizeMerchant('EBAY O*ETSY')).toBe('etsy');
  });

  it('drops domain suffixes', () => {
    expect(normalizeMerchant('NETFLIX.COM')).toBe('netflix');
    expect(normalizeMerchant('KSP.CO.IL')).toBe('ksp');
  });

  it('removes company suffixes', () => {
    expect(normalizeMerchant('פז חברת נפט בע"מ')).toBe('פז חברת נפט');
    expect(normalizeMerchant('Wolt Enterprises Ltd')).toBe('wolt enterprises');
  });

  it('never reduces a merchant to an empty string', () => {
    expect(normalizeMerchant('תל אביב')).toBe('תל אביב');
    expect(normalizeMerchant('12345')).not.toBe('');
    expect(normalizeMerchant('')).toBe('');
  });

  it('is stable across repeated normalisation', () => {
    const once = normalizeMerchant('שופרסל דיל רמת גן 4471');
    expect(normalizeMerchant(once)).toBe(once);
  });

  it('keeps genuinely different merchants apart', () => {
    expect(normalizeMerchant('רמי לוי שיווק')).not.toBe(normalizeMerchant('שופרסל דיל'));
  });
});

describe('merchantPrefixKey', () => {
  it('groups branches that differ by a street or mall name', () => {
    const a = merchantPrefixKey(normalizeMerchant('סופר פארם דיזנגוף'));
    const b = merchantPrefixKey(normalizeMerchant('סופר פארם רמת אביב'));
    expect(a).toBe(b);
    expect(a).toBe('סופר פארם');
  });

  it('leaves short names untouched', () => {
    expect(merchantPrefixKey('ארומה')).toBe('ארומה');
    expect(merchantPrefixKey('שופרסל דיל')).toBe('שופרסל דיל');
  });
});

describe('displayMerchant', () => {
  it('title-cases Latin and leaves Hebrew alone', () => {
    expect(displayMerchant('NETFLIX.COM')).toBe('NETFLIX.COM');
    expect(displayMerchant('wolt israel')).toBe('Wolt Israel');
    expect(displayMerchant('שופרסל דיל')).toBe('שופרסל דיל');
  });
});
