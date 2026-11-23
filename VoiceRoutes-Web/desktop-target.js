// All Chrome operations are constrained to an explicitly configured chat; the
// injected ready check never changes the page or returns its contents.
import {chatUrl} from './core.js';

export const targets={
  opening:'正在打开目标会话…',
  redirect:'目标会话跳转了，请检查登录状态和会话地址。',
  timeout:'目标会话没有及时加载听写按钮。',
  create:'无法打开目标会话，请检查 Chrome 是否有普通窗口。',
  duplicate:'同一会话开了多个标签页，请只保留一个。'
};

function normalize(url){
  try{return chatUrl(url);}catch{return null;}
}

// This function is serialized into Chrome's isolated world; no closure.
export function dictationReady(expected) {
  if(location.origin+location.pathname.replace(/\/$/,'')!==expected)return 'redirect';
  const visible=e=>!!e?.getClientRects().length && !e.closest('[hidden],[inert]');
  const composers=[...document.querySelectorAll('[data-composer-markdown][contenteditable="true"], #prompt-textarea')].filter(visible);
  const buttons=[...document.querySelectorAll('[data-composer-trailing-controls] button[data-dictation-button]')].filter(visible);
  if(composers.length!==1 || buttons.length!==1)return 'waiting';
  const [editor]=composers;
  const [button]=buttons;
  const composer=editor.closest('form, [data-testid="composer"]')??editor.closest('fieldset');
  if(!composer?.contains(button.closest('[data-composer-trailing-controls]')))return 'waiting';
  // An already active/disabled recorder is never clicked to "make it ready".
  if(button.getAttribute('data-dictation-button')!=='idle'||button.disabled||
      ['aria-disabled','aria-busy'].some(attr=>button.getAttribute(attr)==='true'))return 'waiting';
  return 'ready';
}

const delay=ms=>new Promise(r=>setTimeout(r,ms));

export async function resolveDesktopTarget(api, raw, stillCurrent, status,
    {budget=12000,interval=250,now=()=>performance.now(),wait=delay}={}) {
  const expected=normalize(raw);
  if(!expected)return {error:targets.redirect};
  const end=now()+budget;
  const alive=()=>stillCurrent() && now()<end;
  const bounded=async operation=>{
    const ms=end-now();
    if(ms<=0)throw Error('timeout');
    let deadline;
    try{return await Promise.race([operation(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('timeout')),ms);})]);}
    finally{clearTimeout(deadline);}
  };
  const eligible=t=>!t.incognito&&!t.discarded&&Number.isInteger(t.id);
  let tab, created=false;
  try{
    const tabs=await bounded(()=>api.tabs.query({url:'https://chatgpt.com/*'}));
    if(!alive())return {};
    const matches=tabs.filter(t=>eligible(t)&&normalize(t.pendingUrl??t.url)===expected);
    if(matches.length>1)return {error:targets.duplicate};
    if(matches.length===1){tab=matches[0];}
    else{
      status(targets.opening);
      const windows=await bounded(()=>api.windows.getAll({windowTypes:['normal']}));
      if(!alive())return {};
      const usable=windows.filter(w=>!w.incognito&&w.type==='normal'&&Number.isInteger(w.id));
      const win=usable.find(w=>w.focused)??usable[0];
      // Avoid opening a visible browser window without a regular browser window
      // already in use. The app never writes to an incognito window.
      if(!win)return {error:targets.create};
      tab=await bounded(()=>api.tabs.create({windowId:win.id,url:expected,active:false}));
      created=true;
      if(!alive())return {};
    }
  }catch{
    return stillCurrent()?{error:now()>=end?targets.timeout:targets.create}:{};
  }
  if(!eligible(tab))return {error:targets.create};
  let tabId=tab.id;
  const expectedWindow=tab.windowId;
  while(alive()){
    let details;
    try{details=await bounded(()=>api.tabs.get(tabId));}catch{return stillCurrent()?{error:now()>=end?targets.timeout:targets.redirect}:{};}
    if(!alive())break;
    if(!eligible(details)||details.windowId!==expectedWindow)return {error:targets.redirect};
    const current=normalize(details.url);
    // For a newly created tab there's a legitimate first about:blank/request
    // window. Once committed to a different URL, stop rather than chasing it.
    if((details.pendingUrl&&normalize(details.pendingUrl)!==expected)||
        (details.status==='complete'&&current!==expected &&
         !(created && !details.pendingUrl && details.url==='about:blank'))) {
      return {error:targets.redirect};
    }
    if(details.status==='complete'&&current===expected){
      try{
        const [{result}]=await bounded(()=>api.scripting.executeScript({
          target:{tabId},func:dictationReady,args:[expected]
        }));
        if(!alive())break;
        if(result==='ready')return {tab:details};
        if(result==='redirect')return {error:targets.redirect};
      }catch{/* Page navigation during observation; validate the tab again. */}
    }
    if(alive())await wait(Math.min(interval,Math.max(0,end-now())));
  }
  return stillCurrent()?{error:targets.timeout}:{};
}
