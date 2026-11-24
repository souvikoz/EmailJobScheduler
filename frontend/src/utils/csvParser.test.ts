import { describe, expect, it } from 'vitest';
import { extractEmailLeadsFromText, isValidEmailAddress } from './csvParser';

describe('CSV / Text Lead Parser', () => {
  it('extracts, normalizes, and deduplicates email addresses from CSV and messy text', () => {
    const csv = `name,email,company
Alice Smith,Alice.Smith@Example.com,Acme
Bob,bob@domain.io,Beta
Duplicate,alice.smith@example.com,Acme
InvalidRow,not-an-email,Gamma
Charlie,charlie+tag@sub.example.co.uk,Delta`;

    const result = extractEmailLeadsFromText(csv);
    expect(result.emails).toEqual([
      'alice.smith@example.com',
      'bob@domain.io',
      'charlie+tag@sub.example.co.uk',
    ]);
    expect(result.totalTokensScanned).toBe(4);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('validates individual emails cleanly', () => {
    expect(isValidEmailAddress('user@example.com')).toBe(true);
    expect(isValidEmailAddress('invalid@')).toBe(false);
    expect(isValidEmailAddress('plain-text')).toBe(false);
  });
});
