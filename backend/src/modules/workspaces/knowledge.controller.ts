import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PDF_MAX_BYTES } from './local-knowledge-storage';
import { KnowledgeEvidenceMetadataDto, UploadKnowledgePdfDto, BulkArchiveSourcesDto, KnowledgeChunksQueryDto, KnowledgeListQueryDto, KnowledgeSearchPreviewDto, UpdateKnowledgeSourceDto } from './knowledge.dto';
import type { Request } from 'express';
import { AuthSessionGuard } from '../auth/auth-session.guard';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeProcessingService } from './knowledge-processing.service';
import { ShopifyWebsiteDiscoveryService } from './shopify-website-discovery.service';

type AuthenticatedRequest = Request & { authSession?: { userId: string } };

@Controller('workspaces/:slug/knowledge')
@UseGuards(AuthSessionGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService, private readonly processing: KnowledgeProcessingService, private readonly shopifyWebsiteDiscovery: ShopifyWebsiteDiscoveryService) {}

  @Post('shopify/:connectorInstanceId/discovery')
  discoverShopifyWebsite(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) connectorInstanceId: string) {
    return this.shopifyWebsiteDiscovery.discover(request.authSession!.userId, slug, connectorInstanceId);
  }

  @Get('shopify/:connectorInstanceId/discovery')
  shopifyWebsiteDiscoveryStatus(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) connectorInstanceId: string) {
    return this.shopifyWebsiteDiscovery.status(request.authSession!.userId, slug, connectorInstanceId);
  }

  @Post('shopify/:connectorInstanceId/discovery/verification-challenge')
  shopifyWebsiteChallenge(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) connectorInstanceId: string) {
    return this.shopifyWebsiteDiscovery.challenge(request.authSession!.userId, slug, connectorInstanceId);
  }

  @Post('shopify/:connectorInstanceId/discovery/verify')
  verifyShopifyWebsite(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) connectorInstanceId: string) {
    return this.shopifyWebsiteDiscovery.verify(request.authSession!.userId, slug, connectorInstanceId);
  }

  @Post('shopify/:connectorInstanceId/discovery/refresh')
  refreshShopifyWebsite(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) connectorInstanceId: string) {
    return this.shopifyWebsiteDiscovery.refresh(request.authSession!.userId, slug, connectorInstanceId);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Query() query: KnowledgeListQueryDto) {
    return this.knowledge.list(request.authSession!.userId, slug, query.type, query);
  }

  @Get('document-capabilities')
  documentCapabilities(@Req() request: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.knowledge.documentCapabilities(request.authSession!.userId, slug);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PDF_MAX_BYTES, files: 1, fields: 4 } }))
  uploadPdf(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: UploadKnowledgePdfDto, @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    return this.knowledge.uploadPdf(request.authSession!.userId, slug, body, file);
  }

  @Post(':sourceId/document')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PDF_MAX_BYTES, files: 1, fields: 4 } }))
  replacePdf(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string, @Body() body: UploadKnowledgePdfDto, @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    return this.knowledge.uploadPdf(request.authSession!.userId, slug, body, file, sourceId);
  }

  @Get(':sourceId')
  get(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.knowledge.get(request.authSession!.userId, slug, sourceId);
  }

  @Patch(':sourceId')
  update(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string, @Body() body: UpdateKnowledgeSourceDto) {
    return this.knowledge.update(request.authSession!.userId, slug, sourceId, body);
  }

  @Delete(':sourceId')
  archive(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.knowledge.archive(request.authSession!.userId, slug, sourceId);
  }

  @Post('archive/bulk')
  archiveMany(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: BulkArchiveSourcesDto) {
    return this.knowledge.archiveMany(request.authSession!.userId, slug, body.sourceIds);
  }

  @Post(':sourceId/restore')
  restore(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.knowledge.restore(request.authSession!.userId, slug, sourceId);
  }

  @Get(':sourceId/delete-impact')
  permanentDeleteImpact(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.knowledge.permanentDeleteImpact(request.authSession!.userId, slug, sourceId);
  }

  @Delete(':sourceId/permanent')
  permanentlyDelete(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.knowledge.permanentlyDelete(request.authSession!.userId, slug, sourceId);
  }

  @Get(':sourceId/processing')
  processingStatus(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.processing.status(request.authSession!.userId, slug, sourceId);
  }

  @Get(':sourceId/chunks')
  sourceChunks(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string, @Query() query: KnowledgeChunksQueryDto) {
    return this.processing.listSourceChunks(request.authSession!.userId, slug, sourceId, query);
  }

  @Post(':sourceId/reindex')
  reindex(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.processing.retry(request.authSession!.userId, slug, sourceId);
  }

  @Post('search-preview')
  searchPreview(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: KnowledgeSearchPreviewDto) {
    // This preview is intended to show what an actual public visitor can retrieve.
    return this.processing.searchPreview(request.authSession!.userId, slug, body.assistantId, body.query, body.limit, 'PUBLIC_VISITOR');
  }

  @Post('evidence-metadata')
  evidenceMetadata(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: KnowledgeEvidenceMetadataDto) {
    return this.processing.resolveEvidenceMetadata(request.authSession!.userId, slug, body.assistantId, body.items);
  }
}
