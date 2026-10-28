import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Activity, CheckCircle2, Copy, Globe, MessageCircle, Monitor, RotateCcw, Save, Send, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { listAssistants, sendPlaygroundMessage, type Assistant, type PlaygroundChatReply } from '../../services/api/assistants';
import { getWidgetConfig, saveWidgetConfig, type WidgetConfig } from '../../services/api/widget';
import { apiGet, ApiError } from '../../services/api/client';
import { getWidgetApiOrigin, getWidgetHostingOrigin, isWidgetApiOriginConfigurationValid } from '../../config';
import './widget-installation.css';
import { PageHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';

type TestMessage = { role: 'user'|'assistant'; content: string; sources?: PlaygroundChatReply['sources'] };
type ServiceStatus = 'checking'|'available'|'unavailable'|'ready'|'limited'|'not-checked';
const fresh=(assistantId=''):WidgetConfig=>({assistantId,publicId:'',enabled:false,allowedDomains:[],appearance:{name:'Assistant',welcomeMessage:'Hi! How can I help?',color:'#3157d5',userBubbleColor:'#3157d5',position:'right',fontFamily:'system',desktopSize:'medium',width:380,height:590,mobileWidth:420,mobileHeight:720,cornerRadius:20,launcherSize:58,avatarUrl:null,suggestions:[]}});
const widgetFont=(font:'system'|'inter'|'arial'|'georgia'|'verdana')=>({system:'ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',inter:'Inter,ui-sans-serif,sans-serif',arial:'Arial,Helvetica,sans-serif',georgia:'Georgia,serif',verdana:'Verdana,Geneva,sans-serif'}[font]);
function readableForeground(hex:string | null | undefined){const color=typeof hex==='string'&&/^#[0-9a-f]{6}$/i.test(hex)?hex:'#3157d5';const [red=0,green=0,blue=0]=[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16)/255).map(channel=>channel<=0.03928?channel/12.92:((channel+0.055)/1.055)**2.4);return red*0.2126+green*0.7152+blue*0.0722>0.42?'#182230':'#ffffff';}
function PreviewAvatar({url}:{url:string|null}){const [failed,setFailed]=useState(false);return <span className="preview-avatar"><MessageCircle aria-hidden="true"/>{url&&!failed?<img src={url} alt="" onError={()=>setFailed(true)}/>:null}</span>;}

export function WidgetInstallationPage(){
 const appearanceOnly = useLocation().pathname.endsWith('/widget/appearance');
 const {slug=''}=useParams();
 const [assistants,setAssistants]=useState<Assistant[]>([]);
 const [value,setValue]=useState<WidgetConfig>(fresh());
 const [domains,setDomains]=useState('');
 const [suggestions,setSuggestions]=useState<string[]>([]);
 const [suggestionDraft,setSuggestionDraft]=useState('');
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 const [mode,setMode]=useState<'visual'|'test'>('visual');
 const [testAssistantId,setTestAssistantId]=useState('');
 const [chatMessages,setChatMessages]=useState<TestMessage[]>([]);
 const [chatInput,setChatInput]=useState('');
 const [chatBusy,setChatBusy]=useState(false);
 const [chatError,setChatError]=useState('');
 const [chatSessionId,setChatSessionId]=useState<string>();
 const [previewDevice,setPreviewDevice]=useState<'desktop'|'mobile'>('desktop');
 const [previewOpen,setPreviewOpen]=useState(true);
 const [scriptStatus,setScriptStatus]=useState<ServiceStatus>('checking');
 const [apiStatus,setApiStatus]=useState<ServiceStatus>('checking');
 const saved=useRef<WidgetConfig>(fresh());
 const activeAssistants=assistants.filter((assistant)=>assistant.status==='active');

 useEffect(()=>{
  const ctl=new AbortController();
  listAssistants(slug,1,ctl.signal,'ALL').then(async p=>{
   if(ctl.signal.aborted)return;
   const list=p.assistants.filter(x=>x.status!=='archived');
   setAssistants(list);
   const active=list.find((assistant)=>assistant.status==='active');
   setTestAssistantId(active?.id??'');
   if(list[0]){
    const cfg=await getWidgetConfig(slug,list[0].id,ctl.signal);
    if(ctl.signal.aborted)return;
    setValue(cfg);saved.current=cfg;setDomains(cfg.allowedDomains.join('\n'));setSuggestions(cfg.appearance.suggestions);
   }
  }).catch(e=>{if(!ctl.signal.aborted)setError(e instanceof ApiError?e.message:'Widget settings could not be loaded.');}).finally(()=>{if(!ctl.signal.aborted)setLoading(false)});
  return()=>ctl.abort();
 },[slug]);

 useEffect(()=>{
  const ctl=new AbortController();
  const hostingOrigin=getWidgetHostingOrigin();
  if(hostingOrigin)fetch(new URL('/widget.js',hostingOrigin),{cache:'no-store',signal:ctl.signal}).then(response=>{const contentType=response.headers.get('content-type')??'';if(!ctl.signal.aborted)setScriptStatus(response.ok&&/javascript|ecmascript/i.test(contentType)?'available':response.ok?'limited':'unavailable')}).catch(()=>{if(!ctl.signal.aborted)setScriptStatus('unavailable')});
  else setScriptStatus('unavailable');
  apiGet<{status:'ready'|'limited'|'unavailable'}>('/ready',ctl.signal).then(result=>setApiStatus(result.status)).catch(()=>{if(!ctl.signal.aborted)setApiStatus('unavailable')});
  return()=>ctl.abort();
 },[]);

 const hostingOrigin=getWidgetHostingOrigin();
 const apiOrigin=getWidgetApiOrigin();
 const apiOriginValid=isWidgetApiOriginConfigurationValid();
 const snippet=useMemo(()=>value.publicId&&hostingOrigin&&apiOriginValid?`<script async src="${hostingOrigin}/widget.js" data-widget-id="${value.publicId}"${apiOrigin?` data-api-base-url="${apiOrigin}"`:''}></script>`:'',[value.publicId,hostingOrigin,apiOrigin,apiOriginValid]);
 async function choose(id:string){if(!id){const empty=fresh();setValue(empty);saved.current=empty;setDomains('');setSuggestions([]);return;}setBusy(true);setError('');try{const cfg=await getWidgetConfig(slug,id);setValue(cfg);saved.current=cfg;setDomains(cfg.allowedDomains.join('\n'));setSuggestions(cfg.appearance.suggestions);}catch(e){setValue(fresh(id));setDomains('');setSuggestions([]);if(!(e instanceof ApiError&&e.status===404))setError(e instanceof ApiError?e.message:'Widget settings could not be loaded.');}finally{setBusy(false)}}
 async function save(){
  setBusy(true);setError('');setNotice('');
  try{
   const next=await saveWidgetConfig(slug,{assistantId:value.assistantId,enabled:value.enabled,allowedDomains:domains.split(/[\n,]/).map(x=>x.trim()).filter(Boolean),appearance:{...value.appearance,suggestions}});
   setValue(next);saved.current=next;setDomains(next.allowedDomains.join('\n'));setSuggestions(next.appearance.suggestions);setNotice('Widget settings saved.');
  }catch(e){setError(e instanceof ApiError?e.message:'Widget settings could not be saved.');}
  finally{setBusy(false)}
 }
 async function copy(){if(!snippet){setError('Widget hosting is not configured. Set a valid VITE_WIDGET_HOSTING_ORIGIN before generating an installation snippet.');return;}try{await navigator.clipboard.writeText(snippet);setNotice('Embed snippet copied.');}catch{setError('Clipboard access is unavailable. Select and copy the snippet.');}}
 function resetTestChat(){setChatMessages([]);setChatInput('');setChatError('');setChatSessionId(undefined);}
 function chooseTestAssistant(id:string){setTestAssistantId(id);resetTestChat();}
 async function sendTestMessage(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const message=chatInput.trim();
  if(!message||!testAssistantId||chatBusy)return;
  setChatInput('');setChatError('');setChatMessages(items=>[...items,{role:'user',content:message}]);setChatBusy(true);
  try{
   const reply=await sendPlaygroundMessage(slug,testAssistantId,message,chatSessionId,crypto.randomUUID());
   setChatSessionId(reply.sessionId);
   setChatMessages(items=>[...items,{role:'assistant',content:reply.reply,sources:reply.sources}]);
  }catch(e){setChatError(e instanceof ApiError?`${e.message}${e.requestId?` · Reference: ${e.requestId}`:''}`:'The AI test request could not be completed. Retry or start a new conversation.');}
  finally{setChatBusy(false)}
 }

 const selectedAssistant=assistants.find(assistant=>assistant.id===value.assistantId);
 const savedAssistant=assistants.find(assistant=>assistant.id===saved.current.assistantId);
 const domainValues=domains.split(/[\n,]/).map(domain=>domain.trim()).filter(Boolean);
 const suggestionValues=suggestions;
 const domainValidation=domainValues.length>20?'A maximum of 20 domains is allowed.':domainValues.some(domain=>domain.includes('*')||domain.includes('/')||! /^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/.test(domain.toLowerCase())||domain.includes('..'))?'Enter hostnames only, without wildcards or paths.':value.enabled&&!domainValues.length?'Add at least one approved domain before enabling the widget.':'';
 const assistantValidation=value.assistantId&&!assistants.some(assistant=>assistant.id===value.assistantId)?'Select an assistant in this workspace.':'';
 const avatarValidation=(()=>{const raw=value.appearance.avatarUrl?.trim();if(!raw)return '';try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.href.length<=2048?'':'Use an HTTPS image URL without credentials or a custom port.'}catch{return 'Enter a valid HTTPS image URL.'}})();
 const nameValidation=!value.appearance.name.trim()?'Display name is required.':value.appearance.name.length>80?'Display name must be 80 characters or fewer.':'';
 const colorValidation=/^#[0-9a-f]{6}$/i.test(value.appearance.color)?'':'Enter a valid six-digit brand color.';
 const bubbleColorValidation=/^#[0-9a-f]{6}$/i.test(value.appearance.userBubbleColor)?'':'Enter a valid six-digit message color.';
 const welcomeValidation=!value.appearance.welcomeMessage.trim()?'Welcome message is required.':value.appearance.welcomeMessage.length>500?'Welcome message must be 500 characters or fewer.':'';
 const suggestionsValidation=suggestionValues.length>5?'Use no more than five suggested questions.':suggestionValues.some(item=>!item.trim()||item.length>120)?'Each suggested question must be 1–120 characters.':'';
 const dimensionValidation=value.appearance.desktopSize==='custom'&&(value.appearance.width%1!==0||value.appearance.height%1!==0||value.appearance.width<320||value.appearance.width>560||value.appearance.height<420||value.appearance.height>900)?'Desktop width must be a whole number from 320–560px and height a whole number from 420–900px.':'';
 const mobileWidthValidation=value.appearance.mobileWidth%1!==0||value.appearance.mobileWidth<280||value.appearance.mobileWidth>600?'Mobile width must be a whole number from 280–600px.':'';
 const mobileHeightValidation=value.appearance.mobileHeight%1!==0||value.appearance.mobileHeight<360||value.appearance.mobileHeight>900?'Mobile height must be a whole number from 360–900px.':'';
 const radiusValidation=value.appearance.cornerRadius%1!==0||value.appearance.cornerRadius<12||value.appearance.cornerRadius>32?'Corner radius must be a whole number from 12–32px.':'';
 const launcherValidation=value.appearance.launcherSize%1!==0||value.appearance.launcherSize<48||value.appearance.launcherSize>80?'Launcher size must be a whole number from 48–80px.':'';
 const appearanceInvalid=Boolean(assistantValidation||avatarValidation||nameValidation||colorValidation||bubbleColorValidation||welcomeValidation||suggestionsValidation||dimensionValidation||mobileWidthValidation||mobileHeightValidation||radiusValidation||launcherValidation);
 const appearanceSnapshot=(appearance:WidgetConfig['appearance'])=>Object.keys(appearance).sort().map(key=>[key,appearance[key as keyof typeof appearance]]);
 const dirty=value.assistantId!==saved.current.assistantId||value.enabled!==saved.current.enabled||JSON.stringify(domainValues)!==JSON.stringify(saved.current.allowedDomains)||JSON.stringify(appearanceSnapshot({...value.appearance,suggestions}))!==JSON.stringify(appearanceSnapshot(saved.current.appearance));
 const statusLabel=(status:ServiceStatus)=>status==='checking'?'Checking':status==='available'||status==='ready'?'Available':status==='limited'?'Outdated asset':status==='not-checked'?'Not checked':'Unavailable';
 if(loading)return <main className="widget-install"><h1>{appearanceOnly?'Widget Appearance':'Widget / Installation'}</h1><p role="status">Loading saved settings…</p></main>;
 return <main className={`widget-install${appearanceOnly?' widget-appearance-only':''}`}>
  <PageHeader eyebrow="Customer Experience" title={appearanceOnly?'Widget Appearance':'Widget / Installation'} desc={appearanceOnly?'Customize the assistant launcher and chat appearance.':'Set up a secure, on-brand chat for your approved websites.'} statusLabel={dirty?'Unsaved changes':saved.current.enabled?'Widget enabled':'Widget disabled'} action={<Link className="btn btn-secondary widget-mode-link" to={appearanceOnly?`/workspace/${encodeURIComponent(slug)}/widget`:`/workspace/${encodeURIComponent(slug)}/widget/appearance`}>{appearanceOnly?'Installation':'Customize appearance'}</Link>}/>
  {error&&<p className="widget-error" role="alert">{error}</p>}{notice&&<p className="widget-notice" role="status">{notice}</p>}
  <div className="widget-grid">
   <section className="widget-card">
    <section className="widget-section"><div className="widget-section-heading"><span className="widget-section-icon"><MessageCircle size={17}/></span><div><h2>Assistant and availability</h2><p>Choose the active assistant visitors will talk to.</p></div></div>
     <label>Assistant<select value={value.assistantId} onChange={e=>void choose(e.target.value)} aria-invalid={Boolean(assistantValidation)} aria-describedby="widget-assistant-error"><option value="">Select an assistant</option>{assistants.map(a=><option value={a.id} key={a.id}>{a.name} · {a.status}</option>)}</select>{assistantValidation&&<small className="widget-field-error" id="widget-assistant-error" role="alert">{assistantValidation}</small>}</label>
     <label className="widget-toggle"><input type="checkbox" checked={value.enabled} onChange={e=>setValue({...value,enabled:e.target.checked})}/><span><strong>Enable storefront widget</strong><small>{value.enabled?'Visitors on approved domains can start a chat.':'The embed will not create visitor sessions until enabled.'}</small></span></label>
     {!assistants.length&&<p className="widget-inline-warning" role="status">Create an assistant before configuring a website widget.</p>}{selectedAssistant&&selectedAssistant.status!=='active'&&<p className="widget-inline-warning" role="status">Activate this assistant before enabling the widget.</p>}
    </section>
    <section className="widget-section"><div className="widget-section-heading"><span className="widget-section-icon"><Activity size={17}/></span><div><h2>Appearance &amp; branding</h2><p>Preview edits here; changes reach the storefront after saving.</p></div></div>
     <label>Display name<input maxLength={80} value={value.appearance.name} onChange={e=>setValue({...value,appearance:{...value.appearance,name:e.target.value}})} aria-invalid={Boolean(nameValidation)} aria-describedby="widget-name-error"/>{nameValidation&&<small className="widget-field-error" id="widget-name-error" role="alert">{nameValidation}</small>}</label>
     <label>Widget font<select value={value.appearance.fontFamily} onChange={e=>setValue({...value,appearance:{...value.appearance,fontFamily:e.target.value as WidgetConfig['appearance']['fontFamily']}})}><option value="system">System</option><option value="inter">Inter</option><option value="arial">Arial</option><option value="georgia">Georgia</option><option value="verdana">Verdana</option></select></label>
     <label>Avatar image URL<input maxLength={2048} value={value.appearance.avatarUrl||''} onChange={e=>setValue({...value,appearance:{...value.appearance,avatarUrl:e.target.value||null}})} placeholder="https://example.com/avatar.png" aria-invalid={Boolean(avatarValidation)} aria-describedby="widget-avatar-help widget-avatar-error"/><small id="widget-avatar-help">Optional HTTPS image URL.</small>{avatarValidation&&<small className="widget-field-error" id="widget-avatar-error" role="alert">{avatarValidation}</small>}</label>
     <label>Welcome message<textarea maxLength={500} rows={3} value={value.appearance.welcomeMessage} onChange={e=>setValue({...value,appearance:{...value.appearance,welcomeMessage:e.target.value}})} aria-invalid={Boolean(welcomeValidation)} aria-describedby="widget-welcome-error"/>{welcomeValidation&&<small className="widget-field-error" id="widget-welcome-error" role="alert">{welcomeValidation}</small>}</label>
     <div className="widget-fields"><label>Header / brand color<span className="color-control"><input type="color" value={/^#[0-9a-f]{6}$/i.test(value.appearance.color)?value.appearance.color:'#3157d5'} onChange={e=>setValue({...value,appearance:{...value.appearance,color:e.target.value}})} aria-invalid={Boolean(colorValidation)} aria-describedby="widget-color-error"/><input value={value.appearance.color} maxLength={7} onChange={e=>setValue({...value,appearance:{...value.appearance,color:e.target.value}})} aria-label="Header HEX color"/></span>{colorValidation&&<small className="widget-field-error" id="widget-color-error" role="alert">{colorValidation}</small>}</label><label>User message color<span className="color-control"><input type="color" value={/^#[0-9a-f]{6}$/i.test(value.appearance.userBubbleColor)?value.appearance.userBubbleColor:'#3157d5'} onChange={e=>setValue({...value,appearance:{...value.appearance,userBubbleColor:e.target.value}})} aria-invalid={Boolean(bubbleColorValidation)}/><input value={value.appearance.userBubbleColor} maxLength={7} onChange={e=>setValue({...value,appearance:{...value.appearance,userBubbleColor:e.target.value}})} aria-label="User message HEX color"/></span>{bubbleColorValidation&&<small className="widget-field-error" role="alert">{bubbleColorValidation}</small>}</label></div>
     <div className="widget-fields"><label>Launcher position<select value={value.appearance.position} onChange={e=>setValue({...value,appearance:{...value.appearance,position:e.target.value as 'left'|'right'}})}><option value="right">Bottom right</option><option value="left">Bottom left</option></select></label><label>Desktop widget size<select value={value.appearance.desktopSize} onChange={e=>{const size=e.target.value as WidgetConfig['appearance']['desktopSize'];const preset=size==='small'?{width:340,height:480}:size==='large'?{width:440,height:720}:{width:380,height:590};setValue({...value,appearance:{...value.appearance,desktopSize:size,...(size==='custom'?{}:preset)}})}}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="custom">Custom dimensions</option></select></label></div>
     {value.appearance.desktopSize==='custom'&&<div className="widget-fields"><label>Desktop width (px)<input type="number" min={320} max={560} value={value.appearance.width} onChange={e=>setValue({...value,appearance:{...value.appearance,width:Number(e.target.value)}})}/></label><label>Desktop height (px)<input type="number" min={420} max={900} value={value.appearance.height} onChange={e=>setValue({...value,appearance:{...value.appearance,height:Number(e.target.value)}})}/></label>{dimensionValidation&&<small className="widget-field-error">{dimensionValidation}</small>}</div>}
     <div className="widget-fields"><label>Mobile maximum width (px)<input type="number" min={280} max={600} value={value.appearance.mobileWidth} onChange={e=>setValue({...value,appearance:{...value.appearance,mobileWidth:Number(e.target.value)}})} aria-invalid={Boolean(mobileWidthValidation)}/>{mobileWidthValidation&&<small className="widget-field-error" role="alert">{mobileWidthValidation}</small>}</label><label>Mobile maximum height (px)<input type="number" min={360} max={900} value={value.appearance.mobileHeight} onChange={e=>setValue({...value,appearance:{...value.appearance,mobileHeight:Number(e.target.value)}})} aria-invalid={Boolean(mobileHeightValidation)}/>{mobileHeightValidation&&<small className="widget-field-error" role="alert">{mobileHeightValidation}</small>}</label></div>
     <div className="widget-fields"><label>Corner radius (px)<input type="number" min={12} max={32} value={value.appearance.cornerRadius} onChange={e=>setValue({...value,appearance:{...value.appearance,cornerRadius:Number(e.target.value)}})} aria-invalid={Boolean(radiusValidation)}/>{radiusValidation&&<small className="widget-field-error" role="alert">{radiusValidation}</small>}</label><label>Launcher size (px)<input type="number" min={48} max={80} value={value.appearance.launcherSize} onChange={e=>setValue({...value,appearance:{...value.appearance,launcherSize:Number(e.target.value)}})} aria-invalid={Boolean(launcherValidation)}/>{launcherValidation&&<small className="widget-field-error" role="alert">{launcherValidation}</small>}</label></div>
    </section>
    <section className="widget-section"><div className="widget-section-heading"><span className="widget-section-icon"><MessageCircle size={17}/></span><div><h2>Chat behavior &amp; suggestions</h2><p>Configured prompts send real messages through the secure widget session.</p></div></div>
     <div className="suggestion-editor">{suggestionValues.map((item,index)=><div className="suggestion-item" key={`${index}-${item}`}><span>{item}</span><button type="button" aria-label={`Remove suggestion ${item}`} onClick={()=>setSuggestions(suggestions.filter((_,i)=>i!==index))}>Remove</button></div>)}<div className="suggestion-add"><input value={suggestionDraft} maxLength={120} onChange={e=>setSuggestionDraft(e.target.value)} placeholder="Add a suggested question" aria-label="New suggested question"/><button type="button" disabled={!suggestionDraft.trim()||suggestionValues.length>=5||suggestionDraft.trim().length>120} onClick={()=>{setSuggestions([...suggestions,suggestionDraft.trim()]);setSuggestionDraft('')}}>Add question</button></div></div>
     <small className="widget-helper">Up to five prompts, 120 characters each. Clicking one in the live widget submits it as a customer message.</small>{suggestionsValidation&&<small className="widget-field-error" role="alert">{suggestionsValidation}</small>}
    </section>
    <section className="widget-section"><div className="widget-section-heading"><span className="widget-section-icon"><ShieldCheck size={17}/></span><div><h2>Authorized websites</h2><p>The backend checks every widget request against these domains.</p></div></div>
     <label>Approved hostnames<textarea rows={4} value={domains} onChange={e=>setDomains(e.target.value)} aria-invalid={Boolean(domainValidation)} aria-describedby="widget-domain-help widget-domain-error" placeholder="shop.example.org\nstore.example.com"/><small id="widget-domain-help">One hostname per line; subdomains are included. Production sites must use HTTPS. Local preview hosts must be explicitly listed.</small></label>
     {domainValidation&&<p className="widget-inline-warning" id="widget-domain-error" role="alert">{domainValidation}</p>}
    </section>
    <div className="widget-actions"><span>{dirty?'You have unsaved widget changes.':'All changes are saved.'}</span><div><button type="button" disabled={!dirty||busy} onClick={()=>{setValue(saved.current);setDomains(saved.current.allowedDomains.join('\n'));setSuggestions(saved.current.appearance.suggestions);setSuggestionDraft('');setNotice('Unsaved edits reset to the saved configuration.')}}><RotateCcw size={16}/> Reset edits</button><button className="primary" type="button" disabled={busy||!dirty||!value.assistantId||Boolean(domainValidation)||appearanceInvalid} onClick={()=>void save()}><Save size={16}/> {busy?'Saving…':'Save settings'}</button></div></div>
    <section className="widget-section installation-section"><div className="widget-section-heading"><span className="widget-section-icon"><Copy size={17}/></span><div><h2>Installation</h2><p>One lightweight script works across the supported website stacks.</p></div></div>
     {value.publicId&&snippet?<div className="widget-snippet"><code>{snippet}</code><button type="button" onClick={()=>void copy()} aria-label="Copy embed snippet"><Copy size={16}/></button></div>:value.publicId?<p className="widget-inline-warning">Widget hosting is not configured or a configured widget API origin is invalid. Set VITE_WIDGET_HOSTING_ORIGIN to the verified HTTPS origin serving /widget.js, and validate VITE_WIDGET_API_ORIGIN if used, before generating a snippet.</p>:<p className="widget-inline-warning">Save the configuration to create a public widget ID and embed snippet.</p>}
     <p className="widget-helper">Paste the script into the site-wide layout before <code>&lt;/body&gt;</code>.</p>
     <details><summary>Platform-specific instructions</summary><div className="platform-instructions">
      <article><strong>Shopify</strong><ol><li>Open Online Store → Themes → Edit code.</li><li>Open <code>layout/theme.liquid</code>.</li><li>Paste the snippet immediately before <code>&lt;/body&gt;</code>, then save.</li></ol><small>Shopify Theme App Embed is not implemented. This theme-code installation is required.</small></article>
      <article><strong>WooCommerce</strong><ol><li>In the WordPress site running WooCommerce, use a trusted site-wide script plugin or child-theme footer.</li><li>Paste the snippet before the closing body tag and publish.</li><li>Confirm the public store hostname is listed under Approved websites.</li></ol><small>No WooCommerce-specific widget plugin is required.</small></article>
      <article><strong>WordPress</strong><ol><li>Use a trusted header/footer script plugin, or add the snippet to the shared footer of a child theme.</li><li>Place the script before the closing body tag, then publish.</li><li>Confirm the public site hostname is listed under Approved websites.</li></ol><small>The Carteio widget does not currently have a dedicated WordPress installation plugin.</small></article>
      <article><strong>Next.js</strong><ol><li>Add the snippet to the shared root layout or site-wide footer.</li><li>Load it after page hydration where required by your script component.</li></ol></article>
      <article><strong>MERN</strong><ol><li>Add the snippet to the shared HTML template or app shell.</li><li>Confirm it runs after the page body exists.</li></ol></article>
      <article><strong>PHP</strong><ol><li>Add the snippet to the shared footer include used by public pages.</li><li>Deploy the updated template.</li></ol></article>
      <article><strong>Static HTML</strong><ol><li>Add the snippet before <code>&lt;/body&gt;</code> on pages or in the shared template.</li><li>Publish on an approved HTTPS hostname.</li></ol></article>
     </div></details>
    </section>
   </section>
   <aside className="widget-preview-wrap">
    <div className="widget-mode-switch" role="tablist" aria-label="Widget preview mode"><button type="button" role="tab" aria-selected={mode==='visual'} className={mode==='visual'?'selected':''} onClick={()=>setMode('visual')}><Globe size={15}/> Visual Preview</button><button type="button" role="tab" aria-selected={mode==='test'} className={mode==='test'?'selected':''} onClick={()=>setMode('test')}><MessageCircle size={15}/> Test AI Chat</button></div>
    {mode==='visual'?<>
     <div className="widget-preview-label"><Globe size={16}/> Live appearance preview <small>Current unsaved settings</small></div>
     <div className="preview-device-switch" role="group" aria-label="Preview device"><button type="button" aria-pressed={previewDevice==='desktop'} className={previewDevice==='desktop'?'selected':''} onClick={()=>setPreviewDevice('desktop')}><Monitor size={15}/> Desktop</button><button type="button" aria-pressed={previewDevice==='mobile'} className={previewDevice==='mobile'?'selected':''} onClick={()=>setPreviewDevice('mobile')}><Smartphone size={15}/> Mobile</button></div>
     <div className={`widget-preview-page ${previewDevice}`}>
      <div className="mock-site-header"><span className="mock-site-logo">STORE</span><span>Catalog　 About　 Help</span></div><span className="preview-bar"/><span className="preview-line wide"/><span className="preview-line"/><span className="preview-block"/><span className="preview-line wide"/>
      {previewOpen?<section className={`preview-chat ${value.appearance.position}`} style={{fontFamily:widgetFont(value.appearance.fontFamily),'--brand':value.appearance.color,'--header-foreground':readableForeground(value.appearance.color),'--user-bubble':value.appearance.userBubbleColor,'--user-bubble-foreground':readableForeground(value.appearance.userBubbleColor),'--widget-width':`${previewDevice==='mobile'?value.appearance.mobileWidth:value.appearance.width}px`,'--widget-height':`${previewDevice==='mobile'?value.appearance.mobileHeight:value.appearance.height}px`,'--widget-radius':`${value.appearance.cornerRadius}px`,'--launcher-size':`${value.appearance.launcherSize}px`} as CSSProperties}>
       <header><PreviewAvatar key={value.appearance.avatarUrl||'default-avatar'} url={value.appearance.avatarUrl}/><span className="preview-identity"><strong>{value.appearance.name||selectedAssistant?.name||'Assistant'}</strong><small>Visual preview · live status appears on the storefront</small></span><span className="preview-controls"><button type="button" onClick={()=>setPreviewOpen(false)} aria-label="Minimize preview">−</button><button type="button" onClick={()=>setPreviewOpen(false)} aria-label="Close preview">×</button></span></header>
       <div className="preview-content"><p>{value.appearance.welcomeMessage||'Hi! How can I help?'}</p><div className="preview-customer-swatch">Customer message color</div>{suggestionValues.map((suggestion,index)=><button type="button" key={`${suggestion}-${index}`} onClick={()=>{setChatInput(suggestion);setMode('test')}}>{suggestion}</button>)}</div>
       <div className="preview-composer"><span>Message…</span><b>↑</b></div>
      </section>:null}
      <button className={`preview-launcher ${value.appearance.position}`} style={{background:value.appearance.color,color:readableForeground(value.appearance.color),width:value.appearance.launcherSize,height:value.appearance.launcherSize}} onClick={()=>setPreviewOpen(true)} aria-label="Open visual preview"><MessageCircle size={23}/></button>
     </div>
    </>:<section className="widget-test-chat" aria-label="Test AI Chat">
     <div className="widget-test-header"><div><strong>Test AI Chat</strong><p>Real responses using this assistant’s assigned Knowledge and currently permitted commerce data.</p></div><button type="button" onClick={resetTestChat} disabled={chatBusy}><RotateCcw size={15}/> New conversation</button></div>
     <label className="widget-test-assistant">Active assistant<select value={testAssistantId} onChange={e=>chooseTestAssistant(e.target.value)} disabled={!activeAssistants.length||chatBusy}>{activeAssistants.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
     <div className="widget-test-messages" aria-live="polite">{chatMessages.length===0&&<p className="widget-test-empty">Ask a real question in English, Hindi, or Hinglish.</p>}{chatMessages.map((message,index)=><article className={`widget-test-message ${message.role}`} key={`${index}-${message.role}`}><span>{message.role==='user'?'You':'Assistant'}</span><p>{message.content}</p>{message.role==='assistant'&&message.sources?.length ? <small>Sources: {message.sources.map(source=>source.title).join(' · ')}</small>:null}</article>)}{chatBusy&&<p className="widget-test-loading" role="status">Assistant is responding…</p>}</div>
     {chatError&&<p className="widget-error" role="alert">{chatError}</p>}
     {!activeAssistants.length?<p className="widget-test-empty">Activate an assistant before testing customer responses.</p>:<form className="widget-test-form" onSubmit={event=>void sendTestMessage(event)}><textarea value={chatInput} onChange={e=>setChatInput(e.target.value)} maxLength={2000} rows={2} placeholder="Ask about a product, policy, or service…" aria-label="Message the assistant" disabled={chatBusy}/><button className="primary" type="submit" disabled={chatBusy||!chatInput.trim()}><Send size={16}/> Send</button></form>}
     <small className="widget-test-note">Uses the authenticated Playground API. Workspace and assistant permissions remain enforced; customer order details remain protected.</small>
    </section>}
    <section className="widget-health-card" aria-label="Connection and setup health"><div className="widget-section-heading"><span className="widget-section-icon"><Activity size={17}/></span><div><h2>Connection diagnostics</h2><p>Live checks from this dashboard session.</p></div></div><div className="health-row"><span><strong>Widget script</strong><small>Stable URL; fetched without cache</small></span><Status value={scriptStatus} label={statusLabel(scriptStatus)}/></div><div className="health-row"><span><strong>API and database readiness</strong><small>Live /ready response</small></span><Status value={apiStatus} label={statusLabel(apiStatus)}/></div><div className="health-row"><span><strong>Saved widget configuration</strong><small>{saved.current.allowedDomains.length} approved domain(s) · {savedAssistant?.status==='active'?'assistant active':saved.current.assistantId?'assistant inactive':'no assistant selected'}</small></span><Status value={saved.current.enabled&&savedAssistant?.status==='active'&&saved.current.allowedDomains.length?'ready':'unavailable'} label={saved.current.enabled&&savedAssistant?.status==='active'&&saved.current.allowedDomains.length?'Configured':'Needs setup'}/></div><div className="health-row"><span><strong>Origin authorization</strong><small>Checked by the backend for each storefront API request.</small></span><Status value="not-checked" label="Not checked"/></div><div className="health-row"><span><strong>Visitor session</strong><small>Requires a successful bootstrap from an approved storefront.</small></span><Status value="not-checked" label="Not checked"/></div><div className="health-row"><span><strong>Chat response</strong><small>Requires a real message request and response in the storefront.</small></span><Status value="not-checked" label="Not checked"/></div><p className="widget-health-note">Dashboard readiness does not establish a visitor session. Verify origin authorization, session creation and message delivery from an approved storefront using the browser Network panel and correlated backend diagnostics.</p></section>
   </aside>
  </div>
 </main>;
}

function Status({value,label}:{value:ServiceStatus;label:string}){const good=value==='available'||value==='ready';return <span className={`health-status ${good?'good':value==='checking'?'pending':value==='not-checked'?'unverified':'bad'}`}>{good?<CheckCircle2 size={14}/>:value==='checking'||value==='not-checked'?<Activity size={14}/>:<XCircle size={14}/>} {label}</span>}
