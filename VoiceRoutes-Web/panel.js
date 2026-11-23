import {translate} from './i18n.js';
import {checkRoutes} from './core.js';
const $=id=>document.getElementById(id);
const defaults=[
  {phrase:'ChatGPT打开会话一',type:'chat',url:''},
  {phrase:'ChatGPT打开会话二',type:'chat',url:''}
];
const storage=chrome.storage.local;
let configured=defaults, sendPhrase='ChatGPT发送', wakeAuto=false;
let lastWakePhrase=null;
let state={connected:false,active:false,mode:'offline',officialBusy:false,officialSession:false};
let language='zh', theme='light', audioDetected=null;
const t=(key,...args)=>translate(language,key,...args);
const message=(key,...args)=>({key,args});
const renderText=value=>typeof value==='string'?t(value):value&&typeof value.key==='string'?t(value.key,...(Array.isArray(value.args)?value.args.map(renderArg):[])):'';
const renderArg=arg=>arg&&typeof arg==='object'?renderText(arg):arg;
let lastOfficial='',lastWake='请打开 Windows 托盘应用。';
const officialStatus=msg=>{lastOfficial=msg;$('official-status').textContent=renderText(msg);};
const wakeStatus=msg=>{
  lastWake=msg;
  const value=renderText(msg);
  $('wake-status').textContent=value;$('settings-status').textContent=value;
};
function syncAudio(){
  const label=audioDetected===null?'':t(audioDetected?'本机助手：检测到声音':'本机助手：安静');
  if($('wake-audio').textContent!==label)$('wake-audio').textContent=label;
}
function syncLanguage(){
  document.documentElement.lang=language==='en'?'en':'zh-CN';
  for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=t(el.dataset.i18n);
  for(const attr of ['title','aria-label','placeholder']){
    for(const el of document.querySelectorAll('[data-i18n-'+attr+']'))el.setAttribute(attr,t(el.getAttribute('data-i18n-'+attr)));
  }
  officialStatus(lastOfficial);wakeStatus(lastWake);syncAudio();syncMonitor();renderCommands();
}
function syncTheme(){document.documentElement.dataset.theme=theme;}
function bindText(el,key){el.dataset.i18n=key;el.textContent=t(key);return el;}
const titles={offline:'等待连接',connecting:'正在连接',idle:'等待口令',starting:'准备听写',recording:'正在听写',stopping:'正在收段',ready:'草稿已就绪',sending:'正在发送',sent:'已发送'};
function syncMonitor(){
  const mode=state.mode in titles?state.mode:'offline';
  $('monitor').dataset.state=mode;
  $('state').textContent=t(titles[mode]);
  const b=$('main-action');
  b.textContent=t(state.officialSession?'结束这段':'检查连接');
  b.disabled=state.officialBusy===true;
  $('bridge-badge').textContent=t(state.connected?'本机已连接':state.active?'连接中':'未连接');
}
function acceptStatus(next){
  if(!next||typeof next!=='object'||!Object.hasOwn(titles,next.mode))return;
  state=next;
  const phrase=typeof next.lastWakePhrase==='string'?next.lastWakePhrase:null;
  if(lastWakePhrase!==phrase){lastWakePhrase=phrase;renderCommands();}
  audioDetected=typeof next.audioDetected==='boolean'?next.audioDetected:null;
  syncAudio();syncMonitor();
  officialStatus(next.official??'');
  wakeStatus(next.wake??'请打开 Windows 托盘应用。');
}
async function requestDesktop(type){
  try{
    const result=await chrome.runtime.sendMessage({type});
    acceptStatus(result?.status??result);
  }catch{wakeStatus('请打开 Windows 托盘应用。');}
}
function openSettings(){
  if(!$('settings').open)$('settings').showModal();
}
$('open-settings').onclick=openSettings;
$('close-settings').onclick=()=>$('settings').close();
$('main-action').onclick=()=>void requestDesktop(state.officialSession?'hey-desktop-finish':'hey-desktop-reconnect');
$('wake-connect').onclick=()=>void requestDesktop('hey-desktop-reconnect');
chrome.runtime.onMessage.addListener(msg=>{
  if(msg?.type==='hey-desktop-update')acceptStatus(msg.status);
});
// Use the same SVG paths and sizing as the approved HTML mockup.
const svgNS='http://www.w3.org/2000/svg';
const routePaths={chat:'M5 5h14v11H9l-4 3z',send:'m6 11 6-6 6 6m-6-6v14'};
function commandIcon(type){
  const svg=document.createElementNS(svgNS,'svg');
  for(const [key,value] of Object.entries({class:'ri',width:'16',height:'16',viewBox:'0 0 24 24','aria-hidden':'true'}))svg.setAttribute(key,value);
  const path=document.createElementNS(svgNS,'path');
  path.setAttribute('d',routePaths[type]);
  svg.append(path);
  return svg;
}
function renderCommands(){
  const host=$('route-list');
  host.replaceChildren();
  let chats=0;
  for(const r of [...configured,{type:'send',phrase:sendPhrase,url:''}]){
    if(!r.phrase)continue;
    const row=document.createElement('div');row.className='route';
    if(r.type==='chat' && r.phrase===lastWakePhrase)row.dataset.current='true';
    const mark=commandIcon(r.type);
    const name=document.createElement('span');name.className='name';name.textContent=r.phrase;
    const tag=document.createElement('span');tag.className='type';
    let label=r.type==='send'?t('发送'):t('会话 {0}',++chats);
    if(r.type==='chat'&&!r.url)label=t('待绑定');
    tag.textContent=label;
    row.append(mark,name,tag);host.append(row);
  }
}
function editorRow(r={phrase:'',type:'chat',url:''}){
  const row=document.createElement('div');row.className='settings-route';row.dataset.type=r.type;
  const label=document.createElement('label');label.append(bindText(document.createElement('span'),'会话口令'));
  const phrase=document.createElement('input');phrase.type='text';phrase.value=r.phrase;phrase.className='phrase';phrase.maxLength=80;
  label.append(phrase);row.append(label);
  if(r.type==='chat'){
    const remove=document.createElement('button');remove.className='subtle';remove.type='button';bindText(remove,'删除');remove.onclick=()=>row.remove();
    const target=document.createElement('label');target.append(bindText(document.createElement('span'),'会话地址'));
    const input=document.createElement('input');input.type='text';input.className='url';input.value=r.url;
    input.placeholder='https://chatgpt.com/c/…';input.autocomplete='off';target.append(input);row.append(remove,target);
  }
  $('routes').append(row);
}
$('add').onclick=()=>editorRow();
function activeRoutes(rows){
  return checkRoutes(rows.filter(r=>r.type==='chat' && r.phrase && r.url));
}
$('save').onclick=async()=>{
  try{
    if(state.officialSession||state.officialBusy)return wakeStatus('先结束当前听写，再保存设置。');
    const draft=[...$('routes').children].map(row=>({
      phrase:row.querySelector('.phrase').value.trim(),type:row.dataset.type,url:row.querySelector('.url')?.value.trim()??''
    })).filter(r=>r.phrase||r.url);
    if(draft.some(r=>r.url&&!r.phrase))throw Error('已填地址的会话需要对应口令。');
    activeRoutes(draft);
    const send=$('wake-send-phrase').value.trim();
    if(send.replace(/\s/g,'').length<3 || send.length>80)throw Error('发送口令须为 3 到 80 个字符。');
    const auto=$('wake-auto-send').checked;
    await storage.set({routes:draft,wakeSendPhrase:send,wakeAutoSend:auto});
    configured=draft;sendPhrase=send;wakeAuto=auto;renderCommands();
    wakeStatus('设置已保存。');
  }catch(e){wakeStatus(e.message||'没能保存设置。');}
};
function persistAppearance(key,value){
  void storage.set({[key]:value}).catch(()=>wakeStatus('没能保存设置。'));
}
$('ui-language').onchange=()=>{
  language=$('ui-language').value==='en'?'en':'zh';
  syncLanguage();persistAppearance('uiLanguage',language);
};
$('ui-theme').onchange=()=>{
  theme=$('ui-theme').value==='dark'?'dark':'light';
  syncTheme();persistAppearance('uiTheme',theme);
};

try{
  const saved=await storage.get(['routes','wakeSendPhrase','wakeAutoSend','uiLanguage','uiTheme']);
  language=saved.uiLanguage==='en'?'en':'zh';
  theme=saved.uiTheme==='dark'?'dark':'light';
  const existing=Array.isArray(saved.routes);
  configured=existing?saved.routes.filter(r=>r?.type==='chat'):defaults;
  sendPhrase=saved.wakeSendPhrase??(existing?'莫发送':'ChatGPT发送');
  wakeAuto=saved.wakeAutoSend===true;
  $('wake-send-phrase').value=sendPhrase;
  $('wake-auto-send').checked=wakeAuto;
  renderCommands();configured.forEach(editorRow);
  activeRoutes(configured);
}catch(e){wakeStatus(message('无法读取设置：{0}',{key:e.message}));}
$('ui-language').value=language;
$('ui-theme').value=theme;
syncTheme();syncLanguage();

void requestDesktop('hey-desktop-status');
