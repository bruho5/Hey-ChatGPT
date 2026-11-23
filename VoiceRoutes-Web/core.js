export function chatUrl(raw) {
  const u = new URL(raw.trim());
  if (u.origin !== 'https://chatgpt.com' || u.username || u.password) throw new Error('请填 chatgpt.com 的私有会话地址。');
  if (!/^\/(?:g\/[a-z0-9-]+\/)?c\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/?$/i.test(u.pathname)) {
    throw new Error('地址必须是现有会话，不是首页、分享页或项目首页。');
  }
  return u.origin + u.pathname.replace(/\/$/, '');
}
const ignored = /^[\s，、。；：！？,.!?;:]+/u;
const normalize = s => s.normalize('NFKC').toLowerCase().replace(/[\s，、。；：！？,.!?;:]+/gu, '');
export const isSendCommand = s => normalize(s) === '莫发送';
export function checkRoutes(rows) {
  const seen = new Set();
  return rows.map(({phrase, type, url}) => {
    phrase = phrase.trim();
    const key = normalize(phrase);
    if (key.length < 3 || phrase.length > 80) throw new Error('口令请用 3 至 80 个字符。');
    if (isSendCommand(phrase)) throw new Error('「莫，发送」是保留口令。');
    if (seen.has(key)) throw new Error('请不要设置相同口令。');
    seen.add(key);
    if (!['chat','note'].includes(type)) throw new Error('不认识这个目的地。');
    return {phrase,type,url: type === 'chat' ? chatUrl(url) : ''};
  });
}
export function matchRoute(input, routes) {
  const raw = input.trim();
  const options = routes.map(route => ({route,key:normalize(route.phrase)})).sort((a,b)=>b.key.length-a.key.length);
  for (const {route,key} of options) {
    let end = 0;
    let prefix = '';
    for (const char of raw) {
      end += char.length;
      prefix += normalize(char);
      if (!key.startsWith(prefix)) break;
      if (prefix !== key) continue;
      const remainder = raw.slice(end);
      if (/[a-z0-9]$/i.test(key) && /^[a-z0-9]/i.test(remainder)) break;
      return {route,body:remainder.replace(ignored,'').trim()};
    }
  }
  return null;
}
export function capture(input, routes, pending, now) {
  const clean = input.trim();
  const match = matchRoute(clean, routes);
  if (match?.body) return {action:match};
  if (match) return {pending:{route:match.route, until:now+8000}};
  if (!pending || pending.until < now) return {};
  if (/^[\s，、。；：！？,.!?;:]*(取消|cancel)[\s，、。；：！？,.!?;:]*$/i.test(clean)) return {};
  if (clean) return {action:{route:pending.route,body:clean}};
  return {pending};
}
// Draft fill does not read messages; send verifies only the new user message.
export function fillDraft(expected, content, ticket, mode = 'fill') {
  const isOfficial=mode==='send-official';
  const isSend=mode==='send' || isOfficial;
  const key='__voiceRoutesDraft013';
  const official=isOfficial ? globalThis.__voiceRoutesOfficialDictation : null;
  const proof=isOfficial ? official?.draft : isSend ? globalThis[key] : null;
  const owned=typeof ticket==='string' && ticket && proof?.ticket===ticket &&
    (isOfficial ? proof.expected : proof.url)===expected ? proof : null;
  const consume=()=>{
    if(!owned)return;
    if(isOfficial && official.draft===owned)delete official.draft;
    owned.dispose();
  };
  const fail=(state,reason)=>{consume();return {state,reason};};
  const exact=()=>location.origin+location.pathname.replace(/\/$/,'')===expected;
  const exactSendPage=()=>exact() && (!isOfficial || (owned.doc===document && owned.href===location.href));
  if (!exact()) {consume();return {state:'wrong'};}
  if (isSend && !owned) return {state:'stale',reason:'no-proof'};
  if (isOfficial && !exactSendPage()) return fail('stale','page-changed');
  const direct = '[data-composer-markdown][contenteditable="true"][role="textbox"], #prompt-textarea[contenteditable="true"], textarea#prompt-textarea, [data-testid="prompt-textarea"][contenteditable="true"], textarea[data-testid="prompt-textarea"]';
  const ready = el => el && el.getClientRects().length && !el.disabled && !el.readOnly &&
    el.getAttribute?.('aria-disabled') !== 'true' && !el.closest('[inert]');
  const primary = [...document.querySelectorAll(direct)];
  let pool = primary.filter(ready);
  if (!pool.length) {
    const composers = [...document.querySelectorAll('form[data-type="unified-composer"], [data-testid="composer"]')];
    pool = [...new Set(composers.flatMap(form => {
      if (!form.querySelector('[data-testid="send-button"], button#composer-submit-button, [data-testid="stop-button"]')) return [];
      return [...form.querySelectorAll('.ProseMirror[contenteditable="true"], textarea')].filter(ready);
    }))];
  }
  if (pool.length !== 1) return isSend ? fail('stale','composer-structure') : {state:'waiting',reason:primary.length ? 'not-ready' : 'no-composer'};
  const [editor] = pool;
  const getForm = el => el.closest('form, [data-testid="composer"]') ?? el.closest('fieldset');
  const form = getForm(editor);
  const attachmentSelector='[data-testid="remove-attachment-button"], button[aria-label^="Remove attachment"], button[aria-label^="移除附件"]';
  const busySelector='[data-testid="stop-button"], button[data-testid="stop-generating-button"]';
  const blocked=form?.querySelector(attachmentSelector) ? 'attachment' : form?.querySelector(busySelector) ? 'busy' : null;
  if(blocked) return isSend ? fail('occupied',blocked) : {state:'occupied'};
  const norm = s => s.replace(/\r\n/g,'\n').replace(/\u00a0/g,' ').trim();
  const domText = n => n.nodeName === 'BR' ? (n.classList.contains('ProseMirror-trailingBreak') ? '' : '\n')
    : n.nodeType===3 ? n.nodeValue : [...n.childNodes].map(domText).join('');
  const read = el => {
    const nodes=[...(el.childNodes ?? [])];
    const lines=nodes.length && nodes.every(n=>n.nodeName==='P') ? nodes.map(domText).join('\n') : null;
    return norm(el.value ?? lines ?? el.innerText ?? el.textContent ?? '');
  };
  if(isSend){
    if(!form || !editor.isConnected) return fail('stale','composer-structure');
    if(editor.querySelector('img, [contenteditable="false"]')) return fail('occupied','attachment');
    const expectedText=read(editor);
    if(!expectedText.replace(/\u200b/g,'').trim()) return fail('stale','draft-empty');
    if(isOfficial){
      const recorder=[...document.querySelectorAll('button[data-dictation-button="dictating"]')]
        .some(b=>b.getClientRects().length && !b.closest('[hidden],[inert]'));
      if(official.recording || official.settling || recorder) return fail('occupied','recorder');
      if(owned.editor!==editor && typeof owned.matchesEditor!=='function') return fail('stale','composer-structure');
      const matches=typeof owned.matchesEditor==='function' ? owned.matchesEditor(editor) :
        !owned.hasChanges() && owned.snapshot===JSON.stringify([editor.value??null,editor.innerText??null,editor.textContent??null,editor.innerHTML??null]);
      if(!matches)return fail('stale','draft-changed');
    } else {
      if(owned.editor!==editor)return fail('stale','composer-structure');
      const dirty=owned.dirty || owned.observer.takeRecords().length;
      if(dirty || expectedText!==owned.text || owned.text!==norm(content))return fail('stale','draft-changed');
    }
    const sendLabel=/^(send(?: (?:message|prompt))?|发送(?:消息|提示|提示词)?|傳送(?:訊息)?)$/i;
    const markers='button[data-testid="send-button"], button#composer-submit-button, button[aria-label]';
    const marker=b=>{
      const label=(b.getAttribute('aria-label') ?? '').trim();
      // The composer submit id is shared with voice controls. It cannot prove a Send action.
      return label ? sendLabel.test(label) : b.getAttribute('data-testid')==='send-button';
    };
    const candidates=[...form.querySelectorAll(markers)].filter(b=>getForm(b)===form && marker(b));
    const visible=b=>b.getClientRects().length && !b.closest('[hidden],[inert]');
    const rendered=candidates.filter(visible);
    const trailing=rendered.filter(b=>b.closest('[data-composer-trailing-controls]'));
    const buttons=trailing.length ? trailing : rendered;
    if(!candidates.length)return fail('no-send-button','not-found');
    if(buttons.length>1)return fail('no-send-button','ambiguous');
    if(!buttons.length || !ready(buttons[0]) || buttons[0].matches?.(':disabled') ||
      buttons[0].getAttribute('aria-busy')==='true' ||
      (buttons[0].hasAttribute?.('form') && buttons[0].form!==form)) return fail('no-send-button','disabled');
    if(!exactSendPage())return fail('stale','page-changed');
    consume(); // Single use, including an uncertain click; never retry.
    const userNodes=()=>[...document.querySelectorAll('[data-message-author-role="user"]')];
    const msgId=n=>n.closest('[data-message-id]')?.getAttribute('data-message-id');
    const ids=userNodes().map(msgId);
    const previous=new Set(ids);
    buttons[0].click();
    return new Promise(resolve=>{
      const confirmed=()=>{
        if(!exactSendPage() || ids.some(id=>!id) || read(editor)!=='') return false;
        const n=userNodes().at(-1);
        const id=n && msgId(n);
        return !!id && !previous.has(id) && [n,...n.querySelectorAll('[data-message-content], .whitespace-pre-wrap, .markdown')].some(el=>read(el)===expectedText);
      };
      let timer;
      const finish=state=>{clearTimeout(timer);observer.disconnect();resolve({state});};
      const observer=new MutationObserver(()=>{if(confirmed()) finish('sent');});
      observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
      timer=setTimeout(()=>finish(confirmed()?'sent':'send-uncertain'),7000);
      if(confirmed()) finish('sent');
    });
  }
  if ((editor.value ?? editor.textContent ?? '').replace(/[\s\u200b\u00a0]/g, '') || editor.querySelector('img, [contenteditable="false"]')) return {state:'occupied'};
  if (location.origin + location.pathname.replace(/\/$/, '') !== expected) return {state:'wrong'};
  if (editor.tagName === 'TEXTAREA') {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setValue) return {state:'uncertain'};
    setValue.call(editor, content);
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:content}));
  } else {
    // Hand the editor plain text without activating the tab or using the OS clipboard.
    const data = new DataTransfer();
    data.setData('text/plain',content);
    editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  }

  const displayed=read(editor);
  if(displayed!==norm(content)) return {state:'uncertain'};
  if(ticket){
    globalThis[key]?.dispose();
    const d={ticket,url:expected,editor,text:displayed,dirty:false};
    const events=['beforeinput','input','paste','cut','drop','compositionstart'];
    const mark=()=>{d.dirty=true;};
    d.observer=new MutationObserver(mark);
    d.observer.observe(editor,{childList:true,subtree:true,characterData:true});
    for(const name of events) editor.addEventListener(name,mark,true);
    d.dispose=()=>{
      clearTimeout(d.timer);
      d.observer.disconnect();
      for(const name of events) editor.removeEventListener(name,mark,true);
      if(globalThis[key]===d) delete globalThis[key];
    };
    d.timer=setTimeout(d.dispose,120000);
    globalThis[key]=d;
  }
  return {state:'filled'};
}
