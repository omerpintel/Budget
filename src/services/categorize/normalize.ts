import { stripBidi } from '@/services/import/encoding';

/**
 * Israeli statements append a branch city to almost every merchant. Sorted by
 * length at use time so multi-word names are removed before their fragments.
 */
const CITIES = [
  'תל אביב יפו', 'תל אביב', 'ראשון לציון', 'פתח תקווה', 'פתח תקוה', 'באר שבע',
  'רמת השרון', 'רמת גן', 'קרית אונו', 'קרית ביאליק', 'קרית מוצקין', 'קרית אתא',
  'קרית ים', 'קרית גת', 'קרית מלאכי', 'קרית שמונה', 'אור יהודה', 'גבעת שמואל',
  'ראש העין', 'הוד השרון', 'כפר סבא', 'כפר יונה', 'זכרון יעקב', 'פרדס חנה',
  'מגדל העמק', 'בית שמש', 'בית שאן', 'נס ציונה', 'בני ברק', 'בת ים', 'גבעתיים',
  'ירושלים', 'חיפה', 'נתניה', 'חולון', 'רחובות', 'אשדוד', 'אשקלון', 'הרצליה',
  'רעננה', 'מודיעין', 'יהוד', 'לוד', 'רמלה', 'גדרה', 'יבנה', 'חדרה', 'כרמיאל',
  'עפולה', 'נצרת', 'טבריה', 'צפת', 'עכו', 'נהריה', 'אילת', 'דימונה', 'ערד',
  'שדרות', 'אופקים', 'נתיבות', 'אלעד', 'שוהם', 'נשר', 'יקנעם', 'עתלית',
  'טירת הכרמל', 'מעלה אדומים', 'אריאל', 'קיסריה', 'בנימינה', 'אשקלון',
];

const NOISE_WORDS = [
  'בעמ', 'בע"מ', 'ltd', 'limited', 'inc', 'llc', 'corp',
  'סניף', 'חנות', 'שירות עצמי', 'אינטרנט', 'online',
];

const INSTALLMENT_NOISE =
  /(תשלום\s*\d+\s*(?:מתוך|מ־|מ-|מ)\s*\d+)|(\d+\s*מתוך\s*\d+\s*תשלומים)|(תשלומים)|(עסקת קרדיט)|(חיוב חודשי)|(מנוי חודשי)/g;

const DATE_NOISE = /\b\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\b/g;

/**
 * Collapses a raw statement description to a stable merchant identity, so that
 * "שופרסל דיל רמת גן 4471" and "שופרסל דיל תל אביב" become the same merchant.
 */
export function normalizeMerchant(raw: string): string {
  let text = stripBidi(raw ?? '').trim();
  if (text === '') return '';

  // "PAYPAL *STEAM" and "EBAY O*12345" bill through an aggregator; keep the real vendor.
  const aggregator = /^[A-Za-z0-9\s.]+\*\s*(.+)$/.exec(text);
  if (aggregator && aggregator[1].trim().length > 1) text = aggregator[1];

  text = text
    .replace(INSTALLMENT_NOISE, ' ')
    .replace(DATE_NOISE, ' ')
    .replace(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.(?:com|net|org|co\.il|org\.il|io|shop)\b/gi, '$1')
    .replace(/["'״׳`]/g, '')
    .replace(/[()\[\]{}.,:;|/\\_+*#@!?%$&^~<>=]/g, ' ')
    .replace(/-/g, ' ')
    .toLowerCase();

  for (const word of NOISE_WORDS) {
    text = text.replace(new RegExp(`(^|\\s)${escapeRegex(word.toLowerCase())}(\\s|$)`, 'g'), ' ');
  }

  // Card suffixes, branch codes and reference numbers, but not small counts like "פיצה 2".
  text = text.replace(/\b\d{3,}\b/g, ' ');

  text = collapse(text);
  text = stripCities(text);
  text = text.replace(/\s+\d{1,2}$/, '');

  return collapse(text) || collapse(stripBidi(raw).toLowerCase());
}

function stripCities(text: string): string {
  const sorted = [...new Set(CITIES)].sort((a, b) => b.length - a.length);
  for (const city of sorted) {
    const stripped = collapse(
      text.replace(new RegExp(`(^|\\s)${escapeRegex(city)}(\\s|$)`, 'g'), ' '),
    );
    // Never let a city name consume the entire merchant identity.
    if (stripped !== '') text = stripped;
  }
  return text;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Secondary lookup key. Branch identifiers that are not city names (streets, malls)
 * still differ between rows, so the leading tokens act as a family key:
 * "סופר פארם דיזנגוף" and "סופר פארם רמת אביב" share "סופר פארם".
 */
export function merchantPrefixKey(normalized: string): string {
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length <= 2) return normalized;
  return tokens.slice(0, 2).join(' ');
}

/** Title-cased display form, preserving Hebrew as-is. */
export function displayMerchant(raw: string): string {
  const text = collapse(stripBidi(raw ?? ''));
  if (text === '') return '';
  return text
    .split(' ')
    .map((word) =>
      /^[a-z]/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word,
    )
    .join(' ');
}
