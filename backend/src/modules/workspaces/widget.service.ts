import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, UnauthorizedException, GoneException, InternalServerErrorException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkspaceService } from './workspace.service';
import { TicketingService } from './ticketing.service';
import { SupportDeliveryService } from './support-delivery.service';
import { SaasService } from './saas.service';
import { invalidateWidgetOriginPolicyCache, normalizeWidgetOrigin, widgetOriginMatchesDomains, widgetSigningSecret } from './widget-origin';
import { widgetSourceIndicator } from './widget-source-indicator';

const defaultAppearance = { name: 'Assistant', welcomeMessage: 'Hi! How can I help?', color: '#3157d5', userBubbleColor: '#3157d5', position: 'right', fontFamily: 'system', desktopSize: 'medium', width: 380, height: 590, mobileWidth: 420, mobileHeight: 720, cornerRadius: 20, launcherSize: 58, avatarUrl: null, suggestions: [] };
type WidgetSize = 'small' | 'medium' | 'large' | 'custom';
type WidgetPresetSize = Exclude<WidgetSize, 'custom'>;
const isWidgetSize = (value: unknown): value is WidgetSize => value === 'small' || value === 'medium' || value === 'large' || value === 'custom';

@Injectable()
export class WidgetService {
  private readonly logger = new Logger(WidgetService.name);
  private db: any;
  constructor(db: PrismaService, private workspaces: WorkspaceService, private saas: SaasService, private tickets: TicketingService, delivery: SupportDeliveryService) { this.db = db; delivery.register('WEB_WIDGET',{deliver:async()=>({state:'SENT',transportEventId:`widget:${randomUUID()}`})}); }
  private credential() { return randomBytes(32).toString('base64url'); }
  private credentialHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private debugStage(req: any, stage: string, operation: string, startedAt: number, error?: unknown) {
    if (process.env.WIDGET_DEBUG_ENABLED !== 'true' || (process.env.NODE_ENV ?? 'development') === 'production') return;
    const failed = error !== undefined;
    const status = error instanceof HttpException ? error.getStatus() : failed ? 500 : 200;
    this.logger.log(JSON.stringify({event:'widget_debug',stage,operation,requestId:typeof req?.requestId==='string'?req.requestId:'unknown',durationMs:Date.now()-startedAt,status:failed?'failure':'success',httpStatus:status,exceptionType:failed?(error instanceof Error?error.name:typeof error):undefined,failureCategory:failed?(status>=500?'runtime':status===403?'authorization':status===401?'session_authorization':status===429?'rate_limit':'client_http'):undefined}));
  }
  private async traced<T>(req: any, stage: string, operation: string, run: () => Promise<T>): Promise<T> {
    const startedAt=Date.now();
    try { const result=await run(); this.debugStage(req,stage,operation,startedAt); return result; }
    catch(error) { this.debugStage(req,stage,operation,startedAt,error); throw error; }
  }
  private origin(req: any) { return normalizeWidgetOrigin(req.headers.origin); }
  private appearance(raw: unknown, assistantName = defaultAppearance.name, assistantWelcome = defaultAppearance.welcomeMessage) {
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : {};
    const integer = (candidate: unknown, fallback: number, min: number, max: number) => Number.isInteger(candidate) && Number(candidate) >= min && Number(candidate) <= max ? Number(candidate) : fallback;
    const persistedSize: unknown = value.desktopSize;
    const size: WidgetSize = isWidgetSize(persistedSize) ? persistedSize : 'medium';
    const sizes: Record<WidgetPresetSize, { width: number; height: number }> = { small: { width: 340, height: 480 }, medium: { width: 380, height: 590 }, large: { width: 440, height: 720 } };
    const preset = size === 'custom' ? null : sizes[size];
    const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 80) : (typeof assistantName === 'string' && assistantName.trim() ? assistantName.trim().slice(0, 80) : defaultAppearance.name);
    const welcomeFallback = typeof assistantWelcome === 'string' && assistantWelcome.trim() ? assistantWelcome.trim().slice(0, 500) : defaultAppearance.welcomeMessage;
    const color = typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : defaultAppearance.color;
    const bubble = typeof value.userBubbleColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.userBubbleColor) ? value.userBubbleColor : color;
    const suggestions = Array.isArray(value.suggestions) ? value.suggestions.filter((item: unknown): item is string => typeof item === 'string').map((item: string) => item.trim().slice(0, 120)).filter(Boolean).slice(0, 5) : [];
    let avatarUrl: string | null = null;
    if (typeof value.avatarUrl === 'string') { try { const url = new URL(value.avatarUrl); if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.href.length <= 2048) avatarUrl = url.href; } catch { /* Invalid legacy avatar URLs use the built-in chat icon. */ } }
    const fontFamily = ['system','inter','arial','georgia','verdana'].includes(value.fontFamily) ? value.fontFamily : defaultAppearance.fontFamily;
    return { name, welcomeMessage: typeof value.welcomeMessage === 'string' && value.welcomeMessage.trim() ? value.welcomeMessage.trim().slice(0, 500) : welcomeFallback, color, userBubbleColor: bubble, position: value.position === 'left' ? 'left' : 'right', fontFamily, desktopSize: size, width: preset?.width ?? integer(value.width, defaultAppearance.width, 320, 560), height: preset?.height ?? integer(value.height, defaultAppearance.height, 420, 900), mobileWidth: integer(value.mobileWidth, defaultAppearance.mobileWidth, 280, 600), mobileHeight: integer(value.mobileHeight, defaultAppearance.mobileHeight, 360, 900), cornerRadius: integer(value.cornerRadius, defaultAppearance.cornerRadius, 12, 32), launcherSize: integer(value.launcherSize, defaultAppearance.launcherSize, 48, 80), avatarUrl, suggestions };
  }
  private async widget(publicId: string, origin: string, req?: any) {
    const config=await this.traced(req,'W05_widget_configuration_loaded','widget.configuration.lookup',async()=>{
      const row=await this.db.widgetConfiguration.findFirst({where:{publicId,enabled:true},select:{id:true,organizationId:true,assistantId:true,allowedDomains:true,appearance:true,publicId:true,assistant:{select:{id:true,name:true,greetingMessage:true,status:true,archivedAt:true}}}});
      if(!row)throw new NotFoundException('Widget unavailable');
      return row;
    });
    await this.traced(req,'W04_origin_domain_authorization','widget.origin.authorize',async()=>{if(!widgetOriginMatchesDomains(origin,config.allowedDomains))throw new ForbiddenException('Website origin is not approved');return true;});
    await this.traced(req,'W06_assistant_validated','widget.assistant.validate',async()=>{if(config.assistant.status!=='ACTIVE'||config.assistant.archivedAt)throw new NotFoundException('Widget unavailable');return true;});
    return config;
  }
  async publicConfiguration(publicId: string, req: any) {
    const origin=this.origin(req),address=String(req.ip??'').slice(0,80);
    await this.rate(`widget:${createHash('sha256').update(`${publicId}:${address}`).digest('hex')}`);
    const config=await this.widget(publicId,origin,req);
    return {assistant:this.appearance(config.appearance,config.assistant.name,config.assistant.greetingMessage)};
  }
  private async rate(key: string, maximum=60) { const now = new Date(), minute = new Date(Math.floor(now.getTime()/60000)*60000); const rows = await this.db.$queryRaw<Array<{requestCount:number}>>`INSERT INTO "PlaygroundRateLimit" ("scopeKey","windowStartedAt","requestCount","updatedAt") VALUES (${key.slice(0,160)},${minute},1,${now}) ON CONFLICT ("scopeKey") DO UPDATE SET "windowStartedAt"=CASE WHEN "PlaygroundRateLimit"."windowStartedAt"<${minute} THEN ${minute} ELSE "PlaygroundRateLimit"."windowStartedAt" END,"requestCount"=CASE WHEN "PlaygroundRateLimit"."windowStartedAt"<${minute} THEN 1 ELSE LEAST("PlaygroundRateLimit"."requestCount"+1,${maximum+1}) END,"updatedAt"=${now} RETURNING "requestCount"`; if ((rows[0]?.requestCount ?? 0)>maximum) throw new HttpException({code:'WIDGET_RATE_LIMITED',message:'Too many widget requests. Please retry shortly.',retryAfterSeconds:60},HttpStatus.TOO_MANY_REQUESTS); }
  async configuration(userId:string, slug:string, assistantId?:string) { const access = await this.workspaces.requireAccess(userId,slug,['OWNER','ADMIN']); const row = assistantId ? await this.db.widgetConfiguration.findFirst({where:{organizationId:access.organizationId,assistantId}}) : await this.db.widgetConfiguration.findFirst({where:{organizationId:access.organizationId},orderBy:{updatedAt:'desc'}}); if(row){const assistant=await this.db.chatbot.findFirst({where:{id:row.assistantId,organizationId:access.organizationId,archivedAt:null},select:{name:true,greetingMessage:true}}); return {...row,appearance:this.appearance(row.appearance,assistant?.name,assistant?.greetingMessage)};} const assistant=assistantId?await this.db.chatbot.findFirst({where:{id:assistantId,organizationId:access.organizationId,archivedAt:null},select:{name:true,greetingMessage:true}}):null; return { assistantId: assistantId ?? '', publicId:'', enabled:false, allowedDomains:[], appearance:this.appearance({},assistant?.name,assistant?.greetingMessage) }; }
  async updateConfiguration(userId:string,slug:string,input:any) { const access = await this.workspaces.requireAccess(userId,slug,['OWNER','ADMIN']); const assistant = await this.db.chatbot.findFirst({where:{id:input.assistantId,organizationId:access.organizationId,archivedAt:null},select:{id:true,name:true,greetingMessage:true,status:true}}); if (!assistant) throw new NotFoundException('Assistant not found'); if(input.enabled&&assistant.status!=='ACTIVE') throw new ConflictException('Activate this assistant before enabling its website widget'); if (!Array.isArray(input.allowedDomains)||input.allowedDomains.length>1) throw new BadRequestException('Provide one website hostname for this widget'); const domains = [...new Set(input.allowedDomains.map((d:string)=>{ const v=d.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,''); if(v.length>253||! /^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/.test(v)||v.includes('..')) throw new BadRequestException('Website domains must be hostnames without paths or wildcards'); return v; }))]; if(input.enabled&&!domains.length) throw new BadRequestException('Add one approved website hostname before enabling the widget'); const a=input.appearance ?? {}; let avatarUrl:string|null=null; if(a.avatarUrl){try{const avatar=new URL(a.avatarUrl); if(avatar.protocol!=='https:'||avatar.username||avatar.password||avatar.port||avatar.href.length>2048)throw new Error(); avatarUrl=avatar.href;}catch{throw new BadRequestException('Avatar URL must be HTTPS without credentials or a custom port');}} const prior=await this.db.widgetConfiguration.findFirst({where:{organizationId:access.organizationId,assistantId:input.assistantId},select:{appearance:true}}); const appearance=this.appearance({...((prior?.appearance&&typeof prior.appearance==='object'&&!Array.isArray(prior.appearance))?prior.appearance:{}),...a,avatarUrl},assistant.name,assistant.greetingMessage); const row=await this.db.widgetConfiguration.upsert({where:{assistantId:input.assistantId},create:{organizationId:access.organizationId,assistantId:input.assistantId,enabled:input.enabled,allowedDomains:domains,appearance},update:{enabled:input.enabled,allowedDomains:domains,appearance}}); invalidateWidgetOriginPolicyCache(); const persistedDomains=Array.isArray(row.allowedDomains)?row.allowedDomains:null; const domainsPersisted=persistedDomains!==null&&persistedDomains.length===domains.length&&domains.every((domain,index)=>persistedDomains[index]===domain); if(row.organizationId!==access.organizationId||row.assistantId!==assistant.id||row.enabled!==input.enabled||!domainsPersisted) throw new InternalServerErrorException('Widget settings could not be verified after saving'); return row; }
  private async assertConversationActive(conversationId:string,organizationId:string,assistantId:string) { const now=new Date(); const active=await this.db.ticket.findFirst({where:{organizationId,assistantId,conversationId,expiresAt:{gt:now}},select:{id:true}}); if(active)return; const expired=await this.db.ticket.findFirst({where:{organizationId,assistantId,conversationId,expiresAt:{lte:now}},select:{id:true}}); if(expired)throw new GoneException({code:'WIDGET_SESSION_EXPIRED',message:'This ticket conversation expired. Start a fresh chat to continue.'}); }
  private async issueAccess(row: any) {
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const claims = Buffer.from(JSON.stringify({ aud: 'carteio-widget', sid: sessionId, widget: row.publicId, origin: this.credentialHash(row.origin), exp: Math.floor(expiresAt.getTime() / 1000) })).toString('base64url');
    const signature = createHmac('sha256', widgetSigningSecret()).update(claims).digest('base64url');
    const accessToken = `${claims}.${signature}`;
    await this.db.widgetSession.create({data:{id:sessionId,organizationId:row.organizationId,assistantId:row.assistantId,conversationId:row.conversationId,accessTokenHash:this.credentialHash(accessToken),resumeTokenHash:row.resumeTokenHash,visitorSessionId:row.visitorSessionId,origin:row.origin,accessExpiresAt:expiresAt,resumeExpiresAt:row.resumeExpiresAt}});
    return accessToken;
  }
  private signedAccessClaims(token: string): { sid: string; widget: string; origin: string; exp: number } | null {
    const [encoded, supplied, extra] = token.split('.');
    if (!encoded || !supplied || extra || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return null;
    let expected: Buffer;
    let claims: any;
    try {
      expected = createHmac('sha256', widgetSigningSecret()).update(encoded).digest();
      const actual = Buffer.from(supplied, 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch { return null; }
    if (!claims || claims.aud !== 'carteio-widget' || typeof claims.sid !== 'string' || typeof claims.widget !== 'string' || typeof claims.origin !== 'string'
      || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  }
  async bootstrap(input:any, req:any) {
    const origin=this.origin(req),address=String(req.ip??'').slice(0,80);
    await this.rate(`widget:${createHash('sha256').update(`${input.widgetId}:${address}`).digest('hex')}`);
    const config=await this.widget(input.widgetId,origin,req);
    let visitorSessionId=randomBytes(32).toString('base64url'),conversation:any=null,resumeToken=typeof input.resumeToken==='string'?input.resumeToken:this.credential(),resumeTokenHash=this.credentialHash(resumeToken),resumeExpiresAt=new Date(Date.now()+30*86400_000);
    await this.traced(req,'W07_session_created_or_resumed','widget.session.create_or_resume',async()=>{
    if(input.resumeToken){
      const prior=await this.db.widgetSession.findFirst({where:{resumeTokenHash,organizationId:config.organizationId,assistantId:config.assistantId,origin,resumeExpiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'},select:{visitorSessionId:true,conversationId:true,resumeExpiresAt:true}});
      if(!prior)throw new GoneException({code:'WIDGET_SESSION_EXPIRED',message:'This chat has expired. Start a fresh chat.'});
      visitorSessionId=prior.visitorSessionId; resumeExpiresAt=prior.resumeExpiresAt;
      conversation=await this.db.supportConversation.findFirst({where:{id:prior.conversationId,organizationId:config.organizationId,assistantId:config.assistantId,externalSessionHash:this.credentialHash(visitorSessionId),channel:'WEB_WIDGET'},select:{id:true}});
      if(!conversation)throw new GoneException({code:'WIDGET_SESSION_EXPIRED',message:'This chat has expired. Start a fresh chat.'});
      await this.assertConversationActive(conversation.id,config.organizationId,config.assistantId);
    }else{
      conversation=await this.db.supportConversation.create({data:{organizationId:config.organizationId,assistantId:config.assistantId,externalSessionHash:this.credentialHash(visitorSessionId),channel:'WEB_WIDGET'},select:{id:true}});
    }
    await this.db.widgetSession.deleteMany({where:{resumeTokenHash,OR:[{accessExpiresAt:{lte:new Date()}},{resumeExpiresAt:{lte:new Date()}}]}});
    });
    const row={organizationId:config.organizationId,assistantId:config.assistantId,conversationId:conversation.id,visitorSessionId,resumeTokenHash,origin,resumeExpiresAt,publicId:config.publicId};
    const accessToken=await this.traced(req,'W08_session_token_issued','widget.session.issue_access_token',()=>this.issueAccess(row));
    const appearance=this.appearance(config.appearance,config.assistant.name,config.assistant.greetingMessage);
    return {accessToken,resumeToken,expiresIn:900,assistant:appearance};
  }
  private async session(token:string,req:any) {
    const startedAt=Date.now();
    try {
    const origin=this.origin(req),claims=this.signedAccessClaims(token);
    if (!claims || claims.origin !== this.credentialHash(origin)) throw new UnauthorizedException('Widget session is invalid or expired');
    const row=await this.db.widgetSession.findFirst({where:{id:claims.sid,accessTokenHash:this.credentialHash(token),accessExpiresAt:{gt:new Date()},origin},select:{id:true,organizationId:true,assistantId:true,conversationId:true,visitorSessionId:true,resumeTokenHash:true,resumeExpiresAt:true,origin:true}});
    if(!row)throw new UnauthorizedException('Widget session is invalid or expired');
    const config=await this.widgetByAssistant(row.organizationId,row.assistantId,origin,req);
    if(config.publicId!==claims.widget)throw new UnauthorizedException('Widget session is invalid or expired');
    const conversation=await this.db.supportConversation.findFirst({where:{id:row.conversationId,organizationId:row.organizationId,assistantId:row.assistantId,externalSessionHash:this.credentialHash(row.visitorSessionId),channel:'WEB_WIDGET'}});
    if(!conversation)throw new GoneException({code:'WIDGET_SESSION_EXPIRED',message:'This chat expired. Start a fresh chat.'});
    await this.assertConversationActive(conversation.id,row.organizationId,row.assistantId);
    this.debugStage(req,'W11_session_authorization_verified','widget.session.authorize',startedAt);
    return {s:{...row,org:row.organizationId,assistant:row.assistantId,vid:row.visitorSessionId},config,conversation};
    } catch(error) {
      this.debugStage(req,'W11_session_authorization_verified','widget.session.authorize',startedAt,error);
      throw error;
    }
  }
  private async widgetByAssistant(organizationId:string,assistantId:string,origin:string,req?:any) {
    const config=await this.traced(req,'W05_widget_configuration_loaded','widget.configuration.lookup',async()=>{
      const row=await this.db.widgetConfiguration.findFirst({where:{organizationId,assistantId,enabled:true},select:{id:true,organizationId:true,assistantId:true,publicId:true,allowedDomains:true,appearance:true,assistant:{select:{id:true,name:true,greetingMessage:true,status:true,archivedAt:true}}}});
      if(!row)throw new UnauthorizedException('Widget is unavailable');
      return row;
    });
    await this.traced(req,'W06_assistant_validated','widget.assistant.validate',async()=>{if(config.assistant.status!=='ACTIVE'||config.assistant.archivedAt)throw new UnauthorizedException('Widget is unavailable');return true;});
    await this.traced(req,'W04_origin_domain_authorization','widget.origin.authorize',async()=>{if(!widgetOriginMatchesDomains(origin,config.allowedDomains))throw new ForbiddenException('Website origin is not approved');return true;});
    return config;
  }
  async ticketStatus(token:string,req:any,input:{reference:string}) { const {s,conversation}=await this.session(token,req); await this.rate(`widget-session:${s.id}`); return this.tickets.lookupForCustomer({organizationId:s.org,assistantId:s.assistant,conversationId:conversation.id,visitorSessionId:s.vid,reference:input.reference}); }
  async renew(token:string,req:any) { const {s,config}=await this.session(token,req); await this.rate(`widget-session:${s.id}`); return {accessToken:await this.issueAccess({organizationId:s.org,assistantId:s.assistant,conversationId:s.conversationId,visitorSessionId:s.vid,resumeTokenHash:s.resumeTokenHash,origin:s.origin,resumeExpiresAt:s.resumeExpiresAt,publicId:config.publicId}),expiresIn:900}; }
  async history(token:string,req:any,before?:string,limit=30) { const {s,conversation}=await this.session(token,req); if(!conversation) throw new UnauthorizedException(); await this.rate(`widget-session:${s.id}`); let cursor:any={}; if(before){const [time,id,extra]=before.split('~'); if(extra||!time||!id||Number.isNaN(Date.parse(time))||!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('History cursor is invalid'); cursor={OR:[{createdAt:{lt:new Date(time)}},{createdAt:new Date(time),id:{lt:id}}]};} const rows=await this.db.supportMessage.findMany({where:{organizationId:s.org,conversationId:conversation.id,kind:{in:['CUSTOMER','AI','BUSINESS_TEAM','SYSTEM']},AND:[{OR:[{ticketId:null},{ticket:{is:{expiresAt:{gt:new Date()}}}}]},...(cursor.OR?[cursor]:[])]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:Math.min(limit,50)+1,select:{id:true,kind:true,content:true,answerOrigin:true,sourceRefs:true,createdAt:true}}); const more=rows.length>limit; const page=rows.slice(0,limit); return {items:page.reverse().map((m:any)=>({id:m.id,sender:m.kind==='CUSTOMER'?'customer':m.kind==='AI'?'assistant':m.kind==='SYSTEM'?'system':'business',content:m.content,createdAt:m.createdAt,...(widgetSourceIndicator(m.answerOrigin,m.sourceRefs,m.kind)?{sourceIndicator:widgetSourceIndicator(m.answerOrigin,m.sourceRefs,m.kind)}:{})})),hasMore:more,nextCursor:more?`${rows[limit-1].createdAt.toISOString()}~${rows[limit-1].id}`:null}; }
  async message(token:string,req:any,input:any,signal?:AbortSignal) { const {s,conversation}=await this.session(token,req); if(!conversation) throw new UnauthorizedException(); await this.rate(`widget-session:${s.id}`); const idempotencyKey=input.idempotencyKey; const existing=await this.db.supportMessage.findFirst({where:{organizationId:s.org,conversationId:conversation.id,idempotencyKey,kind:'CUSTOMER'},select:{id:true,content:true}}); if(existing&&existing.content!==input.content) throw new ConflictException('Idempotency key already used');
    try {
      this.debugStage(req,'W12_ai_orchestrator_invoked','widget.ai.orchestrator.invoke',Date.now());
      const result=await this.traced(req,'W13_ai_response_generated','widget.ai.orchestrator.complete',()=>this.saas.recordCustomerMessage({organizationId:s.org,assistantId:s.assistant,visitorSessionId:s.vid,channel:'WEB_WIDGET',idempotencyKey,content:input.content,allowTicketStatusLookup:true,requestId:typeof req?.requestId==='string'?req.requestId:undefined,signal}));
      const hash=createHash('sha256').update(s.vid).digest('hex'); const pendingTicket=await this.db.ticketDraft.findFirst({where:{organizationId:s.org,assistantId:s.assistant,conversationId:conversation.id,externalSessionHash:hash,state:'AWAITING_CONFIRMATION',expiresAt:{gt:new Date()}},orderBy:{updatedAt:'desc'},select:{id:true,version:true,title:true,description:true,category:true,priority:true}}); const sources=Array.isArray(result.sources)?result.sources.filter((source:any)=>source&&typeof source.title==='string'&&(source.cited===undefined||source.cited==='true')).map((source:any)=>({title:source.title,locator:typeof source.locator==='string'?source.locator:null})):[]; const sourceIndicator=widgetSourceIndicator(result.answerOrigin,result.sources); return {message:{id:result.messageId,sender:'assistant',content:result.reply,createdAt:result.createdAt,...(sourceIndicator?{sourceIndicator}:{})},sources,provider:result.providerUsed,model:result.modelUsed,...(pendingTicket?{pendingTicket}:{})};
    } catch(e) { throw e; }
  }
  async poll(token:string,req:any,after?:string) { const {s,conversation}=await this.session(token,req); if(!conversation) throw new UnauthorizedException(); await this.rate(`widget-session:${s.id}`); let cursor:any={}; if(after){const [time,id,extra]=after.split('~'); if(extra||!time||!id||Number.isNaN(Date.parse(time))||!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Delivery cursor is invalid'); cursor={OR:[{createdAt:{gt:new Date(time)}},{createdAt:new Date(time),id:{gt:id}}]};} const rows=await this.db.supportMessage.findMany({where:{organizationId:s.org,conversationId:conversation.id,kind:{in:['AI','BUSINESS_TEAM','SYSTEM']},AND:[{OR:[{ticketId:null},{ticket:{is:{expiresAt:{gt:new Date()}}}}]},...(cursor.OR?[cursor]:[])]},orderBy:[{createdAt:'asc'},{id:'asc'}],take:50,select:{id:true,kind:true,content:true,answerOrigin:true,sourceRefs:true,createdAt:true}}); const items=rows.map((m:any)=>({id:m.id,sender:m.kind==='AI'?'assistant':m.kind==='SYSTEM'?'system':'business',content:m.content,createdAt:m.createdAt,...(widgetSourceIndicator(m.answerOrigin,m.sourceRefs,m.kind)?{sourceIndicator:widgetSourceIndicator(m.answerOrigin,m.sourceRefs,m.kind)}:{})})); const last=rows.at(-1); return {items,nextCursor:last?`${last.createdAt.toISOString()}~${last.id}`:after??null}; }
  async confirmTicket(token:string,req:any,draftId:string,input:{action:'CONFIRM_TICKET_DRAFT';version:number}) { const {s,conversation}=await this.session(token,req); await this.rate(`widget-session:${s.id}`); if(input.action!=='CONFIRM_TICKET_DRAFT') throw new BadRequestException('Typed ticket confirmation is required'); const ticket=await this.tickets.confirmCustomerDraft({organizationId:s.org,assistantId:s.assistant,conversationId:conversation.id,visitorSessionId:s.vid,draftId,version:input.version,action:input.action}); const idempotencyKey=`ticket-confirm:${draftId}:${input.version}`; const content=`Ticket ${ticket.reference} was created. Current status: ${ticket.status}.`; await this.saas.recordAssistantMessage({organizationId:s.org,assistantId:s.assistant,visitorSessionId:s.vid,channel:'WEB_WIDGET',idempotencyKey,content,answerOrigin:'DETERMINISTIC_POLICY',responseCategory:'ticket_confirmation'}); const message=await this.db.supportMessage.findFirst({where:{organizationId:s.org,conversationId:conversation.id,kind:'AI',idempotencyKey},select:{id:true,content:true,answerOrigin:true,sourceRefs:true,createdAt:true}}); await this.db.supportMessage.updateMany({where:{organizationId:s.org,conversationId:conversation.id,id:message.id},data:{ticketId:ticket.id}}); const sourceIndicator=widgetSourceIndicator(message.answerOrigin,message.sourceRefs); return {ticket,message:{id:message.id,sender:'assistant',content:message.content,createdAt:message.createdAt,...(sourceIndicator?{sourceIndicator}:{})}}; }
  async cancelTicket(token:string,req:any,draftId:string) { const {s,conversation}=await this.session(token,req); await this.rate(`widget-session:${s.id}`); const result=await this.tickets.cancelDraft({organizationId:s.org,assistantId:s.assistant,conversationId:conversation.id,visitorSessionId:s.vid,draftId}); const idempotencyKey=`ticket-cancel:${draftId}`; const content=result.cancelled?'The ticket request was cancelled.':'There is no active ticket request to cancel.'; await this.saas.recordAssistantMessage({organizationId:s.org,assistantId:s.assistant,visitorSessionId:s.vid,channel:'WEB_WIDGET',idempotencyKey,content,answerOrigin:'DETERMINISTIC_POLICY',responseCategory:'ticket_cancellation'}); const message=await this.db.supportMessage.findFirst({where:{organizationId:s.org,conversationId:conversation.id,kind:'AI',idempotencyKey},select:{id:true,content:true,answerOrigin:true,sourceRefs:true,createdAt:true}}); const sourceIndicator=widgetSourceIndicator(message.answerOrigin,message.sourceRefs); return {cancelled:result.cancelled,message:{id:message.id,sender:'assistant',content:message.content,createdAt:message.createdAt,...(sourceIndicator?{sourceIndicator}:{})}}; }
  async acknowledge(token:string,req:any,ids:string[]) { const {s,conversation}=await this.session(token,req); await this.rate(`widget-session:${s.id}`); if(!Array.isArray(ids)||ids.length>50) throw new BadRequestException('Acknowledgement list is invalid'); const deliveries=await this.db.outboundDelivery.findMany({where:{organizationId:s.org,conversationId:conversation.id,messageId:{in:ids},state:{in:['QUEUED','PROCESSING','SENT','DELIVERED']},ticket:{is:{expiresAt:{gt:new Date()}}}},select:{ticketId:true,messageId:true,state:true}}); for(const delivery of deliveries) await this.tickets.recordDeliveryOutcome({organizationId:s.org,ticketId:delivery.ticketId,messageId:delivery.messageId,state:'DELIVERED',eventId:`widget-ack:${delivery.messageId}`}); return {acknowledged:deliveries.length}; }
}
