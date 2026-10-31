import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KnowledgeDocumentProcessingDto } from './knowledge.dto';

describe('KnowledgeDocumentProcessingDto', () => {
  const valid = {
    processingId: '8b63d73d-8b44-4a01-8f1c-98d514ac3b51',
    stage: 'EXTRACTING',
    totalPages: 12,
    pagesExtracted: 7,
    pagesPersisted: 5,
    chunksIndexed: 0,
    lastUpdatedAt: '2026-10-29T10:00:00.000Z',
  };

  it('accepts a valid typed processing snapshot', async () => {
    const dto = plainToInstance(KnowledgeDocumentProcessingDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects unknown stages, negative progress and malformed timestamps', async () => {
    const dto = plainToInstance(KnowledgeDocumentProcessingDto, {
      ...valid, stage: 'SIMULATED', pagesExtracted: -1, lastUpdatedAt: 'not-a-date',
    });
    const errors = await validate(dto);
    expect(errors.map(error => error.property)).toEqual(expect.arrayContaining(['stage', 'pagesExtracted', 'lastUpdatedAt']));
  });
});
