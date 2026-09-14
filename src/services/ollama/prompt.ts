export interface CategoryOption {
  slug: string;
  name: string;
  hint?: string;
}

export interface MerchantQuery {
  merchant: string;
  /** Typical charge in shekels, rounded — helps separate a cafe from a furniture shop. */
  typicalAmount: number;
  /** The issuer's own label, when the statement provided one. */
  issuerHint?: string | null;
}

const SYSTEM_PROMPT = `You classify bank and credit-card merchants for an Israeli household budget.

Rules:
- Reply with JSON only, matching the schema. No prose.
- Choose category_slug ONLY from the provided list. Never invent one.
- Most merchant names are Hebrew. Use your knowledge of Israeli chains and brands.
- confidence is 0.0-1.0 and must reflect real certainty. If you are guessing, use "uncategorized" with a low confidence.
- Return exactly one entry per merchant you were given, using the merchant string verbatim.`;

export function buildCategoryList(categories: CategoryOption[]): string {
  return categories
    .map((c) => `- ${c.slug}: ${c.name}${c.hint ? ` (${c.hint})` : ''}`)
    .join('\n');
}

export function buildMessages(categories: CategoryOption[], merchants: MerchantQuery[]) {
  const payload = merchants.map((m) => ({
    merchant: m.merchant,
    typical_amount_ils: m.typicalAmount,
    ...(m.issuerHint ? { issuer_hint: m.issuerHint } : {}),
  }));

  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `Categories:\n${buildCategoryList(categories)}\n\nMerchants:\n${JSON.stringify(
        payload,
        null,
        1,
      )}`,
    },
  ];
}

/** Constraining category_slug to an enum makes an invented category structurally impossible. */
export function buildResponseSchema(slugs: string[]) {
  return {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            merchant: { type: 'string' },
            category_slug: { type: 'string', enum: slugs },
            confidence: { type: 'number' },
          },
          required: ['merchant', 'category_slug', 'confidence'],
        },
      },
    },
    required: ['results'],
  };
}
