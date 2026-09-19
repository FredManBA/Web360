import { describe, expect, it } from 'vitest';

import {
  canApproveReview,
  canArchiveProperty,
  canPublishProperty,
  canRequestChanges,
  canRestoreToDraft,
  canSubmitForReview,
  nextPublicationStatuses,
} from './states';
import { PUBLICATION_STATUSES, REVIEW_STATUSES } from './vocabularies';

describe('canSubmitForReview', () => {
  it('solo desde borrador', () => {
    for (const status of PUBLICATION_STATUSES) {
      expect(canSubmitForReview(status)).toBe(status === 'draft');
    }
  });
});

describe('canApproveReview / canRequestChanges', () => {
  it('solo sobre una revision pendiente', () => {
    for (const status of REVIEW_STATUSES) {
      expect(canApproveReview(status)).toBe(status === 'pending');
      expect(canRequestChanges(status)).toBe(status === 'pending');
    }
  });
});

describe('canPublishProperty', () => {
  it('desde borrador y estados editoriales heredados', () => {
    for (const status of PUBLICATION_STATUSES) {
      expect(canPublishProperty(status)).toBe(['draft', 'in_review', 'approved'].includes(status));
    }
  });

  it('la revision ya no es requisito para publicar', () => {
    expect(canPublishProperty('draft')).toBe(true);
    expect(canPublishProperty('in_review')).toBe(true);
  });
});

describe('canArchiveProperty', () => {
  it('desde cualquier estado salvo si ya esta archivada', () => {
    for (const status of PUBLICATION_STATUSES) {
      expect(canArchiveProperty(status)).toBe(status !== 'archived');
    }
  });
});

describe('canRestoreToDraft', () => {
  it('solo desde archivada', () => {
    for (const status of PUBLICATION_STATUSES) {
      expect(canRestoreToDraft(status)).toBe(status === 'archived');
    }
  });
});

describe('nextPublicationStatuses', () => {
  it('publica directamente desde borrador y permite retirar', () => {
    expect(nextPublicationStatuses('draft')).toContain('published');
    expect(nextPublicationStatuses('published')).toContain('draft');
    expect(nextPublicationStatuses('approved')).toContain('published');
  });

  it('ofrece publicar desde in_review sin exigir aprobacion', () => {
    expect(nextPublicationStatuses('in_review')).toContain('published');
  });

  it('archivar esta disponible salvo si ya esta archivada', () => {
    expect(nextPublicationStatuses('published')).toContain('archived');
    expect(nextPublicationStatuses('archived')).not.toContain('archived');
  });

  it('desde archivada solo se vuelve a borrador', () => {
    expect(nextPublicationStatuses('archived')).toEqual(['draft']);
  });

  it('nunca propone el estado en el que ya esta', () => {
    for (const status of PUBLICATION_STATUSES) {
      expect(nextPublicationStatuses(status)).not.toContain(status);
    }
  });
});
