import assert from 'node:assert/strict';
const C='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', PANEL='chrome-extension://'+C+'/panel.html';
const CHAT='https://chatgpt.com/c/12345678-1234-1234-1234-123456789012';
let stateCalls=[],native=[],creates=[],ports=[],outgoing=[],queryResult=[],store={routes:[{type:'chat',phrase:'Hey 莫',url:CHAT}],wakeSendPhrase:'Hey 发送'};
const listener=()=>({cb:null,addListener(cb){this.cb=cb;},emit(...a){return this.cb?.(...a);}});
const event=listener(),changed=listener(),alarm=listener(),action=listener();
const open=()=>({onMessage:listener(),onDisconnect:listener(),postMessage(row){native.push(row);}});
let now=1000;
Date.now=()=>now;
let cursor=0, queue=[], configured, redirect=false, hadText=false,noSend=false, stopUnavailable=false;
const config=()=>store.routes.map(r=>({id:'r0',text:r.phrase})).concat([{id:'r15',text:store.wakeSendPhrase,intent:'send'}]);
const validTab={id:52,url:CHAT,status:'complete',incognito:false,discarded:false,windowId:8};
globalThis.chrome={
 runtime:{id:C,getURL:()=>PANEL,onMessage:event,connectNative(name){assert.equal(name,'com.heychatgpt.bridge');const p=open();ports.push(p);return p;},
  sendMessage:async row=>outgoing.push(structuredClone(row))},
 action:{onClicked:action},
 storage:{local:{get:async()=>store},onChanged:changed},
 alarms:{onAlarm:alarm,create:async()=>{}},
 tabs:{
  query:async query=>{if(query.url===PANEL)return [];return queryResult;},
  get:async id=>({...validTab,id,url:redirect?'https://chatgpt.com/auth/login':CHAT}),
  create:async options=>{creates.push(options);return {...validTab,status:'loading'};},
  update:async()=>{},
 },
 windows:{getAll:async()=>[{id:1,incognito:true,type:'normal',focused:true},{id:8,incognito:false,type:'normal'}],update:async()=>{}},
 scripting:{executeScript:async ({target,func,args})=>{
  if(func.name==='dictationReady'){assert.equal(args[0],CHAT);return [{result:'ready'}];}
  assert.equal(target.tabId,52);assert.equal(args[0],CHAT);
  const verb=args[3]==='send-official'?'send':args[1];stateCalls.push(verb);
  return [{result:verb==='start'?{state:'recording',hadText}:verb==='stop'?(stopUnavailable?{state:'unavailable',reason:'missing'}:{state:'draft'}):
   (noSend?{state:'no-send-button',reason:'disabled'}:{state:'sent'})}];
 }},
};
globalThis.fetch=async (url, options)=>{
 const body=JSON.parse(options.body);assert.equal(body.token,'x'.repeat(20));
 if(url.endsWith('/configure')){configured=body.routes;return Response.json({ok:true,sendGuard:true,cursor});}
 return Response.json({connected:true,cursor,events:queue.splice(0)});
};
const signal=(row)=>queue.push({id:++cursor,at:now,...row});
const wake=(routeId,phrase,at=now)=>signal({type:'wake',routeId,phrase,at});
const read=(type='hey-desktop-status',sender={id:C,url:PANEL})=>{
 let response;event.emit({type},sender,value=>{response=value;});return response;
};
const wait=(ms=280)=>new Promise(r=>setTimeout(r,ms));
await import('../worker.js');
assert.equal(typeof document,'undefined'); // there is no UI tab or DOM worker context
assert.equal(ports.length,1);
ports[0].onMessage.emit({type:'state',enabled:true,token:'x'.repeat(20)});
await wait();
assert.deepEqual(configured,config());
assert.equal(read().connected,true);
assert(!Object.hasOwn(read(),'token'));
assert.equal(read('hey-desktop-finish',{id:C,url:CHAT}),undefined);
queryResult=[{...validTab,id:777,incognito:true}]; // ignore incognito matching tab
wake('r0','Hey 莫');await wait();
assert.deepEqual(creates,[{windowId:8,url:CHAT,active:false}]);
assert.equal(read().mode,'recording');
assert.equal(native.filter(r=>r.type==='cue').length,1);
wake('r15','Hey 发送');await wait();
assert.deepEqual(stateCalls,['start']); // no send during recording
read('hey-desktop-finish');await wait();
assert.equal(read().mode,'ready');
now+=600;
wake('r15','Hey 发送',now-2000);await wait(); // stale events discarded
assert.deepEqual(stateCalls,['start','stop']);
wake('r15','Hey 发送');await wait();
assert.deepEqual(stateCalls,['start','stop','send']);
wake('r15','Hey 发送');await wait();
assert.equal(stateCalls.filter(v=>v==='send').length,1); // proof is one-use

queryResult=[validTab,{...validTab,id:15}];
wake('r0','Hey 莫');await wait();
assert.equal(read().official,'同一会话开了多个标签页，请只保留一个。');
assert.deepEqual(stateCalls,['start','stop','send']);
queryResult=[];redirect=true;
wake('r0','Hey 莫');await wait();
assert.equal(read().official,'目标会话跳转了，请检查登录状态和会话地址。');
assert.equal(creates.length,2);
assert.deepEqual(stateCalls,['start','stop','send']);
redirect=false;queryResult=[validTab];

store={...store,wakeAutoSend:true};
changed.emit({wakeAutoSend:{newValue:true}},'local');await wait();
wake('r0','Hey 莫');await wait();
now+=300;
signal({type:'audio',speech:true});await wait();
now+=2100;await wait(1000);
assert.deepEqual(stateCalls,['start','stop','send','start','stop','send']); // fresh standalone silence auto-sends once
hadText=true;wake('r0','Hey 莫');await wait();now+=300;
signal({type:'audio',speech:true});await wait();now+=2100;await wait(1000);
assert.equal(read().mode,'ready');assert.equal(stateCalls.filter(v=>v==='send').length,2); // continuing does not auto-send
ports[0].onMessage.emit({type:'state',enabled:false});
assert.equal(read().connected,false);
ports[0].onMessage.emit({type:'state',enabled:true,token:'x'.repeat(20)});
await wait();now+=600;wake('r15','Hey 发送');await wait();
assert.equal(stateCalls.filter(v=>v==='send').length,2); // no proof resurrected by reconnect
// The panel can translate nested structured status after failures.
store={...store,wakeAutoSend:false};changed.emit({wakeAutoSend:{newValue:false}},'local');
await wait();wake('r0','Hey 莫');await wait();
stopUnavailable=true;read('hey-desktop-finish');await wait();
assert.deepEqual(structuredClone(read().official),{key:'{0}，扩展没有点击。请回原会话检查录音。',args:[{key:'页面上没找到停止键',args:[]}]});
stopUnavailable=false;read('hey-desktop-finish');await wait();
noSend=true;now+=600;wake('r15','Hey 发送');await wait();
assert.deepEqual(structuredClone(read().wake),{key:'{0} 没有发送。',args:[{key:'找到了发送键，但它还不可用。',args:[]}]});
ports[0].onMessage.emit({type:'state',enabled:false});
assert.equal(read().active,false);
console.log('desktop worker: absent panel, native IPC and exact URL, no incognito/duplicate/redirect touches, one-use send, guarded auto-send, reconnect');
