import { describe, it, expect } from 'vitest';
import { parseContentDoc, safeParseContentDoc } from '../domain/content-doc.js';
import { validRawDoc } from './fixtures.js';

describe('ContentDoc validation (happy path)', () => {
  it('parses a valid document with typed sections', () => {
    const doc = parseContentDoc(validRawDoc());
    expect(doc.sections).toHaveLength(3);
    expect(doc.settings.noindex).toBe(true);
    expect(doc.settings.priceCents).toBe(19700);
  });

  it('applies defaults (noindex true, section enabled/version)', () => {
    const raw = validRawDoc();
    delete (raw.settings as { noindex?: boolean }).noindex;
    const doc = parseContentDoc(raw);
    expect(doc.settings.noindex).toBe(true);
  });
});

describe('ContentDoc validation (edge cases)', () => {
  it('rejects a document with zero sections', () => {
    const raw = { ...validRawDoc(), sections: [] };
    expect(safeParseContentDoc(raw).success).toBe(false);
  });

  it('rejects a section type outside the closed catalog', () => {
    const raw = validRawDoc();
    (raw.sections[0] as { type: string }).type = 'banner';
    expect(safeParseContentDoc(raw).success).toBe(false);
  });

  it('rejects duplicate section types', () => {
    const raw = validRawDoc();
    raw.sections.push({ ...raw.sections[0]!, position: 9 });
    const result = safeParseContentDoc(raw);
    expect(result.success).toBe(false);
  });

  it('rejects duplicate positions', () => {
    const raw = validRawDoc();
    raw.sections[1]!.position = raw.sections[0]!.position;
    expect(safeParseContentDoc(raw).success).toBe(false);
  });

  it('rejects invalid fields with a path scoped to the section', () => {
    const raw = validRawDoc();
    (raw.sections[0] as { fields: Record<string, unknown> }).fields = { headline: 'only' };
    const result = safeParseContentDoc(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0]!;
      expect(issue.path.slice(0, 2)).toEqual(['sections', 0]);
    }
  });

  it('rejects a float priceCents in settings', () => {
    const raw = validRawDoc();
    (raw.settings as { priceCents: number }).priceCents = 197.5;
    expect(safeParseContentDoc(raw).success).toBe(false);
  });
});
