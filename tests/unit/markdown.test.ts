import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/help/Markdown';

// The help center's Markdown: headings may be followed directly by text, as the articles are written.
describe('help articles', () => {
  it('reads headings, paragraphs and lists line by line', () => {
    expect(parseMarkdown('## Your role\nYou run the conference.\nIt is fun.\n\n## Before\n1. **Committees.** Add them.\n2. Chairs.\n\n- one\n- two\nAfter the list.')).toEqual([
      { kind: 'h2', text: 'Your role' },
      { kind: 'p', text: 'You run the conference. It is fun.' },
      { kind: 'h2', text: 'Before' },
      { kind: 'ol', items: ['**Committees.** Add them.', 'Chairs.'] },
      { kind: 'ul', items: ['one', 'two'] },
      { kind: 'p', text: 'After the list.' },
    ]);
  });
});
