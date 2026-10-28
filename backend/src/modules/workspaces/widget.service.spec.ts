import { ForbiddenException, GoneException, UnauthorizedException } from '@nestjs/common';
import { WidgetService } from './widget.service';

describe('WidgetService public sessions', () => {
  const config = { id:'cfg', organizationId:'org-a', assistantId:'assistant-a', publicId:'widget_identifier_123456', enabled:true, allowedDomains:['shop.example.com'], appearance:{name:'Shop AI',welcomeMessage:'Hello',color:'#3157d5',position:'right',suggestions:[]}, assistant:{id:'assistant-a',name:'Shop AI',greetingMessage:null,status:'ACTIVE',archivedAt:null} };
  const create = () => {
    const db:any={widgetConfiguration:{findFirst:jest.fn().mockResolvedValue(config)},widgetSession:{findFirst:jest.fn().mockResolvedValue({id:'session-a',organizationId:'org-a',assistantId:'assistant-a',conversationId:'conversation-a',visitorSessionId:'visitor-a',resumeTokenHash:'hash-resume',resumeExpiresAt:new Date(Date.now()+86400000),origin:'https://shop.example.com'}),create:jest.fn().mockResolvedValue({}),deleteMany:jest.fn()},supportConversation:{findFirst:jest.fn().mockResolvedValue(null),create:jest.fn().mockResolvedValue({id:'conversation-a'})},supportMessage:{updateMany:jest.fn().mockResolvedValue({count:1}),findFirst:jest.fn().mockResolvedValue(null),findMany:jest.fn().mockResolvedValue([])},ticketDraft:{findFirst:jest.fn().mockResolvedValue(null)},ticket:{findFirst:jest.fn().mockResolvedValue(null)},auditEvent:{create:jest.fn()},$queryRaw:jest.fn().mockResolvedValue([{requestCount:1}])};
    const saas:any={recordAssistantMessage:jest.fn().mockResolvedValue({}),recordCustomerMessage:jest.fn().mockResolvedValue({messageId:'ai-message',reply:'A grounded answer',answerOrigin:'MODEL_GENERATED',sources:[],providerUsed:'gemini',modelUsed:'model-x',createdAt:new Date()})};
    const delivery:any={register:jest.fn()};
    const tickets:any={recordDeliveryOutcome:jest.fn().mockResolvedValue({state:'DELIVERED'}),confirmCustomerDraft:jest.fn().mockResolvedValue({id:'ticket-a',reference:'TKT-0123456789',status:'OPEN'}),cancelDraft:jest.fn().mockResolvedValue({cancelled:true})};
    const service=new WidgetService(db,{} as any,saas,tickets,delivery);
    return {db,service,saas,tickets};
  };
  const request=(origin='https://shop.example.com')=>({headers:{origin},ip:'127.0.0.1'});
  const originalSigningSecret=process.env.AUTH_OTP_HASH_SECRET;
  beforeEach(()=>{process.env.AUTH_OTP_HASH_SECRET='widget-session-test-secret-with-at-least-32-bytes';});
  afterEach(()=>{if(originalSigningSecret===undefined)delete process.env.AUTH_OTP_HASH_SECRET;else process.env.AUTH_OTP_HASH_SECRET=originalSigningSecret;});

  it('issues opaque signed origin-bound bearer credentials for an enabled active assistant',async()=>{
    const {service,db}=create(); const result=await service.bootstrap({widgetId:config.publicId},request());
    expect(result.accessToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/); expect(result.accessToken).not.toContain('org-a'); expect((result as any).conversationId).toBeUndefined(); expect(db.widgetSession.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({organizationId:'org-a',assistantId:'assistant-a',conversationId:'conversation-a',accessTokenHash:expect.any(String),resumeTokenHash:expect.any(String),origin:'https://shop.example.com'})})); expect(db.supportConversation.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({organizationId:'org-a',assistantId:'assistant-a',channel:'WEB_WIDGET'})}));
  });
  it('rejects an unapproved website origin during bootstrap',async()=>{
    const {service}=create(); await expect(service.bootstrap({widgetId:config.publicId},request('https://attacker.invalid'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('serves a complete appearance with a built-in-avatar fallback when legacy appearance fields are absent',async()=>{
    const {service,db}=create();
    db.widgetConfiguration.findFirst.mockResolvedValue({...config,appearance:{name:'Assistant',welcomeMessage:'Welcome',color:'#122233',userBubbleColor:'#334455',position:'left'}});
    const result=await service.publicConfiguration(config.publicId,request());
    expect(result.assistant).toMatchObject({name:'Assistant',welcomeMessage:'Welcome',color:'#122233',position:'left',avatarUrl:null,fontFamily:'system',desktopSize:'medium',width:380,height:590,mobileWidth:420,mobileHeight:720,suggestions:[]});
  });
  it('preserves a valid customer avatar URL in the public appearance response',async()=>{
    const {service,db}=create();
    db.widgetConfiguration.findFirst.mockResolvedValue({...config,appearance:{...config.appearance,name:'Shop assistant',welcomeMessage:'Welcome',color:'#122233',userBubbleColor:'#334455',position:'right',desktopSize:'custom',width:400,height:600,mobileWidth:360,mobileHeight:700,cornerRadius:20,launcherSize:56,fontFamily:'system',avatarUrl:'https://images.example.test/avatar.png',suggestions:['Shipping times?']}});
    const result=await service.publicConfiguration(config.publicId,request());
    expect(result.assistant.avatarUrl).toBe('https://images.example.test/avatar.png');
  });
  it('rejects expired or tampered session credentials',async()=>{
    const {service}=create();
    await expect(service.history('unknown-opaque-credential-value-000000000000000000000000000000000000000',request())).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('renews a session against its same origin and tenant-bound conversation',async()=>{
    const {service,db}=create(); const boot=await service.bootstrap({widgetId:config.publicId},request()); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'});
    const renewed=await service.renew(boot.accessToken,request()); expect(renewed.expiresIn).toBe(900); expect(renewed.accessToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    await expect(service.renew(boot.accessToken,request('https://other.example'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('resumes only the original visitor conversation with the opaque resume credential',async()=>{
    const {service,db}=create(); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'});
    const resumed=await service.bootstrap({widgetId:config.publicId,resumeToken:'opaque-resume-token-from-original-widget-session'},request());
    expect(db.widgetSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({organizationId:'org-a',assistantId:'assistant-a',origin:'https://shop.example.com',resumeExpiresAt:{gt:expect.any(Date)}})}));
    expect(db.supportConversation.create).not.toHaveBeenCalled(); expect(resumed.resumeToken).toBe('opaque-resume-token-from-original-widget-session');
  });
  it('rejects expired ticket conversations before loading history',async()=>{
    const {service,db}=create(); const boot=await service.bootstrap({widgetId:config.publicId},request()); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'}); db.ticket.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({id:'expired-ticket'});
    await expect(service.history(boot.accessToken,request())).rejects.toBeInstanceOf(GoneException);
  });
  it('routes a widget customer turn through SaasService into shared customer AI',async()=>{
    const {service,db,saas}=create(); const boot=await service.bootstrap({widgetId:config.publicId},request()); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'});
    const answer=await service.message(boot.accessToken,request(),{content:'Can you help?',idempotencyKey:'customer-turn-0001'});
    expect(saas.recordCustomerMessage).toHaveBeenCalledWith(expect.objectContaining({organizationId:'org-a',assistantId:'assistant-a',channel:'WEB_WIDGET',content:'Can you help?',allowTicketStatusLookup:true}));
    expect(answer.message.content).toBe('A grounded answer'); expect(answer.provider).toBe('gemini');
  });
  it('loads history only for the signed conversation and tenant',async()=>{
    const {service,db}=create(); const boot=await service.bootstrap({widgetId:config.publicId},request()); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'});
    await service.history(boot.accessToken,request(),undefined,30);
    expect(db.supportConversation.findFirst.mock.calls.at(-1)?.[0].where).toEqual(expect.objectContaining({id:'conversation-a',organizationId:'org-a',assistantId:'assistant-a'}));
    expect(db.supportMessage.findMany.mock.calls[0][0].where.conversationId).toBe('conversation-a');
  });
  it('restores only coarse persisted answer provenance with history',async()=>{
    const {service,db}=create(); const boot=await service.bootstrap({widgetId:config.publicId},request()); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'});
    db.supportMessage.findMany.mockResolvedValue([{id:'answer-1',kind:'AI',content:'Found a product',answerOrigin:'MODEL_GENERATED',sourceRefs:[{type:'COMMERCE_PRODUCT',cited:'true',title:'Private product title',locator:'https://shop.example.com/products/item'}],createdAt:new Date()}]);
    const result=await service.history(boot.accessToken,request());
    expect(result.items[0].sourceIndicator).toEqual({generationType:'AI_GENERATED',evidenceSources:['SHOPIFY']});
    expect(result.items[0]).not.toHaveProperty('sources');
    expect(JSON.stringify(result.items[0])).not.toContain('Private product title');
    expect(JSON.stringify(result.items[0])).not.toContain('/products/item');
  });
  it('acknowledges only outbox messages in the current signed conversation',async()=>{
    const {service,db,tickets}=create(); const boot=await service.bootstrap({widgetId:config.publicId},request()); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'});
    db.outboundDelivery={findMany:jest.fn().mockResolvedValue([{ticketId:'ticket-a',messageId:'reply-message',state:'SENT'}])};
    await service.acknowledge(boot.accessToken,request(),['reply-message']);
    expect(db.outboundDelivery.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({organizationId:'org-a',conversationId:'conversation-a',messageId:{in:['reply-message']}}));
    expect(tickets.recordDeliveryOutcome).toHaveBeenCalledWith(expect.objectContaining({ticketId:'ticket-a',messageId:'reply-message',state:'DELIVERED'}));
  });
  it('confirms only the session-bound draft ID and displayed version through TicketingService',async()=>{
    const {service,db,tickets,saas}=create(); const boot=await service.bootstrap({widgetId:config.publicId},request()); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'}); db.supportMessage.findFirst.mockResolvedValue({id:'confirmation-message',createdAt:new Date()});
    const result=await service.confirmTicket(boot.accessToken,request(),'draft-a',{action:'CONFIRM_TICKET_DRAFT',version:4});
    expect(tickets.confirmCustomerDraft).toHaveBeenCalledWith(expect.objectContaining({organizationId:'org-a',assistantId:'assistant-a',conversationId:'conversation-a',draftId:'draft-a',version:4,action:'CONFIRM_TICKET_DRAFT'}));
    expect(saas.recordAssistantMessage).toHaveBeenCalled(); expect(result.ticket.reference).toBe('TKT-0123456789');
  });
  it('reports a failed cancellation without claiming that the request was cancelled',async()=>{
    const {service,db,tickets,saas}=create(); const boot=await service.bootstrap({widgetId:config.publicId},request()); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'}); tickets.cancelDraft=jest.fn().mockResolvedValue({cancelled:false}); db.supportMessage.findFirst.mockResolvedValue({id:'cancel-message',content:'There is no active ticket request to cancel.',createdAt:new Date()});
    const result=await service.cancelTicket(boot.accessToken,request(),'draft-a');
    expect(result.cancelled).toBe(false); expect(result.message.content).toBe('There is no active ticket request to cancel.'); expect(saas.recordAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({content:'There is no active ticket request to cancel.'}));
  });
  it('keeps anonymous sessions available for ordinary AI conversations',async()=>{
    const {service,db,saas}=create(); const boot=await service.bootstrap({widgetId:config.publicId},request()); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'});
    const result=await service.message(boot.accessToken,request(),{content:'What are your hours?',idempotencyKey:'anonymous-chat-0001'});
    expect(result.message.content).toBe('A grounded answer'); expect(saas.recordCustomerMessage).toHaveBeenCalled();
  });
  it('uses the current session conversation to authorize ticket status rather than the reference alone',async()=>{
    const {service,db,tickets}=create(); const boot=await service.bootstrap({widgetId:config.publicId},request()); db.supportConversation.findFirst.mockResolvedValue({id:'conversation-a'}); tickets.lookupForCustomer=jest.fn().mockResolvedValue({reference:'TKT-0123456789',status:'ACTIVE',expiresAt:new Date(),timeline:[]});
    const status=await service.ticketStatus(boot.accessToken,request(),{reference:'TKT-0123456789'});
    expect(status.status).toBe('ACTIVE'); expect(tickets.lookupForCustomer).toHaveBeenCalledWith(expect.objectContaining({organizationId:'org-a',assistantId:'assistant-a',conversationId:'conversation-a',visitorSessionId:expect.any(String)}));
  });
  it('keeps internal conversation notes outside public history and delivery polling', async () => {
    const { service, db } = create();
    const boot = await service.bootstrap({ widgetId: config.publicId }, request());
    db.supportConversation.findFirst.mockResolvedValue({ id: 'conversation-a' });
    const records = [
      { id: 'public-message', kind: 'AI', content: 'Public reply', createdAt: new Date(), answerOrigin: 'MODEL_GENERATED', sourceRefs: [] },
      { id: 'internal-note', kind: 'INTERNAL_NOTE', content: 'Private manager note', createdAt: new Date(), sourceRefs: [] },
    ];
    db.supportMessage.findMany.mockImplementation(async ({ where }: any) => {
      expect(where.organizationId).toBe('org-a');
      expect(where.conversationId).toBe('conversation-a');
      return records.filter(row => where.kind.in.includes(row.kind));
    });
    const history = await service.history(boot.accessToken, request());
    const updates = await service.poll(boot.accessToken, request());
    expect(JSON.stringify(history)).toContain('Public reply');
    expect(JSON.stringify(updates)).toContain('Public reply');
    expect(JSON.stringify([history, updates])).not.toContain('Private manager note');
  });

  it('uses distinct rate buckets for authenticated widget session records', async () => {
    const { service, db } = create();
    const first = await service.bootstrap({ widgetId: config.publicId }, request());
    const second = await service.bootstrap({ widgetId: config.publicId }, request());
    const sessions = db.widgetSession.create.mock.calls.map(([input]: any[]) => input.data);
    db.widgetSession.findFirst.mockImplementation(async ({ where }: any) => sessions.find((row: any) => row.id === where.id && row.accessTokenHash === where.accessTokenHash && row.origin === where.origin));
    db.supportConversation.findFirst.mockResolvedValue({ id: 'conversation-a' });
    await service.history(first.accessToken, request());
    await service.history(second.accessToken, request());
    const buckets = db.$queryRaw.mock.calls.flat().filter((value: unknown) => typeof value === 'string' && value.startsWith('widget-session:'));
    expect(sessions[0].id).not.toBe(sessions[1].id);
    expect(buckets).toEqual(sessions.map((row: any) => `widget-session:${row.id}`));
  });

});
