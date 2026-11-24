const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export interface ParsedLeadListResult {
  emails: string[];
  totalTokensScanned: number;
  duplicatesRemoved: number;
}

/**
 * Extracts, validates, and deduplicates email leads from CSV or plain-text files.
 */
export function extractEmailLeadsFromText(content: string): ParsedLeadListResult {
  const matches = content.match(EMAIL_PATTERN) ?? [];
  const seen = new Set<string>();

  for (const match of matches) {
    seen.add(match.trim().toLowerCase());
  }

  return {
    emails: Array.from(seen),
    totalTokensScanned: matches.length,
    duplicatesRemoved: Math.max(0, matches.length - seen.size),
  };
}

export function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
