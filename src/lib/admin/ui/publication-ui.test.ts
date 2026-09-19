import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicationErrorMessages, renderPublicationPanel } from './publication-panel';

describe('publicacion inmediata en el editor', () => {
  it('ofrece publicar desde borrador y estados editoriales antiguos', () => {
    for (const publicationStatus of ['draft', 'in_review', 'approved'] as const) {
      const html = renderPublicationPanel({ publicationStatus, href: null });
      expect(html).toContain('Publicar propiedad');
      expect(html).not.toMatch(
        /pending|building|reconcile|abandon|historial|release|manifest|job/i,
      );
    }
  });
  it('una publicada permite ver la ficha y retirarla; bloquea doble clic', () => {
    const html = renderPublicationPanel(
      { publicationStatus: 'published', href: '/es/propiedades/lote' },
      true,
    );
    expect(html).toContain('Publicada');
    expect(html).toContain('href="/es/propiedades/lote"');
    expect(html).toContain('data-action="unpublish" disabled');
    expect(html).not.toContain('Publicar propiedad');
  });
  it('muestra los problemas del validador sin perder ninguno', () => {
    expect(
      publicationErrorMessages({
        error: {
          details: { issues: [{ message: 'Falta el título.' }, { message: 'Falta una imagen.' }] },
        },
      }),
    ).toEqual(['Falta el título.', 'Falta una imagen.']);
  });
  it('escapa el enlace antes de insertarlo en HTML', () => {
    expect(
      renderPublicationPanel({ publicationStatus: 'published', href: '/x" onclick="alert(1)' }),
    ).not.toContain(' onclick="');
  });
  it('usa el coordinador existente y no monta revision ni el panel historico', () => {
    const editor = readFileSync('src/lib/admin/ui/editor-page.ts', 'utf8');
    const page = readFileSync('src/pages/admin/propiedades/[id].astro', 'utf8');
    const panel = readFileSync('src/lib/admin/ui/publication-panel.ts', 'utf8');
    expect(editor).toContain('initPublicationPanel(propertyId,');
    expect(editor).toContain('await coordinator?.saveNow()');
    expect(page).not.toContain('initReviewPanel');
    expect(page).not.toContain('id="editor-review"');
    expect(panel).toContain('await editor.save()');
    expect(panel).not.toMatch(/publication_request|github|callbackToken|reconcile/i);
  });
});
