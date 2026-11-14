import type { Pack } from '@/protocol/schema';

// The resolution workflow: which steps a document may take, and what the rules require first.

export type DocStatus = 'draft' | 'submitted' | 'approved' | 'introduced' | 'passed' | 'failed' | 'withdrawn';

export interface DocumentRow {
  id: string;
  kind: string;
  code: string;
  title: string;
  body: string;
  parent_id: string | null;
  sponsors: string[];
  signatories: string[];
  status: DocStatus;
  created_at: string;
}

// Where a document can go from each state. Passed and failed come only from a vote.
export const NEXT: Record<DocStatus, DocStatus[]> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['approved', 'draft', 'withdrawn'],
  approved: ['introduced', 'draft', 'withdrawn'],
  introduced: ['withdrawn'],
  passed: [],
  failed: [],
  withdrawn: ['draft'],
};

export type DocProblem = 'step' | 'kind' | 'sponsors' | 'tooManySponsors' | 'signatories' | 'notVotable';

export function checkDocument(doc: DocumentRow, to: DocStatus, pack: Pack): DocProblem | null {
  if (!NEXT[doc.status]?.includes(to)) return 'step';
  const kind = pack.documents.find((k) => k.key === doc.kind);
  if (!kind) return to === 'withdrawn' || to === 'draft' ? null : 'kind';
  if (to === 'approved' || to === 'introduced') {
    if (doc.sponsors.length < kind.minSponsors) return 'sponsors';
    if (kind.maxSponsors > 0 && doc.sponsors.length > kind.maxSponsors) return 'tooManySponsors';
    if (doc.signatories.length < kind.minSignatories) return 'signatories';
  }
  if (to === 'introduced' && !kind.votable) return 'notVotable';
  return null;
}
