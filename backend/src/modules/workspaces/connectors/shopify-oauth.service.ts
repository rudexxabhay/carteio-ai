import { BadGatewayException, BadRequestException, HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { WorkspaceService } from '../workspace.service';
import { ConnectorService } from './connector.service';
import { ConnectorCredentialVault } from './connector-credential-vault';
import { SafeOutboundHttpService } from './safe-outbound-http.service';
import { ShopifyGrantedScopeDiscoveryService } from './shopify-granted-scope-discovery.service';
import { getShopifyScopeUpgradeScopes } from '../../../config/shopify-scope-upgrade.config';
import { isShopifyAdminOAuthScope } from '../../../config/shopify-scope-inventory.config';

const shopPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.myshopify\.com$/;
type TokenExchangeFailureCategory = 'DNS' | 'TIMEOUT' | 'TLS' | 'NETWORK' | 'OUTBOUND_POLICY' | 'RESPONSE_LIMIT' | 'DATABASE' | 'RUNTIME' | 'PROVIDER_HTTP_4XX' | 'PROVIDER_HTTP_5XX' | 'PROVIDER_HTTP_OTHER' | 'PROVIDER_RESPONSE' | 'OTHER';
function safeExceptionType(error: Error): string {
  const name = error.constructor?.name ?? 'Error';
  return /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) ? name : 'Error';
}
function exceptionChain(error: unknown): Error[] {
  const result: Error[] = [], seen = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length && result.length < 5) {
    const current = pending.shift();
    if (!(current instanceof Error) || seen.has(current)) continue;
    result.push(current); seen.add(current);
    if ('cause' in current) pending.push(current.cause);
    if (current instanceof AggregateError) pending.push(...current.errors.slice(0, 4));
  }
  return result;
}
function tokenExchangeFailure(error: unknown): { category: TokenExchangeFailureCategory; safeCode: string; exceptionTypes: string[] } {
  const chain = exceptionChain(error);
  const codes = chain.map((item) => typeof (item as Error & { code?: unknown }).code === 'string' ? (item as Error & { code: string }).code : '');
  const messages = chain.map((item) => item.message);
  const base = { exceptionTypes: chain.map(safeExceptionType) };
  if (codes.some((code) => ['CONNECTOR_REQUEST_TIMEOUT','ETIMEDOUT','ESOCKETTIMEDOUT'].includes(code)) || messages.includes('CONNECTOR_REQUEST_TIMEOUT')) return { ...base, category: 'TIMEOUT', safeCode: 'OUTBOUND_TIMEOUT' };
  if (codes.some((code) => /^(?:ENOTFOUND|EAI_AGAIN|EAI_FAIL|EAI_NODATA)$/.test(code))) return { ...base, category: 'DNS', safeCode: 'OUTBOUND_DNS_FAILURE' };
  if (codes.some((code) => /^(?:ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/.test(code))) return { ...base, category: 'TLS', safeCode: 'OUTBOUND_TLS_FAILURE' };
  if (codes.some((code) => /^(?:ECONN|EHOST|ENET|EPIPE|ERR_NETWORK)/.test(code))) return { ...base, category: 'NETWORK', safeCode: 'OUTBOUND_NETWORK_FAILURE' };
  if (messages.includes('CONNECTOR_RESPONSE_TOO_LARGE')) return { ...base, category: 'RESPONSE_LIMIT', safeCode: 'OUTBOUND_RESPONSE_LIMIT' };
  if (messages.some((message) => ['CONNECTOR_REDIRECT_REJECTED','CONNECTOR_REDIRECT_LIMIT'].includes(message))) return { ...base, category: 'OUTBOUND_POLICY', safeCode: 'OUTBOUND_REDIRECT_REJECTED' };
  if (codes.some((code) => /^P\d{4}$/.test(code))) return { ...base, category: 'DATABASE', safeCode: codes.find((code) => /^P\d{4}$/.test(code))! };
  if (chain.some((item) => item instanceof BadRequestException)) return { ...base, category: 'OUTBOUND_POLICY', safeCode: 'OUTBOUND_REQUEST_REJECTED' };
  if (chain.some((item) => item instanceof TypeError || item instanceof RangeError || item instanceof URIError)) return { ...base, category: 'RUNTIME', safeCode: 'TOKEN_EXCHANGE_RUNTIME_ERROR' };
  return { ...base, category: 'OTHER', safeCode: 'UNCLASSIFIED_ERROR' };
}
@Injectable()
export class ShopifyOAuthService {
  private readonly db: any;
  private readonly logger = new Logger(ShopifyOAuthService.name);
  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService, private readonly connectors: ConnectorService, private readonly vault: ConnectorCredentialVault, private readonly http: SafeOutboundHttpService, private readonly scopeDiscovery: ShopifyGrantedScopeDiscoveryService) { this.db = prisma; }
  async begin(userId: string, slug: string, input: { shopDomain: string; displayName?: string }, scopeUpgrade = false) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug, ['OWNER','ADMIN']);
    const shopDomain = input.shopDomain.trim().toLowerCase();
    if (!shopPattern.test(shopDomain)) throw new BadRequestException('Enter the myshopify.com store domain.');
    const clientId = process.env.SHOPIFY_CLIENT_ID ?? '', callback = process.env.SHOPIFY_CALLBACK_URL ?? '';
    if (!clientId || !process.env.SHOPIFY_CLIENT_SECRET || !callback) throw new ServiceUnavailableException({ code:'SHOPIFY_APP_NOT_CONFIGURED', message:'Shopify app authorization is not configured on this server.' });
    const callbackUrl = new URL(callback); if(callbackUrl.protocol!=='https:'&&process.env.NODE_ENV==='production') throw new ServiceUnavailableException('Shopify callback must use HTTPS in production');
    const scopes = this.configuredScopes(process.env.SHOPIFY_SCOPES ?? 'read_products,read_inventory,read_orders', 'SHOPIFY_SCOPES');
    if (!scopes.includes('read_products')) throw new ServiceUnavailableException('SHOPIFY_SCOPES must include read_products');
    const existing = await this.db.connectorInstance.findFirst({where:{organizationId,connectorId:'shopify_v1',configuration:{path:['shopDomain'],equals:shopDomain}},select:{id:true,state:true,displayName:true,integrationConnectionId:true,credential:{select:{id:true,ciphertext:true,nonce:true,authTag:true,keyVersion:true}},commerceConnection:{select:{id:true,state:true,grantedScopes:true,externalAccountId:true}}}});
    let requestedScopes = scopes;
    let scopeUpgradeConfigHash: string | null = null;
    if (scopeUpgrade) {
      if (!existing || existing.state !== 'CONNECTED' || !existing.credential || !existing.commerceConnection || existing.commerceConnection.state !== 'CONNECTED') throw new BadRequestException('Only an existing connected Shopify installation can start a scope upgrade.');
      const upgradeScopes = getShopifyScopeUpgradeScopes();
      if (!upgradeScopes.length) throw new ServiceUnavailableException('No Shopify scope-upgrade scopes are configured. Ask the Carteio administrator to configure and validate the approved upgrade scope list.');
      const existingCredentials = this.vault.decrypt(existing.credential, `carteio:connector:${organizationId}:${existing.id}:shopify_v1`);
      if (typeof existingCredentials.accessToken !== 'string' || existingCredentials.accessToken.length < 16) throw new ServiceUnavailableException('The existing Shopify credential cannot be used to verify current grants.');
      const currentSnapshot = await this.scopeDiscovery.discover({ organizationId, connectorInstanceId: existing.id, shopDomain, accessToken: existingCredentials.accessToken });
      if (existing.commerceConnection.externalAccountId && existing.commerceConnection.externalAccountId !== currentSnapshot.shopId) throw new BadRequestException('The Shopify store identity does not match the connected installation.');
      if (currentSnapshot.scopes.some((scope) => !isShopifyAdminOAuthScope(scope.handle))) throw new ServiceUnavailableException('This connection has non-Admin API scopes. The legacy Admin OAuth upgrade cannot safely re-request them.');
      await this.scopeDiscovery.persist({ organizationId, connectionId: existing.commerceConnection.id, scopes: currentSnapshot.scopes });
      existing.commerceConnection.grantedScopes = currentSnapshot.scopes.map((scope) => scope.handle);
      scopeUpgradeConfigHash = createHash('sha256').update([...upgradeScopes].sort().join(',')).digest('hex');
      requestedScopes = [...new Set([...(existing.commerceConnection.grantedScopes ?? []), ...upgradeScopes])].sort();
    }
    const connector = existing ? existing : await this.connectors.create(userId,slug,{connectorId:'shopify_v1',displayName:input.displayName?.trim()||shopDomain,configuration:{shopDomain}});
    const state = `${scopeUpgrade ? `scope-upgrade.${scopeUpgradeConfigHash}` : 'install'}.${randomBytes(32).toString('base64url')}`, stateHash=createHash('sha256').update(state).digest('hex');
    await this.db.shopifyOAuthState.create({data:{organizationId,userId,connectorInstanceId:connector.id,shopDomain,requestedScopes,stateHash,expiresAt:new Date(Date.now()+10*60_000)}});
    const target=new URL(`https://${shopDomain}/admin/oauth/authorize`); target.searchParams.set('client_id',clientId);target.searchParams.set('scope',requestedScopes.join(','));target.searchParams.set('redirect_uri',callback);target.searchParams.set('state',state);target.searchParams.set('grant_options[]','per-user');
    // Shopify offline tokens are requested by the code exchange using expiring=1; do not request online access.
    target.searchParams.delete('grant_options[]');
    return {authorizationUrl:target.toString(),connectorId:connector.id,requestedScopes};
  }
  private configuredScopes(value: string, name: string): string[] {
    const scopes = value.split(',').map((scope) => scope.trim()).filter(Boolean);
    if (scopes.some((scope) => !/^[a-z][a-z0-9_]{0,127}$/.test(scope) || !isShopifyAdminOAuthScope(scope)) || new Set(scopes).size !== scopes.length) {
      throw new ServiceUnavailableException(`${name} must contain unique Admin API scope handles only.`);
    }
    return scopes;
  }
  async callback(query: Record<string,unknown>, requestId?: string) {
    let stage = 'callback_validation';
    try {
    const scalar:Record<string,string>={}; for(const [key,value] of Object.entries(query)) if(typeof value==='string') scalar[key]=value;
    if(!scalar.shop||!shopPattern.test(scalar.shop)||!scalar.state||!scalar.code||!scalar.hmac||!scalar.timestamp) throw new BadRequestException('Shopify authorization callback is invalid.');
    const secret=process.env.SHOPIFY_CLIENT_SECRET??''; if(!secret)throw new ServiceUnavailableException('Shopify app credentials are not configured.');
    const pairs=Object.entries(scalar).filter(([key])=>key!=='hmac'&&key!=='signature').sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('&');
    const expectedHmac=createHmac('sha256',secret).update(pairs).digest('hex');
    const a=Buffer.from(expectedHmac,'hex'),b=Buffer.from(scalar.hmac,'hex'); if(a.length!==b.length||!timingSafeEqual(a,b))throw new BadRequestException('Shopify authorization signature is invalid.');
    if(Math.abs(Date.now()/1000-Number(scalar.timestamp))>300)throw new BadRequestException('Shopify authorization callback expired.');
    stage = 'state_lookup';
    const stateHash=createHash('sha256').update(scalar.state).digest('hex'), now=new Date();
    const state=await this.db.shopifyOAuthState.findFirst({where:{stateHash,shopDomain:scalar.shop,expiresAt:{gt:now},consumedAt:null},include:{organization:{select:{slug:true}},connector:{select:{id:true,state:true,integrationConnectionId:true,webhookPublicId:true,verifiedCapabilities:true,credential:{select:{id:true,updatedAt:true,ciphertext:true}},commerceConnection:{select:{state:true,grantedScopes:true,externalAccountId:true}}}}}});
    if(!state)throw new BadRequestException('Shopify install state is invalid or expired.');
    stage = 'workspace_authorization';
    const access=await this.workspaces.requireAccess(state.userId,state.organization.slug,['OWNER','ADMIN']); if(access.organizationId!==state.organizationId)throw new BadRequestException('Shopify install workspace authorization is no longer valid.');
    stage = 'state_consumption';
    const used=await this.db.shopifyOAuthState.updateMany({where:{id:state.id,consumedAt:null,expiresAt:{gt:now}},data:{consumedAt:now}}); if(used.count!==1)throw new BadRequestException('Shopify install state was already used.');
    const upgradeStateMatch = /^scope-upgrade\.([a-f0-9]{64})\./.exec(scalar.state);
    const scopeUpgrade = Boolean(upgradeStateMatch);
    if (scopeUpgrade) {
      const configured = getShopifyScopeUpgradeScopes();
      const currentConfigHash = createHash('sha256').update([...configured].sort().join(',')).digest('hex');
      if (!configured.length || currentConfigHash !== upgradeStateMatch?.[1]) throw new BadRequestException('The approved Shopify scope-upgrade configuration changed during authorization. Start a new request; no token was exchanged.');
    }
    const preserveConnectedInstallation = state.connector?.state === 'CONNECTED' && Boolean(state.connector?.credential) && state.connector?.commerceConnection?.state === 'CONNECTED';
    if (scopeUpgrade && !preserveConnectedInstallation) throw new BadRequestException('The Shopify connection changed before this scope upgrade completed. Start again from the connected integration.');
    stage = 'token_exchange';
    let tokenResponse: Awaited<ReturnType<SafeOutboundHttpService['post']>>;
    try {
      tokenResponse=await this.http.post(`https://${scalar.shop}/admin/oauth/access_token`,{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},new URLSearchParams({client_id:process.env.SHOPIFY_CLIENT_ID??'',client_secret:secret,code:scalar.code,expiring:'1'}).toString(),32768);
    } catch (error) {
      const failure = tokenExchangeFailure(error);
      throw new ServiceUnavailableException({code:'SHOPIFY_TOKEN_EXCHANGE_UNAVAILABLE',message:'Shopify authorization is temporarily unavailable. Start authorization again.',failureCategory:failure.category,failureCode:failure.safeCode,exceptionTypes:failure.exceptionTypes,operation:'shopify.oauth.token_exchange'},{cause:error});
    }
    if(tokenResponse.status<200||tokenResponse.status>=300){
      const category:TokenExchangeFailureCategory=tokenResponse.status>=500?'PROVIDER_HTTP_5XX':tokenResponse.status>=400?'PROVIDER_HTTP_4XX':'PROVIDER_HTTP_OTHER';
      const details={code:category==='PROVIDER_HTTP_4XX'?'SHOPIFY_TOKEN_EXCHANGE_REJECTED':'SHOPIFY_TOKEN_EXCHANGE_PROVIDER_ERROR',message:'Shopify rejected or could not complete authorization.',failureCategory:category,failureCode:`HTTP_${tokenResponse.status}`,exceptionTypes:['ShopifyHttpResponse'],operation:'shopify.oauth.token_exchange',upstreamStatus:tokenResponse.status};
      if(category==='PROVIDER_HTTP_4XX')throw new BadRequestException(details);
      throw new ServiceUnavailableException(details);
    }
    stage = 'token_response_parse';
    let token:any;try{token=JSON.parse(tokenResponse.body.toString('utf8'));}catch(error){throw new BadGatewayException({code:'SHOPIFY_TOKEN_RESPONSE_INVALID',message:'Shopify returned an invalid authorization response.',failureCategory:'PROVIDER_RESPONSE',failureCode:'INVALID_JSON',exceptionTypes:tokenExchangeFailure(error).exceptionTypes,operation:'shopify.oauth.token_response_parse'},{cause:error});}
    stage = 'token_validation';
    if(typeof token.access_token!=='string'||token.access_token.length<16)throw new BadRequestException('Shopify returned an invalid access token.');
    stage = 'granted_scope_discovery';
    const scopeSnapshot = await this.scopeDiscovery.discover({ organizationId: state.organizationId, connectorInstanceId: state.connectorInstanceId, shopDomain: scalar.shop, accessToken: token.access_token });
    if (!scopeSnapshot.scopes.some((scope) => scope.handle === 'read_products')) throw new BadRequestException('Shopify did not grant the required product access.');
    const scopes = scopeSnapshot.scopes.map((scope) => scope.handle);
    if (scopeUpgrade || preserveConnectedInstallation) {
      const requiredUpgradeScopes = getShopifyScopeUpgradeScopes();
      const previousGrants: string[] = state.connector?.commerceConnection?.grantedScopes ?? [];
      if ((scopeUpgrade && !requiredUpgradeScopes.length) || !previousGrants.every((scope) => scopes.includes(scope))) throw new BadRequestException('Shopify did not retain the existing grants. The stored connection was left unchanged. Review the merchant decision and retry if appropriate.');
      if (state.connector?.commerceConnection?.externalAccountId && state.connector.commerceConnection.externalAccountId !== scopeSnapshot.shopId) throw new BadRequestException('Shopify returned a different store identity. The stored connection was left unchanged.');
      if (typeof token.refresh_token !== 'string' || !Number.isFinite(token.expires_in) || !Number.isFinite(token.refresh_token_expires_in)) throw new BadRequestException('Shopify did not return the expected expiring offline-token pair. The stored connection was left unchanged.');
    }
    const credentials={accessToken:token.access_token,...(typeof token.refresh_token==='string'?{refreshToken:token.refresh_token}:{}),...(Number.isFinite(token.expires_in)?{accessTokenExpiresAt:new Date(Date.now()+Number(token.expires_in)*1000).toISOString()}:{}),...(Number.isFinite(token.refresh_token_expires_in)?{refreshTokenExpiresAt:new Date(Date.now()+Number(token.refresh_token_expires_in)*1000).toISOString()}:{})};
    stage = 'credential_encryption';
    const encrypted=this.vault.encrypt(credentials,`carteio:connector:${state.organizationId}:${state.connectorInstanceId}:shopify_v1`);
    stage = 'credential_persistence';
    await this.db.$transaction(async(tx:any)=>{
      if (preserveConnectedInstallation) {
        const replaced = await tx.connectorCredential.updateMany({where:{organizationId:state.organizationId,connectorInstanceId:state.connectorInstanceId,ciphertext:state.connector.credential.ciphertext},data:encrypted});
        if (replaced.count !== 1) throw new BadRequestException('The Shopify credential changed during this authorization. No credential was replaced; start the scope upgrade again.');
        const connectorUpdated = await tx.connectorInstance.updateMany({where:{id:state.connectorInstanceId,organizationId:state.organizationId,state:'CONNECTED'},data:{lastErrorCode:null}});
        if (connectorUpdated.count !== 1) throw new BadRequestException('The Shopify connection changed during authorization. No connection data was replaced.');
        const connectionUpdated = await tx.integrationConnection.updateMany({where:{id:state.connector.integrationConnectionId,organizationId:state.organizationId,platform:'SHOPIFY',state:'CONNECTED',externalAccountId:state.connector.commerceConnection.externalAccountId},data:{grantedScopes:scopes,grantedScopeMetadata:scopeSnapshot.scopes,grantedScopesVerifiedAt:new Date(),lastErrorCode:null}});
        if (connectionUpdated.count !== 1) throw new BadRequestException('The Shopify connection changed during authorization. No connection data was replaced.');
      } else {
        await tx.connectorSyncJob.updateMany({where:{organizationId:state.organizationId,connectorInstanceId:state.connectorInstanceId,state:{in:['PENDING','RETRY_WAIT','RUNNING']}},data:{state:'CANCELLED',finishedAt:new Date(),leaseToken:null,leaseUntil:null}});
        await tx.connectorCredential.upsert({where:{connectorInstanceId:state.connectorInstanceId},create:{organizationId:state.organizationId,connectorInstanceId:state.connectorInstanceId,...encrypted},update:encrypted});
        await tx.connectorInstance.updateMany({where:{id:state.connectorInstanceId,organizationId:state.organizationId},data:{state:'DRAFT',verifiedCapabilities:[],webhookPublicId:state.connector?.webhookPublicId??randomBytes(24).toString('base64url'),lastErrorCode:null}});
        if(state.connector?.integrationConnectionId)await tx.integrationConnection.updateMany({where:{id:state.connector.integrationConnectionId,organizationId:state.organizationId,platform:'SHOPIFY'},data:{state:'DRAFT',externalAccountId:scopeSnapshot.shopId,siteUrl:`https://${scalar.shop}`,grantedScopes:scopes,grantedScopeMetadata:scopeSnapshot.scopes,grantedScopesVerifiedAt:new Date(),lastErrorCode:null}});
      }
      await tx.auditEvent.create({data:{organizationId:state.organizationId,actorUserId:state.userId,action:scopeUpgrade?'connector.shopify_scopes_upgraded':'connector.shopify_authorized',entityType:'connector_instance',entityId:state.connectorInstanceId,metadata:{shopDomain:scalar.shop,grantedScopeCount:scopes.length}}});
    });
    stage = 'frontend_redirect';
    const appUrl=process.env.PUBLIC_APP_URL??'';const redirect=new URL(`/workspace/${state.organization.slug}/integrations`,appUrl);redirect.searchParams.set('shopify','authorized');return redirect.toString();
    } catch (error) {
      this.logCallbackFailure(requestId, stage, error);
      throw error;
    }
  }

  private logCallbackFailure(requestId: string | undefined, stage: string, error: unknown) {
    const response = error instanceof HttpException ? error.getResponse() : null;
    const details = typeof response === 'object' && response !== null ? response as Record<string, unknown> : {};
    const classified = tokenExchangeFailure(error);
    const failureCategory = typeof details.failureCategory === 'string' && /^[A-Z0-9_]{1,40}$/.test(details.failureCategory) ? details.failureCategory : classified.category;
    const failureCode = typeof details.failureCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(details.failureCode)
      ? details.failureCode
      : typeof details.code === 'string' && /^SHOPIFY_[A-Z0-9_]{1,70}$/.test(details.code) ? details.code : classified.safeCode;
    const upstreamStatus = Number.isInteger(details.upstreamStatus) && Number(details.upstreamStatus) >= 100 && Number(details.upstreamStatus) <= 599 ? Number(details.upstreamStatus) : undefined;
    const causeTypes = Array.isArray(details.exceptionTypes) ? details.exceptionTypes.filter((name): name is string => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name)).slice(0, 5) : classified.exceptionTypes.slice(1);
    const exceptionType = error instanceof Error ? safeExceptionType(error) : 'UnknownError';
    const operation = typeof details.operation === 'string' && /^shopify\.oauth\.[a-z_]{3,40}$/.test(details.operation) ? details.operation : `shopify.oauth.${stage}`;
    this.logger.error(JSON.stringify({event:'shopify_oauth_callback_failure',requestId:requestId??'unknown',stage,operation,exceptionType,causeTypes,failureCategory,failureCode,...(upstreamStatus?{upstreamStatus}:{})}));
  }
}
