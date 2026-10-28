(() => {
  'use strict';
  const WIDGET_SCRIPT_VERSION = '16e-20261015-10';

  const mounted = window.__carteioWidgetInstances || (window.__carteioWidgetInstances = new Set());
  const owners = window.__carteioWidgetOwners || (window.__carteioWidgetOwners = new Map());
  const widgetScripts = [...document.querySelectorAll('script[data-widget-id]')];
  const widgetIds = new Set(widgetScripts.map((script) => script.dataset.widgetId).filter(Boolean));
  if (widgetIds.size > 1) {
    for (const widgetId of widgetIds) mounted.add(widgetId);
    document.querySelectorAll('[data-widget-version]').forEach((previousHost) => previousHost.remove());
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.textContent = 'Multiple chat widget embeds were found. Remove duplicate widget scripts and reload.';
    notice.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;padding:12px 14px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;color:#344054;box-shadow:0 4px 16px #10182820;font:13px/1.4 system-ui,sans-serif';
    (document.body || document.documentElement).append(notice);
    console.error('[CARTEIO_WIDGET] Multiple widget IDs found; remove duplicate embed snippets.');
    return;
  }

  for (const script of widgetScripts) {
    const widgetId = script.dataset.widgetId;
    if (!widgetId) continue;
    const previousOwner = owners.get(widgetId);
    if (previousOwner?.version === WIDGET_SCRIPT_VERSION && !previousOwner.embedStale) continue;
    if (previousOwner) previousOwner.host?.remove();
    else if (mounted.has(widgetId)) document.querySelectorAll('[data-widget-version]').forEach((previousHost) => previousHost.remove());
    const owner = { version: WIDGET_SCRIPT_VERSION, host: null };
    owners.set(widgetId, owner);
    mounted.add(widgetId);
    const debugEnabled = script.dataset.widgetDebug === 'true';
    const debugEvent = (stage, operation, requestId, status, details = {}) => {
      if (debugEnabled) console.info('[CARTEIO_WIDGET_DEBUG]', { stage, operation, requestId, status, ...details });
    };

    const scriptUrl = new URL(script.src);
    const configuredApiBase = script.dataset.apiBaseUrl?.trim();
    const apiUrl = configuredApiBase ? new URL(configuredApiBase) : new URL(scriptUrl.origin);
    const isLocalHost = (hostname) => hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]';
    const scriptIsLocal = isLocalHost(scriptUrl.hostname.toLowerCase());
    const apiIsLocal = isLocalHost(apiUrl.hostname.toLowerCase());
    if ((apiUrl.protocol !== 'https:' && !apiIsLocal) || (apiIsLocal && !scriptIsLocal)
      || apiUrl.username || apiUrl.password || apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash) {
      throw new Error('Widget API base URL must be an HTTPS origin (localhost is allowed only for local development).');
    }
    const api = new URL('/api/v1', apiUrl.origin).href.replace(/\/$/, '');
    const apiHostname = apiUrl.hostname.toLowerCase();
    const isNgrokDevelopmentHost = apiHostname === 'ngrok-free.dev' || apiHostname.endsWith('.ngrok-free.dev');
    const widgetFonts = { system: 'ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', inter: 'Inter,ui-sans-serif,sans-serif', arial: 'Arial,Helvetica,sans-serif', georgia: 'Georgia,serif', verdana: 'Verdana,Geneva,sans-serif' };
    let token = '';
    let assistant = {};
    let cursor = '';
    let poller = 0;
    let busy = false;
    let pendingTurn = null;
    let activeController = null;
    let resetPromise = null;
    let historyCursor = null;
    let prior;
    let appearanceReady = false;
    let appearanceFingerprint = '';
    let initializing = false;
    let appearanceLoadGeneration = 0;
    let avatarRenderGeneration = 0;
    let polling = false;

    try {
      prior = JSON.parse(localStorage.getItem(`carteio-widget:${widgetId}`) || 'null');
    } catch {
      prior = null;
    }

    const host = document.createElement('div');
    host.dataset.widgetVersion = WIDGET_SCRIPT_VERSION;
    host.dataset.carteioWidgetHost = widgetId;
    owner.host = host;
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;visibility:hidden';
    (document.body || document.documentElement).append(host);
    const root = host.attachShadow({ mode: 'open' });

    const css = document.createElement('style');
    css.textContent = `
      :host{all:initial;pointer-events:none;font-family:var(--widget-font);color:#182230;font-synthesis:none;text-rendering:optimizeLegibility}
      *,*::before,*::after{box-sizing:border-box}
      button,input{font:inherit;color:inherit;line-height:inherit}
      button{appearance:none;border:0;margin:0;cursor:pointer}
      .launcher{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom,0px));width:var(--launcher-size);height:var(--launcher-size);padding:0;border-radius:50%;display:grid;place-items:center;color:var(--header-foreground);box-shadow:0 6px 18px #1018282b;pointer-events:auto;transition:transform .18s ease,box-shadow .18s ease;background:var(--brand)}
      .launcher:hover{transform:translateY(-2px);box-shadow:0 9px 22px #10182836}.launcher:active{transform:scale(.97)}.launcher:focus-visible,.panel button:focus-visible,.panel input:focus-visible{outline:3px solid #84adff;outline-offset:3px}
      .launcher.right{right:20px}.launcher.left{left:20px}
      .panel{position:fixed;bottom:calc(94px + env(safe-area-inset-bottom,0px));width:min(var(--widget-width),calc(100vw - 28px));height:min(var(--widget-height),calc(100dvh - 120px));min-height:min(360px,calc(100dvh - 120px));background:#fff;border:1px solid #e4e7ec;border-radius:var(--widget-radius);box-shadow:0 18px 52px #1018282b,0 3px 10px #10182812;overflow:hidden;display:flex;flex-direction:column;pointer-events:auto;transform-origin:bottom right;animation:panel-in .18s ease-out}
      .panel.left{left:20px;right:auto;transform-origin:bottom left}.panel.right{right:20px;left:auto}.panel[hidden]{display:none}
      @keyframes panel-in{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
      .head{position:relative;flex:none;min-height:82px;padding:15px 16px;display:flex;align-items:center;gap:12px;color:var(--header-foreground);background-color:var(--brand);background-image:linear-gradient(118deg,color-mix(in srgb,var(--brand),#fff 12%),var(--brand) 56%,color-mix(in srgb,var(--brand),#101828 25%));border-bottom:1px solid #ffffff26}
      .avatar{width:46px;height:46px;flex:none;border:2px solid #ffffff65;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:#ffffff24;color:#fff;box-shadow:0 2px 8px #10182820}.avatar svg{width:24px;height:24px;display:block}.avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%;image-rendering:auto}
      .identity{min-width:0;flex:1}.identity strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px;font-weight:720;letter-spacing:-.015em;line-height:1.25}.identity small{display:flex;align-items:center;gap:7px;margin-top:6px;font-size:11px;font-weight:550;letter-spacing:.01em;opacity:.94}.connection-status i{width:7px;height:7px;flex:none;border-radius:50%;background:#d0d5dd;box-shadow:0 0 0 3px #ffffff20}.connection-status.is-online i{background:#6ce9a6}.connection-status.is-error i{background:#fda29b}
      .head-actions{display:flex;align-items:center;gap:5px}.head .head-action{width:34px;height:34px;flex:none;border:1px solid #ffffff34;border-radius:50%;display:grid;place-items:center;background:#ffffff14;color:var(--header-foreground);transition:background .15s ease,transform .15s ease}.head .head-action:hover{background:#ffffff2b;transform:translateY(-1px)}
      .body{flex:1;min-height:0;overflow:auto;padding:17px 15px 11px;display:flex;flex-direction:column;gap:11px;background:linear-gradient(180deg,#fbfcfe 0%,#fff 34%);scroll-behavior:smooth;overscroll-behavior:contain}
      .day-separator{align-self:center;margin:2px 0;padding:5px 10px;border:1px solid #eaecf0;border-radius:20px;background:#fff;color:#98a2b3;font-size:10px;font-weight:600;letter-spacing:.025em}
      .msg{max-width:88%;align-self:flex-start;padding:12px 14px;border:1px solid #eaecf0;border-radius:17px 17px 17px 6px;background:#fff;color:#344054;font-size:14px;line-height:1.58;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 2px 7px #10182809}
      .msg.customer{align-self:flex-end;border-radius:15px 15px 5px 15px;background:var(--user-bubble);color:var(--user-bubble-foreground)}
      .stamp{display:block;margin-top:6px;font-size:10px;line-height:1.2;opacity:.64}
      .answer-source-indicator{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;max-width:100%;margin-top:5px;color:#667085;font-size:10px;font-weight:550;line-height:1.35;overflow-wrap:anywhere}.answer-source-indicator .source-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;min-width:0}.answer-source-indicator .source-chip+.source-chip::before{content:"·";margin-right:1px;color:#98a2b3}.answer-source-indicator .source-icon{width:12px;height:12px;flex:none;opacity:.72}
      .sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.sources a,.sources .source-label{color:inherit;font-size:11px;text-decoration:underline;text-underline-offset:2px;opacity:.85}.sources .source-label{text-decoration:none;opacity:.7}
      .welcome{max-width:92%;padding:14px 15px;border:1px solid #e6eaf3;border-radius:17px 17px 17px 6px;background:#fff;box-shadow:0 3px 10px #1018280a}.welcome::before{content:"";display:block;width:26px;height:3px;margin:0 0 9px;border-radius:3px;background:var(--brand);opacity:.78}.suggestions{display:flex;flex-wrap:wrap;gap:8px;padding:2px 0 4px}.suggestions button{min-height:36px;padding:8px 12px;border:1px solid #e0e5ef;border-radius:18px;background:#fff;color:#344054;font-size:12px;font-weight:550;line-height:1.3;text-align:left;box-shadow:0 2px 5px #10182808;transition:border-color .15s ease,background .15s ease,transform .15s ease}.suggestions button:hover{border-color:var(--brand);background:#f8faff;transform:translateY(-1px)}
      .load-older{align-self:center;min-height:30px;padding:5px 10px;border:1px solid #e4e7ec;border-radius:16px;background:#fff;color:#667085;font-size:11px;font-weight:600}.load-older[hidden]{display:none}
      .status{flex:none;min-height:18px;margin:0;padding:0 14px 7px;color:#667085;font-size:12px;line-height:1.4}.status:empty{display:none}.status.is-typing{display:flex;align-items:center;gap:8px}.status.is-typing::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--brand);box-shadow:10px 0 var(--brand),20px 0 var(--brand);animation:dots .9s infinite ease-in-out alternate}
      @keyframes dots{to{opacity:.35;transform:translateX(2px)}}
      .composer-footer{z-index:1;flex:none;display:grid;gap:8px;padding:10px 13px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid #eaecf0;background:#fff}.compose{min-width:0;display:flex;align-items:center;gap:9px}.compose input{height:47px;min-width:0;flex:1;padding:0 17px;border:1px solid #e0e4eb;border-radius:25px;outline:none;background:#f9fafb;color:#182230;font-size:14px;transition:border-color .15s ease,box-shadow .15s ease,background .15s ease}.compose input::placeholder{color:#98a2b3}.compose input:focus{border-color:var(--brand);background:#fff;box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 14%,transparent)}
      .send{height:45px;width:45px;min-width:45px;padding:0;border-radius:50%;display:grid;place-items:center;background:var(--brand);color:var(--header-foreground);box-shadow:0 3px 9px color-mix(in srgb,var(--brand) 30%,transparent);transition:filter .15s ease,transform .15s ease}.send:hover{filter:brightness(.94);transform:translateY(-1px)}.send:disabled{opacity:.48;cursor:not-allowed;box-shadow:none}
      .ticket-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ticket-actions button{min-width:0;min-height:38px;padding:7px 9px;border:1px solid color-mix(in srgb,var(--brand) 24%,#e4e7ec);border-radius:11px;background:var(--brand);color:var(--header-foreground);font-size:11px;font-weight:650;line-height:1.25;text-align:center;overflow-wrap:anywhere;transition:filter .15s ease,transform .15s ease}.ticket-actions button:hover{filter:brightness(.95);transform:translateY(-1px)}.ticket-actions button:disabled{opacity:.55;cursor:not-allowed;transform:none}.retry-button{align-self:flex-start;min-height:34px;padding:7px 12px;border:1px solid var(--brand);border-radius:18px;background:#fff;color:var(--brand);font-size:12px;font-weight:650}.error-state{margin:0;padding:0;color:#b42318;font-size:12px;line-height:1.45;overflow-wrap:anywhere}
      .bootstrap-error{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));max-width:min(320px,calc(100vw - 40px));padding:12px 14px;border:1px solid #d0d5dd;border-radius:12px;background:#fff;color:#344054;box-shadow:0 6px 20px #10182820;display:flex;align-items:center;gap:12px;pointer-events:auto;font:13px/1.4 ui-sans-serif,system-ui,sans-serif}.bootstrap-error[hidden]{display:none}.bootstrap-error button{flex:none;padding:7px 10px;border:1px solid #98a2b3;border-radius:8px;background:#f9fafb;color:#344054;font-size:12px;font-weight:600}
      .pending-ticket,.ticket-lookup{display:grid;gap:9px;max-width:94%;padding:12px;border:1px solid #e4e7ec;border-radius:13px;background:#fff;color:#344054;font-size:13px;line-height:1.45}.pending-ticket .summary{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.ticket-lookup p{margin:0;color:#667085;font-size:12px}.ticket-lookup input{width:100%;height:40px;padding:0 10px;border:1px solid #d0d5dd;border-radius:8px;background:#fff}.ticket-card{display:grid;gap:5px;max-width:94%;padding:12px;border-left:3px solid var(--brand);border-radius:5px 11px 11px 5px;background:#f8f9fc;color:#475467;font-size:12px;line-height:1.4}.ticket-card p{margin:2px 0}.ticket-card small{color:#667085}
      @media(max-width:600px){.panel{top:max(10px,env(safe-area-inset-top,0px));bottom:max(10px,env(safe-area-inset-bottom,0px));width:min(var(--mobile-width),calc(100vw - 20px));height:auto;min-height:min(360px,calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 20px));max-height:min(var(--mobile-height),calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 20px));border-radius:var(--widget-radius)}.panel.left{left:10px}.panel.right{right:10px}.launcher{bottom:calc(15px + env(safe-area-inset-bottom,0px))}.launcher.left{left:15px}.launcher.right{right:15px}.head{min-height:68px;padding:11px 13px}.body{padding:12px 10px 8px}.composer-footer{gap:7px;padding:8px 9px calc(8px + env(safe-area-inset-bottom,0px))}.ticket-actions{gap:7px}.ticket-actions button{min-height:40px;padding:6px 7px;font-size:10px}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
    `;
    root.append(css);

    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'launcher right';
    launcher.setAttribute('aria-label', 'Open chat with assistant');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.innerHTML = '<svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg>';

    const panel = document.createElement('section');
    panel.className = 'panel right';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.innerHTML = '<header class="head"><span class="avatar" aria-hidden="true" hidden></span><div class="identity"><strong></strong><small class="connection-status"><i aria-hidden="true"></i><span></span></small></div><div class="head-actions"><button class="head-action minimize" type="button" aria-label="Minimize chat"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 10h12"/></svg></button><button class="head-action close" type="button" aria-label="Close chat"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m5 5 10 10M15 5 5 15"/></svg></button></div></header><div class="body" role="log" aria-live="polite" aria-relevant="additions text"><button class="load-older" type="button" hidden>Load older messages</button><p class="status" role="status"></p></div><div class="composer-footer"><p class="error-state" role="alert" hidden></p><form class="compose"><input aria-label="Message" maxlength="2000" autocomplete="off" placeholder="Message…"><button class="send" type="submit" aria-label="Send message"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2 8.5 11.5M18 2l-6 16-3.5-6.5L2 8l16-6Z"/></svg></button></form><div class="ticket-actions" role="group" aria-label="Ticket actions"><button class="raise-ticket" type="button">Raise a support ticket</button><button class="track-ticket" type="button">Track a ticket</button></div></div>';
    root.append(launcher, panel);
    const bootstrapError = document.createElement('div');
    bootstrapError.className = 'bootstrap-error';
    bootstrapError.setAttribute('role', 'status');
    bootstrapError.hidden = true;
    const bootstrapErrorMessage = document.createElement('span');
    bootstrapErrorMessage.textContent = 'Chat is temporarily unavailable.';
    const bootstrapRetry = document.createElement('button');
    bootstrapRetry.type = 'button';
    bootstrapRetry.textContent = 'Retry';
    bootstrapError.append(bootstrapErrorMessage, bootstrapRetry);
    root.append(bootstrapError);
    debugEvent('W01_widget_script_initialized', 'widget.script.initialize', crypto.randomUUID(), 'success', { version: WIDGET_SCRIPT_VERSION });

    const element = (tag, text) => {
      const node = document.createElement(tag);
      node.textContent = text;
      return node;
    };
    const status = panel.querySelector('.status');
    const body = panel.querySelector('.body');
    const field = panel.querySelector('input');
    const sendButton = panel.querySelector('.send');
    const errorState = panel.querySelector('.error-state');
    const olderButton = panel.querySelector('.load-older');
    const raiseTicketButton = panel.querySelector('.raise-ticket');
    const trackButton = panel.querySelector('.track-ticket');
    raiseTicketButton.disabled = true;
    trackButton.disabled = true;
    const minimizeButton = panel.querySelector('.minimize');
    const closeButton = panel.querySelector('.close');
    const connectionStatus = panel.querySelector('.connection-status');

    function defaultAvatarIcon() {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '1.8');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z');
      icon.append(path);
      return icon;
    }

    function renderAvatar(avatar, avatarUrl) {
      const generation = ++avatarRenderGeneration;
      const fallback = () => {
        if (generation === avatarRenderGeneration) avatar.replaceChildren(defaultAvatarIcon());
      };
      avatar.hidden = false;
      fallback();
      if (!avatarUrl) return Promise.resolve();
      return new Promise((resolve) => {
        const image = document.createElement('img');
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        let settled = false;
        const finish = (loaded) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          image.onload = null;
          image.onerror = null;
          if (generation === avatarRenderGeneration) {
            if (loaded && image.naturalWidth > 0) avatar.replaceChildren(image);
            else fallback();
          }
          resolve();
        };
        const timeout = setTimeout(() => finish(false), 2500);
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.src = avatarUrl;
        if (image.complete) finish(image.naturalWidth > 0);
      });
    }

    function setConnectionStatus(text, state = '') {
      connectionStatus.querySelector('span').textContent = text;
      connectionStatus.classList.toggle('is-online', state === 'online');
      connectionStatus.classList.toggle('is-error', state === 'error');
    }

    function setStatus(text = '', typing = false) {
      status.textContent = text;
      status.classList.toggle('is-typing', typing);
    }

    function setError(error) {
      const statusCode = Number(error?.status || 0);
      const operation = typeof error?.operation === 'string' ? error.operation : 'widget.api.request';
      if (error?.requestId) debugEvent('W10_message_request_received', operation, error.requestId, 'failure', { httpStatus: statusCode || undefined, failureCategory: statusCode ? 'http_response' : 'browser_network_or_cors' });
      const message = "We're having trouble connecting. Please try again.";
      if (!statusCode || statusCode === 401 || statusCode === 403 || statusCode === 410 || statusCode >= 500) setConnectionStatus(statusCode === 401 || statusCode === 410 ? 'Reconnecting' : 'Connection issue', 'error');
      errorState.textContent = message;
      errorState.hidden = false;
      root.querySelector('.retry-button')?.remove();
      const retry = element('button', statusCode === 409 || statusCode === 429 ? 'Retry shortly' : 'Retry');
      retry.type = 'button';
      retry.className = 'retry-button';
      retry.onclick = async () => {
        errorState.hidden = true;
        retry.remove();
        if (statusCode === 401 || statusCode === 410) {
          await initialize();
          if (token && pendingTurn) void sendPending();
        } else if (pendingTurn) {
          void sendPending();
        } else {
          void initialize();
        }
      };
      errorState.after(retry);
    }

    async function call(path, method = 'GET', data, signal, suppliedRequestId) {
      const requestId = suppliedRequestId || crypto.randomUUID();
      const operation = `widget.${method.toLowerCase()}.${path.split('?')[0]}`;
      if (path === '/widgets/bootstrap') debugEvent('W02_bootstrap_request_started', operation, requestId, 'started');
      let response;
      try {
        response = await fetch(api + path, {
          method,
          signal,
          headers: {
            'X-Request-ID': requestId,
            ...(isNgrokDevelopmentHost ? { 'ngrok-skip-browser-warning': 'true' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(data ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(data ? { body: JSON.stringify(data) } : {}),
          credentials: 'omit',
          mode: 'cors',
          cache: 'no-store',
        });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        if (path === '/widgets/bootstrap') debugEvent('W02_bootstrap_request_started', operation, requestId, 'failure', { failureCategory: 'browser_network_or_cors' });
        if (path === '/widgets/session/messages') debugEvent('W10_message_request_received', operation, requestId, 'failure', { failureCategory: 'browser_network_or_cors' });
        throw Object.assign(new Error('Widget network request failed'), { cause, requestId, operation: `widget.${method.toLowerCase()}.${path.split('?')[0]}` });
      }
      const responseRequestId = response.headers.get('x-request-id') || requestId;
      const responseContentType = response.headers.get('content-type') || '';
      const isJsonResponse = /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(responseContentType.trim());
      if (path === '/widgets/bootstrap') debugEvent('W02_bootstrap_request_started', operation, responseRequestId, response.ok ? 'success' : 'failure', { httpStatus: response.status, failureCategory: response.ok ? undefined : 'http_response' });
      if (!isJsonResponse) {
        throw Object.assign(new Error('Widget API returned a non-JSON response'), {
          status: response.status,
          requestId: responseRequestId,
          operation,
          responseContentType,
        });
      }
      if (!response.ok) {
        if (path === '/widgets/session/messages') debugEvent('W14_message_response_delivered', operation, responseRequestId, 'failure', { httpStatus: response.status });
        let payload;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        throw Object.assign(new Error('Widget request failed'), {
          status: response.status,
          code: typeof payload?.code === 'string' ? payload.code : '',
          requestId: typeof payload?.requestId === 'string' ? payload.requestId : responseRequestId,
        });
      }
      try {
        const payload = await response.json();
        if (path === '/widgets/session/messages') debugEvent('W14_message_response_delivered', operation, responseRequestId, 'success', { httpStatus: response.status });
        return payload;
      } catch (cause) {
        throw Object.assign(new Error('Widget API returned an invalid response'), { status: response.status, requestId: responseRequestId, cause });
      }
    }

    function append(message, older = false) {
      if (root.querySelector(`[data-mid="${CSS.escape(message.id)}"]`)) return;
      const messageDate = new Date(message.createdAt);
      const dayKey = messageDate.toDateString();
      if (!root.querySelector(`[data-day="${CSS.escape(dayKey)}"]`)) {
        const separator = element('div', messageDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: messageDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }));
        separator.className = 'day-separator';
        separator.dataset.day = dayKey;
        const firstMessage = older ? [...body.querySelectorAll('.msg')].find((node) => node.dataset.mid !== 'widget-welcome') : null;
        body.insertBefore(separator, firstMessage || status);
      }
      const card = document.createElement('article');
      card.className = `msg${message.sender === 'customer' ? ' customer' : ''}`;
      card.dataset.mid = message.id;
      card.dataset.created = message.createdAt;
      card.append(element('span', message.content));
      const stamp = element('small', `${message.sender === 'assistant' ? assistant.name : message.sender === 'business' ? 'Business team' : message.sender === 'system' ? 'Ticket update' : 'You'} · ${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      stamp.className = 'stamp';
      card.append(stamp);
      if (message.sender !== 'customer' && message.sourceIndicator && typeof message.sourceIndicator === 'object') {
        const indicator = message.sourceIndicator;
        const sourceLabels = { SHOPIFY: ['Shopify data', '▣'], KNOWLEDGE_BASE: ['Knowledge Base', '▤'], WEBSITE: ['Website', '↗'] };
        const isAI = indicator.generationType === 'AI_GENERATED';
        const isSystem = indicator.generationType === 'SYSTEM_GENERATED';
        const evidenceSources = Array.isArray(indicator.evidenceSources) ? indicator.evidenceSources.filter((source) => Object.hasOwn(sourceLabels, source)) : [];
        if (isAI || isSystem) {
          const line = document.createElement('div');
          line.className = 'answer-source-indicator';
          line.setAttribute('aria-label', 'Answer source');
          const labels = isSystem ? [['System response', '◇']] : [['AI generated', '✦'], ...evidenceSources.map((source) => sourceLabels[source])];
          for (const [label, icon] of labels) {
            const chip = document.createElement('span');
            chip.className = 'source-chip';
            chip.append(element('span', icon));
            chip.lastChild.className = 'source-icon';
            chip.lastChild.setAttribute('aria-hidden', 'true');
            chip.append(element('span', label));
            line.append(chip);
          }
          card.append(line);
        }
      }
      if (message.sender === 'assistant' && Array.isArray(message.sources) && message.sources.length) {
        const sourceList = document.createElement('div');
        sourceList.className = 'sources';
        for (const source of message.sources) {
          const sourceUrl = safeSourceUrl(source.locator);
          const link = document.createElement(sourceUrl ? 'a' : 'span');
          link.textContent = source.title || 'Source';
          if (sourceUrl) {
            link.href = sourceUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          } else {
            link.className = 'source-label';
          }
          sourceList.append(link);
        }
        card.append(sourceList);
      }
      if (older) {
        const firstMessage = [...body.querySelectorAll('.msg')].find((node) => node.dataset.mid !== 'widget-welcome');
        body.insertBefore(card, firstMessage || status);
      } else {
        body.insertBefore(card, status);
        body.scrollTop = body.scrollHeight;
      }
    }

    function safeSourceUrl(value) {
      if (typeof value !== 'string') return '';
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
      } catch {
        return '';
      }
    }

    function showWelcome() {
      if (root.querySelector('[data-mid="widget-welcome"]')) return;
      const card = document.createElement('article');
      card.className = 'msg welcome';
      card.dataset.mid = 'widget-welcome';
      card.append(element('span', assistant.welcomeMessage));
      body.insertBefore(card, olderButton.nextSibling);
      const questions = Array.isArray(assistant.suggestions) ? assistant.suggestions : [];
      if (questions.length) {
        const group = document.createElement('div');
        group.className = 'suggestions assistant-suggestions';
        group.setAttribute('aria-label', 'Suggested questions');
        for (const question of questions) {
          const button = element('button', question);
          button.type = 'button';
          button.onclick = () => {
            group.remove();
            field.value = question;
            field.form.requestSubmit();
          };
          group.append(button);
        }
        body.insertBefore(group, status);
      }
    }

    function showTicket(ticket) {
      root.querySelector('.ticket-card')?.remove();
      const card = document.createElement('article');
      card.className = 'ticket-card';
      card.setAttribute('aria-label', 'Ticket status and expiry');
      card.append(element('strong', `${ticket.reference} · ${ticket.status}`));
      card.append(element('p', ticket.title || 'Customer support ticket'));
      card.append(element('small', `Created ${new Date(ticket.createdAt).toLocaleString()}`));
      card.append(element('small', `Ticket tracking expires ${new Date(ticket.expiresAt).toLocaleString()} (72 hours after creation).`));
      if (ticket.status === 'CLOSED') card.append(element('small', 'This ticket is closed. Owner replies require reopening before expiry.'));
      for (const event of ticket.timeline || []) card.append(element('small', `${event.from} → ${event.to} · ${new Date(event.createdAt).toLocaleString()}`));
      body.insertBefore(card, status);
      body.scrollTop = body.scrollHeight;
    }

    function clearExpiredUi() {
      clearInterval(poller);
      poller = 0;
      activeController?.abort();
      prior = null;
      token = '';
      raiseTicketButton.disabled = true;
      trackButton.disabled = true;
      cursor = '';
      historyCursor = null;
      pendingTurn = null;
      try { localStorage.removeItem(`carteio-widget:${widgetId}`); } catch { /* Storage is optional; the current session can still restart. */ }
      body.querySelectorAll('.msg:not([data-mid="widget-welcome"]),.pending-ticket,.ticket-card,.ticket-lookup,.assistant-suggestions,.retry-button').forEach((node) => node.remove());
      olderButton.hidden = true;
      errorState.hidden = true;
      setStatus('This chat expired. Starting a fresh conversation…');
    }

    async function resetExpiredChat() {
      if (resetPromise) return resetPromise;
      resetPromise = (async () => {
        clearExpiredUi();
        await initialize();
        setStatus('Your previous chat expired. This is a new conversation.');
      })().finally(() => { resetPromise = null; });
      return resetPromise;
    }

    function validateAppearance(data) {
      const candidate = data && typeof data === 'object' && data.assistant && typeof data.assistant === 'object' ? data.assistant : null;
      const integerInRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
      const validAvatar = candidate?.avatarUrl === null || (typeof candidate?.avatarUrl === 'string' && (() => { try { const url = new URL(candidate.avatarUrl); return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.href.length <= 2048; } catch { return false; } })());
      if (!candidate || typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 80
        || typeof candidate.welcomeMessage !== 'string' || !candidate.welcomeMessage.trim() || candidate.welcomeMessage.length > 500
        || !/^#[0-9a-f]{6}$/i.test(candidate.color) || !/^#[0-9a-f]{6}$/i.test(candidate.userBubbleColor)
        || !['left', 'right'].includes(candidate.position) || !['small', 'medium', 'large', 'custom'].includes(candidate.desktopSize)
        || !['system', 'inter', 'arial', 'georgia', 'verdana'].includes(candidate.fontFamily)
        || !integerInRange(candidate.width, 320, 560) || !integerInRange(candidate.height, 420, 900)
        || !integerInRange(candidate.mobileWidth, 280, 600) || !integerInRange(candidate.mobileHeight, 360, 900)
        || !integerInRange(candidate.cornerRadius, 12, 32) || !integerInRange(candidate.launcherSize, 48, 80)
        || !validAvatar || !Array.isArray(candidate.suggestions) || candidate.suggestions.length > 5
        || candidate.suggestions.some((item) => typeof item !== 'string' || !item.trim() || item.length > 120)) {
        throw new Error('Widget appearance response is incomplete or invalid');
      }
      return { ...candidate, name: candidate.name.trim(), welcomeMessage: candidate.welcomeMessage.trim() };
    }

    async function decorate(data) {
      const nextAssistant = validateAppearance(data);
      const nextFingerprint = JSON.stringify(nextAssistant);
      if (appearanceReady && nextFingerprint === appearanceFingerprint) return;
      assistant = nextAssistant;
      appearanceFingerprint = nextFingerprint;
      const brand = assistant.color;
      const hex = brand.slice(1);
      const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      const foreground = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.42 ? '#182230' : '#ffffff';
      const bubble = assistant.userBubbleColor;
      const bubbleChannels = [0, 2, 4].map((offset) => parseInt(bubble.slice(offset + 1, offset + 3), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      const bubbleForeground = bubbleChannels[0] * 0.2126 + bubbleChannels[1] * 0.7152 + bubbleChannels[2] * 0.0722 > 0.42 ? '#182230' : '#ffffff';
      panel.style.setProperty('--brand', brand);
      panel.style.setProperty('--header-foreground', foreground);
      panel.style.setProperty('--user-bubble', bubble);
      panel.style.setProperty('--user-bubble-foreground', bubbleForeground);
      panel.style.setProperty('--widget-width', `${assistant.width}px`);
      panel.style.setProperty('--widget-height', `${assistant.height}px`);
      panel.style.setProperty('--mobile-width', `${assistant.mobileWidth}px`);
      panel.style.setProperty('--mobile-height', `${assistant.mobileHeight}px`);
      panel.style.setProperty('--widget-radius', `${assistant.cornerRadius}px`);
      host.style.setProperty('--widget-font', widgetFonts[assistant.fontFamily]);
      launcher.style.setProperty('--brand', brand);
      launcher.style.setProperty('--launcher-size', `${assistant.launcherSize}px`);
      launcher.style.color = foreground;
      panel.querySelector('.identity strong').textContent = assistant.name;
      panel.setAttribute('aria-label', `Chat with ${assistant.name}`);
      launcher.setAttribute('aria-label', `Open chat with ${assistant.name}`);
      panel.querySelector('.head').style.backgroundColor = brand;
      const avatar = panel.querySelector('.avatar');
      const position = assistant.position === 'left' ? 'left' : 'right';
      launcher.classList.toggle('left', position === 'left');
      launcher.classList.toggle('right', position === 'right');
      panel.classList.toggle('left', position === 'left');
      panel.classList.toggle('right', position === 'right');
      appearanceReady = true;
      await renderAvatar(avatar, assistant.avatarUrl);
    }

    async function loadAppearance() {
      const generation = ++appearanceLoadGeneration;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const config = await call(`/widgets/configuration?widgetId=${encodeURIComponent(widgetId)}`, 'GET', undefined, controller.signal);
        if (generation !== appearanceLoadGeneration || owners.get(widgetId) !== owner) return;
        await decorate(config);
        showWelcome();
        setConnectionStatus('Ready');
        bootstrapError.hidden = true;
        launcher.hidden = false;
        host.style.visibility = 'visible';
      } catch (error) {
        if (generation !== appearanceLoadGeneration || owners.get(widgetId) !== owner) return;
        debugEvent('W02_appearance_request_failed', 'widget.configuration.public', error?.requestId, 'failure', { httpStatus: error?.status || undefined, failureCategory: error?.status ? 'http_response' : 'configuration_unavailable' });
        // Fail closed. An unapproved Origin may be hidden by browser CORS, so it
        // can look like a network error instead of an observable 403 here.
        appearanceLoadGeneration += 1;
        host.remove();
        owner.host = null;
      } finally {
        clearTimeout(timeout);
      }
    }

    async function initialize() {
      if (initializing || !appearanceReady) return;
      initializing = true;
      const bootstrapRequestId = crypto.randomUUID();
      const controller = new AbortController();
      const bootstrapTimeout = setTimeout(() => controller.abort(), 12000);
      try {
        const boot = await call('/widgets/bootstrap', 'POST', { widgetId, ...(prior?.resumeToken ? { resumeToken: prior.resumeToken } : {}) }, controller.signal, bootstrapRequestId);
        clearTimeout(bootstrapTimeout);
        if (!boot || typeof boot.accessToken !== 'string' || !/^[A-Za-z0-9_.-]{40,2048}$/.test(boot.accessToken)
          || typeof boot.resumeToken !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(boot.resumeToken)
          || !Number.isInteger(boot.expiresIn) || boot.expiresIn < 1) {
          throw Object.assign(new Error('Widget session response is invalid'), { status: 502, operation: 'widget.session.bootstrap' });
        }
        token = boot.accessToken;
        raiseTicketButton.disabled = false;
        trackButton.disabled = false;
        prior = { resumeToken: boot.resumeToken };
        try { localStorage.setItem(`carteio-widget:${widgetId}`, JSON.stringify(prior)); } catch { /* Resume persistence is optional when browser storage is blocked. */ }
        if (owners.get(widgetId) !== owner) return;
        bootstrapError.hidden = true;
        setConnectionStatus('Connected', 'online');
        if (!panel.hidden) setStatus('Connecting securely…');
        const history = await call('/widgets/session/history?limit=30');
        if (history.items.length) {
          root.querySelector('[data-mid="widget-welcome"]')?.remove();
          root.querySelector('.assistant-suggestions')?.remove();
        }
        for (const message of history.items) append(message);
        historyCursor = history.nextCursor;
        olderButton.hidden = !history.hasMore;
        setStatus('');
        await poll();
        clearInterval(poller);
        poller = panel.hidden ? 0 : setInterval(() => void poll(), 10000);
      } catch (error) {
        clearTimeout(bootstrapTimeout);
        if ((error.status === 401 || error.status === 410) && prior?.resumeToken) {
          clearExpiredUi();
          setTimeout(() => void initialize(), 0);
          return;
        }
        if (token && !body.querySelector('.msg:not([data-mid="widget-welcome"])') && !root.querySelector('[data-mid="widget-welcome"]')) showWelcome();
        setStatus('');
        setError(error);
      } finally {
        initializing = false;
      }
    }

    async function loadOlder() {
      if (!historyCursor) return;
      olderButton.disabled = true;
      try {
        const page = await call(`/widgets/session/history?limit=30&before=${encodeURIComponent(historyCursor)}`);
        const scrollHeight = body.scrollHeight;
        for (const message of page.items) append(message, true);
        historyCursor = page.nextCursor;
        olderButton.hidden = !page.hasMore;
        body.scrollTop = body.scrollHeight - scrollHeight;
      } catch (error) {
        if (error.status === 410) void resetExpiredChat();
        else setError(error);
      } finally {
        olderButton.disabled = false;
      }
    }

    async function poll() {
      if (!token || polling) return;
      polling = true;
      try {
        const data = await call(`/widgets/session/deliveries${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`);
        setConnectionStatus('Connected', 'online');
        for (const message of data.items) append(message);
        cursor = data.nextCursor || cursor;
        const businessMessageIds = data.items.filter((message) => message.sender === 'business').map((message) => message.id);
        if (businessMessageIds.length) await call('/widgets/session/deliveries/ack', 'POST', { messageIds: businessMessageIds });
        if (data.items.length) errorState.hidden = true;
      } catch (error) {
        if (error.status === 410) {
          void resetExpiredChat();
          return;
        }
        if (error.status === 401) {
          await initialize();
          return;
        }
        setError(error);
      } finally {
        polling = false;
      }
    }

    function showTicketLookup() {
      let box = root.querySelector('.ticket-lookup');
      if (box) {
        box.remove();
        return;
      }
      box = document.createElement('section');
      box.className = 'ticket-lookup';
      box.setAttribute('aria-label', 'Session-scoped ticket status');
      box.append(element('p', 'Check a ticket created in this chat.'));
      const reference = document.createElement('input');
      reference.maxLength = 14;
      reference.placeholder = 'Ticket reference';
      reference.setAttribute('aria-label', 'Ticket reference');
      const result = element('p', '');
      result.setAttribute('role', 'status');
      const submit = element('button', 'View ticket status');
      submit.type = 'button';
      submit.className = 'retry-button';
      submit.onclick = async () => {
        submit.disabled = true;
        try {
          showTicket(await call('/widgets/session/tickets/status', 'POST', { reference: reference.value }));
          result.textContent = 'Ticket status loaded.';
          errorState.hidden = true;
        } catch (error) {
          if (error.status === 410) void resetExpiredChat();
          else {
            result.textContent = error.status === 404 ? 'Ticket is unknown, expired, or belongs to another chat.' : 'Could not load ticket status.';
            if (error.requestId) result.textContent += ` Reference: ${error.requestId}`;
          }
        } finally {
          submit.disabled = false;
        }
      };
      box.append(reference, submit, result);
      body.insertBefore(box, status);
      reference.focus();
    }

    async function showPendingTicket(pending) {
      root.querySelector('.pending-ticket')?.remove();
      const box = document.createElement('section');
      box.className = 'pending-ticket';
      const summary = element('p', `${pending.title}\n${pending.description}\nCategory: ${pending.category}\nPriority: ${pending.priority}`);
      summary.className = 'summary';
      summary.setAttribute('aria-label', 'Pending ticket summary');
      const confirm = element('button', 'Confirm ticket');
      confirm.type = 'button';
      confirm.className = 'retry-button';
      const cancel = element('button', 'Cancel request');
      cancel.type = 'button';
      cancel.className = 'retry-button';
      confirm.onclick = async () => {
        confirm.disabled = true;
        try {
          const done = await call(`/widgets/session/tickets/${encodeURIComponent(pending.id)}/confirm`, 'POST', { action: 'CONFIRM_TICKET_DRAFT', version: pending.version });
          append(done.message);
          showTicket(done.ticket);
          confirm.textContent = 'Ticket confirmed';
          cancel.disabled = true;
          errorState.hidden = true;
        } catch (error) {
          setError(error);
          confirm.disabled = false;
        }
      };
      cancel.onclick = async () => {
        cancel.disabled = true;
        try {
          const done = await call(`/widgets/session/tickets/${encodeURIComponent(pending.id)}/cancel`, 'POST');
          append(done.message);
          confirm.disabled = true;
          cancel.textContent = done.cancelled ? 'Request cancelled' : 'No active request';
          errorState.hidden = true;
        } catch (error) {
          setError(error);
          cancel.disabled = false;
        }
      };
      box.append(summary, confirm, cancel);
      body.insertBefore(box, status);
      body.scrollTop = body.scrollHeight;
    }

    async function sendPending() {
      if (!pendingTurn || busy) return;
      busy = true;
      sendButton.disabled = true;
      field.disabled = true;
      body.querySelectorAll('.assistant-suggestions button').forEach((button) => { button.disabled = true; });
      activeController = new AbortController();
      setStatus('Assistant is responding', true);
      errorState.hidden = true;
      let expired = false;
      try {
        const result = await call('/widgets/session/messages', 'POST', pendingTurn, activeController.signal);
        append({ ...result.message, sources: result.sources });
        pendingTurn = null;
        if (result.pendingTicket) await showPendingTicket(result.pendingTicket);
        setStatus('');
      } catch (error) {
        if (error.status === 410) expired = true;
        else if (error.name !== 'AbortError') setError(error);
        setStatus('');
      } finally {
        const wasAborted = activeController?.signal.aborted;
        busy = false;
        activeController = null;
        field.disabled = false;
        sendButton.disabled = !field.value.trim();
        body.querySelectorAll('.assistant-suggestions button').forEach((button) => { button.disabled = false; });
        if (expired) {
          void resetExpiredChat();
          return;
        }
        if (wasAborted && pendingTurn && !panel.hidden) setTimeout(() => void sendPending(), 0);
      }
    }

    olderButton.onclick = () => void loadOlder();
    raiseTicketButton.onclick = () => {
      if (busy || pendingTurn) return;
      field.value = 'I would like to raise a support ticket.';
      field.form.requestSubmit();
    };
    trackButton.onclick = showTicketLookup;
    launcher.onclick = () => {
      panel.hidden = !panel.hidden;
      launcher.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) {
        if (!token) void initialize().then(() => { if (token && pendingTurn) void sendPending(); });
        else {
          void poll();
          clearInterval(poller);
          poller = setInterval(() => void poll(), 10000);
          if (pendingTurn) void sendPending();
        }
        field.focus();
      } else {
        clearInterval(poller);
        poller = 0;
        activeController?.abort();
        launcher.focus();
      }
    };
    launcher.hidden = true;
    bootstrapRetry.onclick = () => {
      bootstrapError.hidden = true;
      if (appearanceReady) void initialize();
      else void loadAppearance();
    };
    const hidePanel = () => {
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      clearInterval(poller);
      poller = 0;
      activeController?.abort();
      launcher.focus();
    };
    minimizeButton.onclick = hidePanel;
    closeButton.onclick = hidePanel;
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        panel.hidden = true;
        launcher.setAttribute('aria-expanded', 'false');
        clearInterval(poller);
        poller = 0;
        activeController?.abort();
        launcher.focus();
      }
    });
    panel.querySelector('.compose').onsubmit = async (event) => {
      event.preventDefault();
      const content = field.value.trim();
      if (!content || busy || pendingTurn) return;
      pendingTurn = { content, idempotencyKey: crypto.randomUUID() };
      root.querySelector('.assistant-suggestions')?.remove();
      append({ id: pendingTurn.idempotencyKey, sender: 'customer', content, createdAt: new Date() });
      field.value = '';
      sendButton.disabled = true;
      await sendPending();
    };
    field.addEventListener('input', () => { sendButton.disabled = busy || !field.value.trim(); });
    void loadAppearance();
  }
})();
