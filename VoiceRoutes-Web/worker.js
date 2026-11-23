import {WakeBridge} from './wake-bridge.js';
import {officialDictation} from './official-dictation.js';
import {checkRoutes,fillDraft} from './core.js';
import {resolveDesktopTarget} from './desktop-target.js';

const HOST='com.heychatgpt.bridge';
const RECONNECT='hey-desktop-reconnect-native';
const PANEL=chrome.runtime.getURL('panel.html');
const SETTINGS=['routes','wakeSendPhrase','wakeAutoSend'];
const TOKEN=/^[A-Za-z0-9_-]{20,128}$/;
const OFFLINE='请在 Windows 打开 Hey, ChatGPT 托盘应用。';
let port=null,token=null,reconnect=null,revision=0,configuring=false,retryPending=false;
let wakeRoutes=new Map(),sendPhrase='ChatGPT发送',wakeAuto=false;
let officialSession,officialBusy=false,sendReady,mode='offline',audioDetected=null;
let wake=OFFLINE,official='',lastWakePhrase=null;
const message=(key,...args)=>({key,args});
const clearOfficialSend=()=>{sendReady=null;};
function snapshot(){
  return {connected:bridge.connected,active:bridge.active,mode,wake,official,lastWakePhrase,audioDetected,
    officialBusy,officialSession:!!officialSession};
}
function nativePost(value){
  try{port?.postMessage(value);}catch{/* Chrome closes the port separately. */}
}
function announce(){
  // No setting, token, private URL, or user content is forwarded to the desktop UI.
  const status=snapshot();
  if(nativeMode!==mode){nativeMode=mode;nativePost({type:'status',message:mode});}
  try{Promise.resolve(chrome.runtime.sendMessage({type:'hey-desktop-update',status})).catch(()=>{});}catch{}
}
let nativeMode=null;
const officialStatus=msg=>{official=msg;announce();};
const wakeStatus=msg=>{wake=msg;announce();};
const syncMonitor=announce;
const setMode=value=>{mode=value;announce();};

async function officialClick(action,wakeRoute,stopReason){
  if(officialBusy) return;
  const route=wakeRoute;
  if(action==='start' && (!route || officialSession)) return;
  if(action==='stop' && !officialSession) return;
  officialBusy=true;setMode(action==='start'?'starting':'stopping');
  try{
    if(action==='start'){
      const generation=bridge.generation;
      const stillCurrent=()=>bridge.connected && !!token && generation===bridge.generation;
      const {tab,error}=await resolveDesktopTarget(chrome,route.url,stillCurrent,officialStatus);
      if(!stillCurrent())return false;
      if(!tab){if(error)officialStatus(error);return false;}
      clearOfficialSend();
      officialSession={tabId:tab.id,url:route.url,ticket:crypto.randomUUID(),fromWake:true,bridgeGeneration:bridge.generation,autoAtStart:wakeAuto};
    }
    const session=officialSession;
    if(action==='stop')bridge.clearSegment();
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:session.tabId},func:officialDictation,
      args:[session.url,action,session.ticket,null,session.fromWake?50000:null,true]});
    const state=result?.state;
    if(state==='recording' && action==='start'){
      session.hadText=result.hadText!==false;
      officialStatus(session.fromWake?'指定会话正在听写。停顿后自动收段。':'指定会话正在听写。说完点「停止并转录」，不会发送。');
      setMode('recording');if(bridge.connected && session.bridgeGeneration===bridge.generation && token) nativePost({type:'cue'});
      return true;
    }
    if(state==='start-uncertain'){
      officialStatus('未确认录音已开始。请在原会话检查麦克风授权，若正在录音请点方形停止键。');
      setMode('recording');
      if(session.fromWake) return true;
      return false;
    }
    if(action==='stop' && state==='unavailable') {
      const why={disabled:'停止键还不可用',ambiguous:'无法唯一确认停止键',missing:'页面上没找到停止键'}[result.reason]??'未能确认停止键';
      setMode('recording');
      return officialStatus(message('{0}，扩展没有点击。请回原会话检查录音。',message(why)));
    }
    officialSession=null;
    setMode(bridge.connected?'idle':'offline');
    if(action==='stop' && state==='draft' && session.fromWake && bridge.active && session.bridgeGeneration===bridge.generation){
      sendReady={...session,at:Date.now()};setMode('ready');
      if(stopReason==='silence' && session.autoAtStart && !session.hadText && wakeAuto) {
        const ready=sendReady;
        setTimeout(()=>{if(sendReady===ready && wakeAuto)void sendOfficialDraft('auto');},600);
      } else wakeStatus(message('这一段已留在草稿里。可继续录，或说「{0}」。',sendPhrase));
    }
    const messages={
      wrong:'原标签页已切换，没有操作。',
      unavailable:'没找到可用的官方听写键，未开始。请确认会话加载完成。',
      occupied:'目标会话有附件、非纯文本内容或正在回复。原内容保留，没有开启听写。',
      draft:'转录已出现在原会话的输入框里，未发送。',
      'already-ended':'录音已不在进行。请到原会话确认草稿，未发送。',
      'still-recording':'已点停止，但会话仍显示在录音。请回原会话点方形停止键。未发送。',
      'stopped-no-draft':'录音已退出，但没看到转录草稿。请检查原会话，未发送。',
      'not-ours':'这轮录音无法确认为从扩展启动，请到原会话检查。'
    };
    officialStatus(messages[state]??'未能确认结果，请到原会话查看。');
  }catch{
    if(action==='stop') officialSession=null;
    officialStatus('无法确认会话操作。若原会话仍显示录音，请从那里停止。扩展没有发送消息。');
  }finally{officialBusy=false;if(mode==='starting'||mode==='stopping')setMode(officialSession?'recording':bridge.connected?'idle':'offline');else syncMonitor();}
}
async function sendOfficialDraft(source,eventAt){
  if(!bridge.active || officialBusy || officialSession || !sendReady)return;
  const d=sendReady;
  if(d.bridgeGeneration!==bridge.generation || Date.now()-d.at>120000){clearOfficialSend();return wakeStatus('草稿的语音发送已超时，请到会话中发送或继续录一段。');}
  if(source==='voice' && (!Number.isFinite(eventAt) || eventAt<d.at+450))return;
  if(source==='auto' && (!wakeAuto || d.hadText || !d.autoAtStart))return;
  clearOfficialSend();
  officialBusy=true;setMode('sending');
  wakeStatus('正在发送这份已确认的听写草稿…');
  try {
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:d.tabId},func:fillDraft,args:[d.url,null,d.ticket,'send-official']});
    if(result?.state==='sent'){setMode('sent');wakeStatus('已发送到原来的会话。');officialStatus('已发送并确认。');return;}
    const failure={
      'no-send-button':{
        'not-found':'这次没找到发送键。',
        ambiguous:'找到多个可能的发送键，没有点。',
        disabled:'找到了发送键，但它还不可用。'
      },
      stale:{
        'no-proof':'当前草稿没有这次听写的确认记录。',
        'draft-changed':'输入框的正文变了，或检测到了手动编辑。',
        'draft-empty':'输入框现在是空的。',
        'composer-structure':'无法确认还是同一个输入区域。',
        'page-changed':'目标会话或标签页已经切换。'
      },
      occupied:{
        attachment:'输入框现在有附件。',
        busy:'ChatGPT 正在回复。',
        recorder:'听写还在录音或转录。'
      }
    };
    if(['stale','occupied','wrong','waiting','no-send-button'].includes(result?.state)){
      const fallback={wrong:'目标会话已经切换。',waiting:'找不到可用输入框。',stale:'不能确认是原听写草稿。',occupied:'输入框正忙。','no-send-button':'没找到可用的发送键。'};
      return wakeStatus(message('{0} 没有发送。',message(failure[result.state]?.[result.reason]??fallback[result.state])));
    }
  } catch {}
  finally{officialBusy=false;if(mode==='sending')setMode(bridge.connected?'idle':'offline');else syncMonitor();}
  wakeStatus('无法确认是否发送。请到原会话检查，不会重试。');
}

const bridge=new WakeBridge({
  wake:async(id,phrase)=>{
    if(!bridge.connected || !token || officialBusy || officialSession)return false;
    const route=wakeRoutes.get(id);
    if(!route || route.type!=='chat'||route.phrase!==phrase)return false;
    officialStatus('');wakeStatus(message('听到「{0}」，提示音后请说正文。',phrase));
    const started=await officialClick('start',route);
    if(started && bridge.connected && officialSession?.bridgeGeneration===bridge.generation){lastWakePhrase=phrase;announce();}
    if(!started && bridge.connected)wakeStatus(message('已命中「{0}」，但没开始录音。',phrase));
    return started;
  },
  command:event=>{void sendOfficialDraft('voice',event.at);},
  isRecording:()=>!!officialSession && !officialBusy,
  onAudio:speech=>{if(audioDetected!==speech){audioDetected=speech;announce();}},
  stop:reason=>{
    if(reason!=='disconnect')wakeStatus(reason==='silence'?'检测到停顿。':reason==='no-speech'?'一直没听到正文。':'达到最长录音时间。');
    return officialClick('stop',undefined,reason);
  },
  status:msg=>{
    wakeStatus(msg);
    if(!bridge.active){audioDetected=null;clearOfficialSend();lastWakePhrase=null;}
    if(!officialSession&&!officialBusy)setMode(bridge.connected?'idle':bridge.active?'connecting':'offline');
    else syncMonitor();
  }
});

function deactivate(why){
  clearOfficialSend();
  if(bridge.active || officialSession)bridge.disconnect(why);
  else {mode='offline';wakeStatus(why);}
}

async function applySettings(force=false){
  retryPending=false;configuring=false;
  const requested=++revision;
  clearOfficialSend();
  if(!token)return;
  if(bridge.active)deactivate('口令监听已断开。');
  if(!token || requested!==revision)return;
  if(officialSession||officialBusy){
    retryPending=true;
    if(force)wakeStatus('先结束当前听写。');
    return;
  }
  const expected=token;
  configuring=true;
  try{
    const saved=await chrome.storage.local.get(SETTINGS);
    if(token!==expected||requested!==revision)return;
    const existing=Array.isArray(saved.routes);
    const routes=checkRoutes((existing?saved.routes:[]).filter(r=>r?.type==='chat' && r.phrase && r.url));
    if(!routes.length)return wakeStatus('先填入并保存至少一个会话地址。');
    if(routes.length>15)return wakeStatus('最多同时监听 15 条会话口令，另留 1 条发送口令。');
    const phrase=saved.wakeSendPhrase??(existing?'莫发送':'ChatGPT发送');
    if(typeof phrase!=='string'||phrase.replace(/\s/g,'').length<3||phrase.length>80)return wakeStatus('发送口令须为 3 到 80 个字符。');
    sendPhrase=phrase;
    wakeAuto=saved.wakeAutoSend===true;
    wakeRoutes=new Map(routes.map((r,i)=>['r'+i,r]));
    if(!bridge.start(expected,[...[...wakeRoutes].map(([id,r])=>({id,text:r.phrase})),
      {id:'r15',text:sendPhrase,intent:'send'}]))wakeStatus('无法连接本机助手，请确认托盘应用已开启。');
  }catch(e){if(token===expected&&requested===revision)wakeStatus(e?.message||'没能保存设置。');}
  finally{if(requested===revision)configuring=false;}
}

async function openPanel(){
  const tabs=await chrome.tabs.query({url:PANEL});
  const tab=tabs.find(t=>!t.incognito);
  if(!tab)return chrome.tabs.create({url:PANEL});
  await chrome.windows.update(tab.windowId,{focused:true});
  await chrome.tabs.update(tab.id,{active:true});
}

function planReconnect(){
  if(reconnect===null){
    reconnect=setTimeout(()=>{reconnect=null;connect();},2500);
  }
}
function connect(){
  if(port)return;
  if(reconnect!==null){clearTimeout(reconnect);reconnect=null;}
  let opened;
  try{opened=chrome.runtime.connectNative(HOST);}catch{return;}
  port=opened;nativeMode=null;announce();
  opened.onMessage.addListener(data=>{
    if(port!==opened || !data || typeof data!=='object')return;
    if(data.type==='open-settings'){void openPanel().catch(()=>{});return;}
    if(data.type!=='state' || typeof data.enabled!=='boolean')return;
    if(!data.enabled){
      ++revision;token=null;configuring=false;retryPending=false;deactivate(OFFLINE);return;
    }
    if(typeof data.token!=='string'||!TOKEN.test(data.token))return;
    if(token===data.token)return;
    token=data.token;
    void applySettings();
  });
  opened.onDisconnect.addListener(()=>{
    if(port!==opened)return;
    void chrome.runtime.lastError;
    port=null;nativeMode=null;token=null;++revision;configuring=false;retryPending=false;
    deactivate(OFFLINE);
    // No command, draft proof, or audio segment survives a reconnect.
    planReconnect();
  });
}
chrome.action.onClicked.addListener(()=>{void openPanel().catch(()=>{});});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(sender?.id!==chrome.runtime.id||sender.url!==PANEL)return false;
  if(msg?.type==='hey-desktop-status'){respond(snapshot());return false;}
  if(msg?.type==='hey-desktop-finish'){void officialClick('stop',undefined,'manual');respond(snapshot());return false;}
  if(msg?.type==='hey-desktop-reconnect'){
    connect();
    if(token&&!bridge.connected&&!configuring)void applySettings(true);
    respond(snapshot());return false;
  }
  return false;
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local'||!SETTINGS.some(k=>Object.hasOwn(changes,k)))return;
  // Every meaningful settings update first invalidates pending sends. Resume only against
  // a fresh storage snapshot, and never reinterpret a segment already underway.
  clearOfficialSend();
  if(officialSession||officialBusy){
    retryPending=true;++revision;
    wakeAuto=false;
    if(bridge.active)deactivate('已保存，重新连接助手后使用新口令。');
  }else void applySettings();
});
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name!==RECONNECT)return;
  connect();
  if(token && !bridge.active && !configuring && !officialSession && !officialBusy&&retryPending){
    retryPending=false;void applySettings();
  }
});
void Promise.resolve(chrome.alarms.create(RECONNECT,{periodInMinutes:.5})).catch(()=>{});
connect();
