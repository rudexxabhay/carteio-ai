import { Controller, Get, Query, Req, Res } from '@nestjs/common';

import type { Request, Response } from 'express';
import { ShopifyOAuthService } from './shopify-oauth.service';

type RequestWithId = Request & { requestId?: string };

@Controller('connectors/shopify')
export class ShopifyOAuthController {
  constructor(private readonly shopify: ShopifyOAuthService) {}
  @Get('callback')
  async callback(@Query() query: Record<string, unknown>, @Req() request: RequestWithId, @Res() response: Response) {
    const url = await this.shopify.callback(query, request.requestId);
    return response.redirect(303, url);
  }
}
