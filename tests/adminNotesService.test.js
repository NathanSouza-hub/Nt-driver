import { describe, it, expect, vi, afterEach } from 'vitest';

const adminNotesRepository = require('../repositories/adminNotesRepository');
const adminNotesService = require('../services/adminNotesService');
const { AppError } = require('../errors/AppError');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('adminNotesService.sanitizeHtml', () => {
  it('strips script tags', () => {
    expect(adminNotesService.sanitizeHtml('<p>oi</p><script>alert(1)</script>')).toBe('<p>oi</p>');
  });

  it('strips iframe/object/embed/link/meta/style tags', () => {
    expect(adminNotesService.sanitizeHtml('<iframe src="x"></iframe><p>ok</p>')).toBe('<p>ok</p>');
  });

  it('strips inline event handler attributes', () => {
    expect(adminNotesService.sanitizeHtml('<img src="x" onerror="alert(1)">')).toBe('<img src="x">');
  });

  it('strips javascript: protocol', () => {
    expect(adminNotesService.sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a href="alert(1)">x</a>');
  });
});

describe('adminNotesService.normalizeTitle', () => {
  it('collapses whitespace and truncates to 120 chars', () => {
    expect(adminNotesService.normalizeTitle('  a   b  ')).toBe('a b');
    expect(adminNotesService.normalizeTitle('x'.repeat(200)).length).toBe(120);
  });

  it('falls back to the default title when empty', () => {
    expect(adminNotesService.normalizeTitle('')).toBe('Arquivo sem título');
    expect(adminNotesService.normalizeTitle('', 'Custom Fallback')).toBe('Custom Fallback');
  });
});

describe('adminNotesService.getNotes (always keep at least one document)', () => {
  it('creates a default document when the user has none', async () => {
    vi.spyOn(adminNotesRepository, 'listByUser')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1, title: 'Arquivo 1', created_at: null, updated_at: null }]);
    const insertSpy = vi.spyOn(adminNotesRepository, 'insertDocument').mockResolvedValue({ id: 1, title: 'Arquivo 1' });
    vi.spyOn(adminNotesRepository, 'getById').mockResolvedValue({ id: 1, title: 'Arquivo 1', content_html: '<p></p>' });

    const result = await adminNotesService.getNotes(1, undefined);

    expect(insertSpy).toHaveBeenCalledWith(1, 'Arquivo 1');
    expect(result.activeDocument.id).toBe(1);
  });
});

describe('adminNotesService.updateNote', () => {
  it('rejects an invalid document id', async () => {
    try {
      await adminNotesService.updateNote(1, '0', 'Titulo', '<p>x</p>');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.status).toBe(400);
      expect(error.message).toBe('Arquivo do bloco de notas inválido.');
    }
  });

  it('rejects content over the max size', async () => {
    try {
      await adminNotesService.updateNote(1, '5', 'Titulo', 'x'.repeat(500001));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.status).toBe(400);
      expect(error.message).toBe('Conteúdo muito grande para salvar.');
    }
  });

  it('throws 404 when the document does not belong to the user', async () => {
    vi.spyOn(adminNotesRepository, 'getById').mockResolvedValue(null);
    try {
      await adminNotesService.updateNote(1, '5', 'Titulo', '<p>x</p>');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.status).toBe(404);
      expect(error.message).toBe('Arquivo do bloco de notas não encontrado.');
    }
  });
});

describe('adminNotesService.deleteNote (always keep at least one document)', () => {
  it('recreates a default document when the deleted one was the last', async () => {
    vi.spyOn(adminNotesRepository, 'getById')
      .mockResolvedValueOnce({ id: 5, title: 'Ultimo' })
      .mockResolvedValueOnce({ id: 6, title: 'Arquivo 1', content_html: '<p></p>' });
    const deleteSpy = vi.spyOn(adminNotesRepository, 'deleteDocument').mockResolvedValue();
    vi.spyOn(adminNotesRepository, 'listByUser')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 6, title: 'Arquivo 1' }]);
    const insertSpy = vi.spyOn(adminNotesRepository, 'insertDocument').mockResolvedValue({ id: 6, title: 'Arquivo 1' });

    const result = await adminNotesService.deleteNote(1, '5');

    expect(deleteSpy).toHaveBeenCalledWith(1, 5);
    expect(insertSpy).toHaveBeenCalledWith(1, 'Arquivo 1');
    expect(result.activeDocument.id).toBe(6);
  });
});
