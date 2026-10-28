import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { KnowledgeBaseController } from '../src/modules/workspaces/knowledge-base.controller';
import { AuthSessionGuard } from '../src/modules/auth/auth-session.guard';

describe('Knowledge Base FAQ import routes', () => {
  const controller = new KnowledgeBaseController({} as any, {} as any, {} as any);

  it('registers the authenticated preview and import routes under the selected Knowledge Base', () => {
    expect(Reflect.getMetadata(PATH_METADATA, KnowledgeBaseController)).toBe('workspaces/:slug');
    expect(Reflect.getMetadata(GUARDS_METADATA, KnowledgeBaseController)).toContain(AuthSessionGuard);
    for (const [method, suffix] of [['previewFaqImport', 'knowledge-bases/:baseId/sources/faqs/import/preview'], ['importFaqs', 'knowledge-bases/:baseId/sources/faqs/import']] as const) {
      expect(Reflect.getMetadata(PATH_METADATA, KnowledgeBaseController.prototype[method])).toBe(suffix);
      expect(Reflect.getMetadata(METHOD_METADATA, KnowledgeBaseController.prototype[method])).toBe(RequestMethod.POST);
    }
  });

  it('returns a specific missing-file error when the multipart field is not received', async () => {
    await expect(controller.previewFaqImport({ authSession: { userId: 'user-a' } } as any, 'north', '11111111-1111-4111-8111-111111111111', undefined)).rejects.toMatchObject({
      response: { code: 'FAQ_IMPORT_FILE_REQUIRED', message: 'Choose a CSV or XLSX file.' },
      status: 400,
    });
  });
});
