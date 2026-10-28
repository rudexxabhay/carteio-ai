import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthSessionGuard } from '../auth/auth-session.guard';
import { BulkKnowledgeBaseSourcesDto, CreateKnowledgeBaseDto, KnowledgeBaseListQueryDto, KnowledgeBaseSourceQueryDto, ReplaceAssistantKnowledgeBasesDto, UpdateKnowledgeBaseDto } from './knowledge-base.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeProcessingService } from './knowledge-processing.service';
import { CreateFaqBatchDto, CreateFaqSourceDto, CreateTextSourceDto, CreateWebsiteSourceDto, FaqImportCommitDto } from './knowledge.dto';
import { FAQ_IMPORT_MAX_BYTES, FAQ_IMPORT_MAX_ROWS, faqImportTemplateCsv, parseFaqImport } from './faq-import';

type AuthenticatedRequest = Request & { authSession?: { userId: string } };

@Controller('workspaces/:slug')
@UseGuards(AuthSessionGuard)
export class KnowledgeBaseController {
  constructor(private readonly bases: KnowledgeBaseService, private readonly knowledge: KnowledgeService, private readonly processing: KnowledgeProcessingService) {}

  @Get('knowledge-bases')
  list(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Query() query: KnowledgeBaseListQueryDto) { return this.bases.list(req.authSession!.userId, slug, query); }

  @Get('knowledge-bases/unassigned-sources')
  unassignedSources(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Query() query: KnowledgeBaseSourceQueryDto) { return this.bases.unassignedSources(req.authSession!.userId, slug, query); }

  @Post('knowledge-bases')
  create(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: CreateKnowledgeBaseDto) { return this.bases.create(req.authSession!.userId, slug, body); }

  @Get('knowledge-bases/:baseId')
  get(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string) { return this.bases.get(req.authSession!.userId, slug, baseId); }

  @Patch('knowledge-bases/:baseId')
  update(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Body() body: UpdateKnowledgeBaseDto) { return this.bases.update(req.authSession!.userId, slug, baseId, body); }

  @Delete('knowledge-bases/:baseId')
  archive(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string) { return this.bases.archive(req.authSession!.userId, slug, baseId); }

  @Get('knowledge-bases/:baseId/sources')
  sources(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Query() query: KnowledgeBaseSourceQueryDto) { return this.bases.sources(req.authSession!.userId, slug, baseId, query); }

  @Get('knowledge-bases/:baseId/available-sources')
  availableSources(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Query() query: KnowledgeBaseSourceQueryDto) { return this.bases.availableSources(req.authSession!.userId, slug, baseId, query); }

  @Post('knowledge-bases/:baseId/sources/website')
  createWebsite(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Body() body: CreateWebsiteSourceDto) { return this.knowledge.createWebsiteInBase(req.authSession!.userId, slug, baseId, body); }

  @Post('knowledge-bases/:baseId/sources/faq')
  createFaq(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Body() body: CreateFaqSourceDto) { return this.knowledge.createFaqInBase(req.authSession!.userId, slug, baseId, body); }

  @Post('knowledge-bases/:baseId/sources/faqs/batch')
  createFaqBatch(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Body() body: CreateFaqBatchDto) { return this.knowledge.createFaqBatchInBase(req.authSession!.userId, slug, baseId, body); }

  @Get('knowledge-bases/:baseId/sources/faqs/template.csv')
  async faqTemplate(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Res() response: Response) { await this.bases.get(req.authSession!.userId, slug, baseId); response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Content-Disposition', 'attachment; filename="carteio-faq-template.csv"'); response.send(faqImportTemplateCsv()); }

  @Post('knowledge-bases/:baseId/sources/faqs/import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FAQ_IMPORT_MAX_BYTES, files: 1 } }))
  async previewFaqImport(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @UploadedFile() file?: { originalname: string; buffer: Buffer }) {
    if (!file) throw new BadRequestException({ code: 'FAQ_IMPORT_FILE_REQUIRED', message: 'Choose a CSV or XLSX file.' });
    let rows;
    try { rows = parseFaqImport(file.originalname, file.buffer); } catch (error) { throw new BadRequestException({ code: 'FAQ_IMPORT_INVALID_FILE', message: error instanceof Error ? error.message : 'The import file could not be read.' }); }
    if (rows.length > FAQ_IMPORT_MAX_ROWS) throw new BadRequestException({ code: 'FAQ_IMPORT_TOO_LARGE', message: `Import at most ${FAQ_IMPORT_MAX_ROWS} FAQ rows at a time.` });
    const reviewed = await this.knowledge.inspectFaqImport(req.authSession!.userId, slug, baseId, rows);
    return { rows: reviewed, total: reviewed.length, valid: reviewed.filter((row) => !row.errors.length && !row.duplicateInFile).length, invalid: reviewed.filter((row) => row.errors.length || row.duplicateInFile).length, duplicates: reviewed.filter((row) => row.duplicateInFile || row.duplicateExisting).length };
  }

  @Post('knowledge-bases/:baseId/sources/faqs/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FAQ_IMPORT_MAX_BYTES, files: 1 } }))
  async importFaqs(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined, @Body() body: FaqImportCommitDto) {
    if (!file) throw new BadRequestException({ code: 'FAQ_IMPORT_FILE_REQUIRED', message: 'Choose a CSV or XLSX file.' });
    let rows;
    try { rows = parseFaqImport(file.originalname, file.buffer); } catch (error) { throw new BadRequestException({ code: 'FAQ_IMPORT_INVALID_FILE', message: error instanceof Error ? error.message : 'The import file could not be read.' }); }
    if (rows.length > FAQ_IMPORT_MAX_ROWS) throw new BadRequestException({ code: 'FAQ_IMPORT_TOO_LARGE', message: `Import at most ${FAQ_IMPORT_MAX_ROWS} FAQ rows at a time.` });
    const reviewed = await this.knowledge.inspectFaqImport(req.authSession!.userId, slug, baseId, rows);
    const rowsWithVisibility = reviewed.map((row) => ({ ...row, knowledgeSection: body.knowledgeSection, visibility: row.visibility ?? body.defaultVisibility }));
    return this.knowledge.importFaqRows(req.authSession!.userId, slug, baseId, rowsWithVisibility, body.duplicatePolicy);
  }

  @Post('knowledge-bases/:baseId/sources/text')
  createText(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Body() body: CreateTextSourceDto) { return this.knowledge.createTextInBase(req.authSession!.userId, slug, baseId, body); }

  @Post('knowledge-bases/:baseId/sources/bulk')
  addSources(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Body() body: BulkKnowledgeBaseSourcesDto) { return this.bases.addSources(req.authSession!.userId, slug, baseId, body); }

  @Delete('knowledge-bases/:baseId/sources/bulk')
  removeSources(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Body() body: BulkKnowledgeBaseSourcesDto) { return this.bases.removeSources(req.authSession!.userId, slug, baseId, body); }

  @Get('assistants/:assistantId/knowledge-bases')
  assistantBases(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Query() query: KnowledgeBaseListQueryDto) { return this.bases.assistantBases(req.authSession!.userId, slug, assistantId, query); }

  @Get('knowledge-bases/:baseId/assistants')
  baseAssistants(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string) { return this.bases.baseAssistants(req.authSession!.userId, slug, baseId); }

  @Post('knowledge-bases/:baseId/assistants/:assistantId')
  addBaseAssistant(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) { return this.bases.addBaseAssistant(req.authSession!.userId, slug, baseId, assistantId); }

  @Delete('knowledge-bases/:baseId/assistants/:assistantId')
  removeBaseAssistant(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) { return this.bases.removeBaseAssistant(req.authSession!.userId, slug, baseId, assistantId); }

  @Put('assistants/:assistantId/knowledge-bases')
  replaceAssistantBases(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Body() body: ReplaceAssistantKnowledgeBasesDto) { return this.bases.replaceAssistantBases(req.authSession!.userId, slug, assistantId, body); }

  @Get('assistants/:assistantId/effective-knowledge')
  effective(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.processing.effectivePublicKnowledge(req.authSession!.userId, slug, assistantId);
  }
}
