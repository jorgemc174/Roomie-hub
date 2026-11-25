import { decimal, parseDecimal, type SplitMode } from './money';

export type ExpenseDraft = {
  title: string;
  amount: string;
  /** Variable recurring templates have no amount: the split is checked against 100.00 %. */
  variable: boolean;
  mode: SplitMode;
  participants: string[];
  shares: Record<string, string>;
  scale: number;
};
export type SplitSum = { mode: 'custom' | 'percentage'; sum: bigint; target: bigint };
export type ExpenseIssues = {
  title?: 'required';
  amount?: 'positive' | 'format';
  participants?: 'required';
  shares?: 'format';
  /** Present whenever the split is custom or percentage and its sum can be computed. */
  sum?: SplitSum;
};

const signedNumber = /^-\s*\d+([.,]\d+)?$/;

/** Field-level checks shared by the form (before sending) and the server action. */
export function checkExpense(draft: ExpenseDraft): ExpenseIssues {
  const issues: ExpenseIssues = {};
  if (!draft.title.trim()) issues.title = 'required';
  let total: bigint | undefined = draft.variable ? 10000n : undefined;
  if (!draft.variable) {
    const text = draft.amount.trim();
    if (!text || signedNumber.test(text)) issues.amount = 'positive';
    else {
      try {
        total = parseDecimal(text, draft.scale);
        if (total <= 0n) {
          issues.amount = 'positive';
          total = undefined;
        }
      } catch {
        issues.amount = 'format';
      }
    }
  }
  if (!draft.participants.length) issues.participants = 'required';
  if (draft.mode !== 'equal' && draft.participants.length) {
    const scale = draft.mode === 'percentage' ? 2 : draft.scale;
    let sum = 0n;
    try {
      for (const id of draft.participants) sum += parseDecimal(shareValue(draft.shares[id]), scale);
    } catch {
      issues.shares = 'format';
    }
    const target = draft.mode === 'percentage' ? 10000n : total;
    if (!issues.shares && target !== undefined) issues.sum = { mode: draft.mode, sum, target };
  }
  return issues;
}

/** An empty custom or percentage share means "this participant pays nothing". */
export function shareValue(value: string | undefined): string {
  return value?.trim() || '0';
}

export function splitMismatch(issues: ExpenseIssues): boolean {
  return Boolean(issues.shares || (issues.sum && issues.sum.sum !== issues.sum.target));
}

export function hasFieldIssues(issues: ExpenseIssues): boolean {
  return Boolean(issues.title || issues.amount || issues.participants);
}

/**
 * Keeps an optional leading minus (so a negative amount is reported, not silently fixed),
 * digits and one decimal separator, and drops any decimal beyond the currency scale.
 */
export function limitDecimals(value: string, scale: number): string {
  const negative = value.trimStart().startsWith('-');
  let text = '',
    separator = false,
    decimals = 0;
  for (const char of value) {
    if (char >= '0' && char <= '9') {
      if (separator) {
        if (decimals >= scale) continue;
        decimals++;
      }
      text += char;
    } else if ((char === '.' || char === ',') && !separator && scale > 0) {
      separator = true;
      text += char;
    }
  }
  return (negative ? '-' : '') + text;
}

/** Percentages are stored as hundredths of a percent: 8000 → "80 %" (es) / "80%" (en). */
export function formatPercent(hundredths: bigint, locale: string): string {
  const format = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 });
  return (format.format as unknown as (value: string) => string)(decimal(hundredths, 4));
}

export function fillMessage(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
