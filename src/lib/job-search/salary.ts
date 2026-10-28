// What a posting says it pays, against the salary floor in Settings → Job
// search (this fork; ₹40 LPA unless changed). Only Indian rupees are
// compared: a dollar or euro figure is shown as written, not converted at a
// rate Dossier would have to make up. Nothing is ever inferred from who the
// employer is — a posting that doesn't state pay says "Not disclosed".

import type { FoundPosting } from "./search";

export type SalaryVerdict = {
  /** Stated by the posting; estimated by the source (Adzuna's predicted salaries); or not given at all. */
  status: "stated" | "estimated" | "undisclosed";
  /** "INR", "USD", "EUR"…; "" when undisclosed or unknown. */
  currency: string;
  /** For rupees: the yearly range in lakhs (LPA). Null when not rupees, or not read. */
  minLpa: number | null;
  maxLpa: number | null;
  /** The words it was read from. */
  text: string;
};

const LAKH = 100_000;

const CURRENCY: [RegExp, string][] = [
  [/₹|\binr\b|\brs\.?\s|\brupees?\b|\blpa\b|\blakhs?\b|\blacs?\b|\bcrores?\b|\bctc\b/i, "INR"],
  [/\$|\busd\b/i, "USD"],
  [/€|\beur\b/i, "EUR"],
  [/£|\bgbp\b/i, "GBP"],
];

/** A rupee amount and the word after it, in lakhs a year: "40 LPA" → 40, "4,000,000" → 40, "1.2 Cr" → 120, "3,00,000 per month" → 36. */
function lakhs(amount: number, unit: string, monthly: boolean): number {
  const u = unit.toLowerCase();
  let value = /^(l|lpa|lakhs?|lacs?|lac)/.test(u) ? amount : /^(cr|crores?)/.test(u) ? amount * 100 : /^k\b/.test(u) ? (amount * 1000) / LAKH : amount / LAKH;
  if (monthly) value *= 12;
  return Math.round(value * 10) / 10;
}

/** Rupee figures in a piece of text, as LPA. */
function rupeeRange(text: string): { min: number; max: number } | null {
  const monthly = /\b(per\s+month|a\s+month|monthly|p\.?\s?m\.?)\b/i.test(text);
  const numbers = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|lac|l\b|crores?|cr\b|k\b)?/gi)]
    .map((match) => ({ amount: Number(match[1].replace(/,/g, "")), unit: match[2] ?? "" }))
    .filter(({ amount }) => Number.isFinite(amount) && amount > 0);
  if (numbers.length === 0) return null;
  // "40-60 LPA": the unit written once after the range goes for both.
  const unit = numbers.findLast((number) => number.unit)?.unit ?? "";
  const values = numbers.slice(0, 2).map(({ amount, unit: own }) => lakhs(amount, own || unit, monthly));
  const plausible = values.filter((value) => value >= 1 && value <= 2000);
  if (plausible.length === 0) return null;
  return { min: Math.min(...plausible), max: Math.max(...plausible) };
}

/** A salary sentence in a description: "₹40-60 LPA", "CTC: 35 lakhs", "INR 30,00,000 – 45,00,000". */
const IN_TEXT = /(?:₹|\binr\b|\brs\.?)\s*\d[\d,.]*(?:\s*(?:lpa|lakhs?|lacs?|l|cr|crores?))?(?:\s*[-–to]+\s*(?:₹|\binr\b|\brs\.?)?\s*\d[\d,.]*\s*(?:lpa|lakhs?|lacs?|l|cr|crores?)?)?|\d[\d.]*\s*[-–to]+\s*\d[\d.]*\s*(?:lpa|lakhs?|lacs?)\b|\d[\d.]*\s*(?:lpa|lakhs?\s+per\s+annum)\b/i;

/** What the posting says it pays: its salary field first, else a rupee figure in its text. */
export function readSalary(posting: Pick<FoundPosting, "salary" | "description">): SalaryVerdict {
  const field = posting.salary.trim();
  const fromText = field ? null : IN_TEXT.exec(posting.description.slice(0, 20_000));
  const text = field || fromText?.[0].trim() || "";
  if (!text) return { status: "undisclosed", currency: "", minLpa: null, maxLpa: null, text: "" };
  const currency = CURRENCY.find(([pattern]) => pattern.test(text))?.[1] ?? "";
  const status = /\b(estimated|predicted)\b/i.test(text) ? "estimated" : "stated";
  const range = currency === "INR" ? rupeeRange(text) : null;
  return { status, currency, minLpa: range?.min ?? null, maxLpa: range?.max ?? null, text };
}

/** Whether the pay reaches `floorLpa`: true or false for rupees that could be read, null when it can't be compared. */
export function meetsFloor(salary: SalaryVerdict, floorLpa: number): boolean | null {
  if (salary.maxLpa === null) return null;
  return salary.maxLpa >= floorLpa;
}

/** "₹40–60 LPA (stated)", "USD 150,000 a year (stated, not compared)", "Not disclosed". */
export function salaryLabel(salary: SalaryVerdict): string {
  if (salary.status === "undisclosed") return "Salary not disclosed";
  const kind = salary.status === "estimated" ? "estimate" : "stated";
  if (salary.maxLpa !== null) {
    const range = salary.minLpa !== null && salary.minLpa !== salary.maxLpa ? `${salary.minLpa}–${salary.maxLpa}` : `${salary.maxLpa}`;
    return `₹${range} LPA (${kind})`;
  }
  return `${salary.text} (${kind}${salary.currency && salary.currency !== "INR" ? ", not compared" : ""})`;
}
