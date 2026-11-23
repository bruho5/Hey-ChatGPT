import assert from 'node:assert/strict';
import {fillDraft,isSendCommand} from '../core.js';
const url='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';
assert.equal(isSendCommand('莫，发送。'),true);
assert.equal(isSendCommand('请莫发送，这段正文'),false);
globalThis.location=new URL(url);
globalThis.DataTransfer=class{setData(k,v){this[k]=v}getData(k){return this[k]}};
globalThis.ClipboardEvent=class{constructor(t,o){this.type=t;Object.assign(this,o)}};
globalThis.MutationObserver=class{constructor(f){this.f=f}observe(){}disconnect(){}takeRecords(){return []}};

let clicks=0,draft='',dirtyHandler,users=[],markup=null,attachment=false,busy=false,dictating=false,image=false;
let candidates=[],editors;
const fieldset={querySelectorAll:()=>assert.fail('narrow fieldset should not be used where a containing composer exists')};
const form={
  querySelector(s){return (s.includes('remove-attachment')&&attachment || s.includes('stop-button')&&busy) ? {} : null;},
  querySelectorAll(s){assert.match(s,/button\[aria-label\]/);return candidates;}
};
const composer={
  tagName:'DIV',get textContent(){return draft},get innerText(){return draft},get innerHTML(){return markup??'<p>'+draft+'</p>'},
  getClientRects:()=>[1],isConnected:true,
  closest:s=>s==='fieldset'?fieldset:s==='[inert]'?null:form,
  querySelector:()=>image?{}:null,
  dispatchEvent:e=>{draft=e.clipboardData.getData('text/plain')},
  addEventListener:(event,fn)=>{if(event==='input')dirtyHandler=fn},
  removeEventListener(){},
  focus:()=>assert.fail('must not focus'),
};
function button({label='发送',marker=null,trailing=false,scope=form,disabled=false,hidden=false,busy=false,blocked=false,submitElsewhere=false,shouldClick=true}={}){
  return {
    getClientRects:()=>hidden?[]:[1],disabled,
    form:submitElsewhere?{}:scope,
    hasAttribute:name=>name==='form'&&submitElsewhere,
    matches:selector=>selector===':disabled'&&blocked,
    getAttribute:name=>({ 'aria-label':label,'data-testid':marker,'aria-busy':busy?'true':null })[name]??null,
    closest:s=>s==='form, [data-testid="composer"]'?scope:s==='[data-composer-trailing-controls]'&&trailing?{}:null,
    click(){
      if(!shouldClick)assert.fail('must not click this control');
      clicks++;
      const sent=draft;draft='';
      users.push({innerText:sent,querySelectorAll:()=>[],closest:()=>({getAttribute:()=>String(clicks)})});
    }
  };
}
const recorder=button({shouldClick:false});
const doc={visibilityState:'hidden',documentElement:{},querySelectorAll:s=>s.includes('data-message-author-role')?users:
  s.includes('data-dictation-button')?(dictating?[recorder]:[]):editors};
function reset(){
  draft='';markup=null;attachment=false;busy=false;dictating=false;image=false;
  candidates=[button()];editors=[composer];location=new URL(url);globalThis.document=doc;
}
reset();
assert.equal(fillDraft(url,'你好','one').state,'filled');
assert.deepEqual(await fillDraft(url,'你好','wrong','send'),{state:'stale',reason:'no-proof'});
assert.equal(clicks,0);
assert.deepEqual(await fillDraft(url,'你好','one','send'),{state:'sent'});
assert.deepEqual(await fillDraft(url,'你好','one','send'),{state:'stale',reason:'no-proof'});
assert.equal(clicks,1);
assert.equal(fillDraft(url,'更改后又改回','two').state,'filled');
dirtyHandler();
assert.deepEqual(await fillDraft(url,'更改后又改回','two','send'),{state:'stale',reason:'draft-changed'});
assert.equal(clicks,1);

function prove(ticket='official',dirty=false){
  reset();
  let disposals=0;
  draft='官方听写的正文';
  const snapshot=JSON.stringify([null,composer.innerText,composer.textContent,composer.innerHTML]);
  const state={draft:{ticket,expected:url,href:location.href,doc,editor:composer,snapshot,hasChanges:()=>dirty,dispose:()=>{disposals++;}}};
  globalThis.__voiceRoutesOfficialDictation=state;
  return {state,disposals:()=>disposals};
}
let proof=prove();
assert.deepEqual(await fillDraft(url,null,'wrong','send-official'),{state:'stale',reason:'no-proof'});
assert.equal(proof.disposals(),0);
assert.equal(clicks,1);
candidates=[button({marker:'send-button',label:null})]; // Same composer outside the editor's fieldset.
assert.deepEqual(await fillDraft(url,'unused','official','send-official'),{state:'sent'});
assert.equal(users.at(-1).innerText,'官方听写的正文');
assert.equal(proof.disposals(),1);
assert.deepEqual(await fillDraft(url,null,'official','send-official'),{state:'stale',reason:'no-proof'});
assert.equal(clicks,2);

proof=prove();
candidates=[button({shouldClick:false}),button({scope:{},trailing:true,shouldClick:false}),button({trailing:true})];
proof.state.draft.matchesEditor=editor=>editor===composer; // New semantic proof permits benign markup changes.
markup='<p><b>'+draft+'</b></p>';
assert.deepEqual(await fillDraft(url,null,'official','send-official'),{state:'sent'});
assert.equal(proof.disposals(),1);
assert.equal(clicks,3);

const reasons={
  'dirty':['stale','draft-changed'],
  'different-page':['stale','page-changed'],
  'different-document':['stale','page-changed'],
  'different-editor':['stale','composer-structure'],
  'missing-editor':['stale','composer-structure'],
  'markup':['stale','draft-changed'],
  'text':['stale','draft-changed'],
  'trusted-edit':['stale','draft-changed'],
  'empty':['stale','draft-empty'],
  'attachment':['occupied','attachment'],
  'image':['occupied','attachment'],
  'busy':['occupied','busy'],
  'recording':['occupied','recorder'],
  'recorder':['occupied','recorder'],
  'settling':['occupied','recorder'],
  'wrong-route':['wrong'],
  'voice':['no-send-button','not-found'],
  'other-composer':['no-send-button','not-found'],
  'disabled':['no-send-button','disabled'],
  'hidden':['no-send-button','disabled'],
  'fieldset-disabled':['no-send-button','disabled'],
  'aria-busy':['no-send-button','disabled'],
  'bound-elsewhere':['no-send-button','disabled'],
  'ambiguous':['no-send-button','ambiguous']
};
for(const [failure,[state,reason]] of Object.entries(reasons)){
  proof=prove('official',failure==='dirty');
  if(failure==='different-page')location=new URL(url+'?view=changes');
  if(failure==='different-document')document={...doc,documentElement:{}};
  if(failure==='different-editor')proof.state.draft.editor={...composer};
  if(failure==='missing-editor')editors=[];
  if(failure==='markup')markup='<p><b>'+draft+'</b></p>';
  if(failure==='text')draft+=' edited';
  if(failure==='trusted-edit')proof.state.draft.matchesEditor=()=>false;
  if(failure==='empty')draft=' \u200b ';
  if(failure==='attachment')attachment=true;
  if(failure==='image')image=true;
  if(failure==='busy')busy=true;
  if(failure==='recording')proof.state.recording={};
  if(failure==='recorder')dictating=true;
  if(failure==='settling')proof.state.settling={};
  if(failure==='wrong-route')location=new URL(url+'a');
  if(failure==='voice')candidates=[button({label:'启动语音模式',marker:'send-button',shouldClick:false})];
  if(failure==='other-composer')candidates=[button({scope:{},shouldClick:false})];
  if(failure==='disabled')candidates=[button({disabled:true,shouldClick:false})];
  if(failure==='hidden')candidates=[button({hidden:true,shouldClick:false})];
  if(failure==='fieldset-disabled')candidates=[button({blocked:true,shouldClick:false})];
  if(failure==='aria-busy')candidates=[button({busy:true,shouldClick:false})];
  if(failure==='bound-elsewhere')candidates=[button({submitElsewhere:true,shouldClick:false})];
  if(failure==='ambiguous')candidates=[button({trailing:true,shouldClick:false}),button({trailing:true,shouldClick:false})];
  assert.deepEqual(await fillDraft(url,null,'official','send-official'),reason?{state,reason}:{state},failure);
  assert.equal(proof.disposals(),1,failure);
  assert.equal(proof.state.draft,undefined,failure);
  assert.equal(clicks,3,failure);
}
console.log('Send fixture passed: same-composer selector, exact one-use proof, reason codes, and verified new message.');
