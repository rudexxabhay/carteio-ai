import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { KnowledgeController } from '../src/modules/workspaces/knowledge.controller';

describe('KnowledgeController website sync route contract', () => {
  it('registers the secured POST route used by the dashboard under the global API prefix', () => {
    const controllerPath = Reflect.getMetadata(PATH_METADATA, KnowledgeController) as string;
    const methodPath = Reflect.getMetadata(PATH_METADATA, KnowledgeController.prototype.syncWebsite) as string;
    const method = Reflect.getMetadata(METHOD_METADATA, KnowledgeController.prototype.syncWebsite) as RequestMethod;

    expect(method).toBe(RequestMethod.POST);
    expect(`api/v1/${controllerPath}/${methodPath}`).toBe(
      'api/v1/workspaces/:slug/knowledge/:sourceId/website/sync',
    );
  });

  it('keeps training status on the existing GET website details route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, KnowledgeController.prototype.websiteDetails)).toBe(':sourceId/website');
    expect(Reflect.getMetadata(METHOD_METADATA, KnowledgeController.prototype.websiteDetails)).toBe(RequestMethod.GET);
  });
});

describe('KnowledgeController knowledge inspection routes', () => {
  it('exposes workspace-scoped chunk inspection and runs preview as a public customer retrieval', async () => {
    const processing = { listSourceChunks: jest.fn().mockResolvedValue({ chunks: [] }), searchPreview: jest.fn().mockResolvedValue({ results: [] }) };
    const controller = new KnowledgeController({} as any, processing as any, {} as any, {} as any);
    const request = { authSession: { userId: 'user-a' } } as any;
    await controller.sourceChunks(request, 'north', '00000000-0000-4000-8000-000000000001', {} as any);
    expect(processing.listSourceChunks).toHaveBeenCalledWith('user-a', 'north', '00000000-0000-4000-8000-000000000001', {});
    await controller.searchPreview(request, 'north', { assistantId: '00000000-0000-4000-8000-000000000002', query: 'shipping?', limit: 5 } as any);
    expect(processing.searchPreview).toHaveBeenCalledWith('user-a', 'north', '00000000-0000-4000-8000-000000000002', 'shipping?', 5, 'PUBLIC_VISITOR');
  });
});
