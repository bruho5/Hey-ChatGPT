import assert from 'node:assert/strict';
import {officialDictation as run} from '../official-dictation.js';

const url='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';
globalThis.location=new URL(url);
const timers=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms)=>timers(fn,ms>=4500?100:ms===320?5:ms);
let observers=new Set();
globalThis.MutationObserver=class {
  constructor(fn){this.fn=fn;}
  observe(target){this.target=target;observers.add(this);}
  takeRecords(){const queue=this.queue??[];this.queue=[];return queue;}
  disconnect(){observers.delete(this);this.queue=[];}
};
function mutate(target,records=[]){
  for(const observer of [...observers]) if(observer.target===target) observer.fn(records);
}
let phase='idle', draft='', extra=false, moved=false, attached=false, stopMode='append', clicks=0, startMode='record';
const controls={};
const composer={contains(el){return el===controls;},querySelector(){return attached?{}:null;}};
const editor={
  get innerText(){return draft;},get textContent(){return draft;},get innerHTML(){return '<p>'+draft+'</p>';},
  getClientRects(){return [1];},querySelector(){return null;},
  closest(a){return a.startsWith('form,')?composer:null;}
};
const button={
  getClientRects(){return [1];},
  getAttribute(n){return n==='data-dictation-button'?phase:n==='aria-label'&&phase==='dictating'?'停止听写':null;},
  closest(a){return a==='[data-composer-trailing-controls]'&&!moved?controls:null;},
  click(){
    clicks++;
    if(phase==='idle'){if(startMode==='record')phase='dictating';}
    else {
      phase='idle';
      if(stopMode==='append')draft+=draft?' 又一段':'听写成功';
      if(stopMode==='replace')draft='替换了原文';
    }
  }
};
const doc={documentElement:{},querySelectorAll(s){
  if(s.includes('data-dictation-button')) {
    if(s.includes('="dictating"')&&phase!=='dictating') return [];
    if(s.startsWith('[data-composer-trailing-controls]')&&moved)return [];
    return extra?[button,button]:[button];
  }
  return phase==='idle'?[editor]:[];
}};
globalThis.document=doc;
function reset(){
  delete globalThis.__voiceRoutesOfficialDictation;
  observers=new Set();location=new URL(url);document=doc;
  phase='idle';draft='';extra=false;moved=false;attached=false;stopMode='append';startMode='record';clicks=0;
}
async function first(){
  assert.deepEqual(await run(url,'start','a'),{state:'recording'});
  assert.deepEqual(await run(url,'stop','a'),{state:'draft'});
}
assert.equal((await run(url+'1','start','a')).state,'wrong');
assert.equal((await run(url,'stop','a')).state,'not-ours');
draft='keep this';
assert.equal((await run(url,'start','a')).state,'occupied');
draft='';extra=true;
assert.equal((await run(url,'start','a')).state,'unavailable');
extra=false;attached=true;
assert.equal((await run(url,'start','a')).state,'occupied');
attached=false;
assert.equal(clicks,0);
assert.equal((await run(url,'start','a')).state,'recording');
assert.equal((await run(url,'start','b')).state,'unavailable');
assert.equal((await run(url,'stop','b')).state,'not-ours');
moved=true;
assert.deepEqual(await run(url,'stop','a'),{state:'draft'});
assert.equal((await run(url,'stop','a')).state,'not-ours');
assert.equal(clicks,2);
assert.equal(draft,'听写成功');

reset();
assert.equal((await run(url,'start','a')).state,'recording');
const settling=run(url,'stop','a');
assert.equal((await run(url,'start','b','a')).state,'unavailable');
assert.equal((await settling).state,'draft');
mutate(editor,[{type:'attributes',target:editor,attributeName:'class'}]); // focus styling, not draft content
assert.equal((await run(url,'start','b','a')).state,'recording');
assert.equal((await run(url,'stop','b')).state,'draft');
assert.equal(draft,'听写成功 又一段');
assert.equal((await run(url,'start','c','a')).state,'occupied');
assert.equal(clicks,4);

for(const guard of ['wrong ticket','manual','edited','edited and restored','queued mutation','attachment','different document','URL variation']){
  reset();
  await first();
  if(guard==='edited')draft+=' 手工';
  if(guard==='edited and restored')mutate(editor,[{type:'characterData'}]);
  if(guard==='queued mutation')for(const obs of observers)if(obs.target===editor)obs.queue=[{}];
  if(guard==='attachment')attached=true;
  if(guard==='different document')document={...doc,documentElement:{}};
  if(guard==='URL variation')location=new URL(url+'?changed=1');
  assert.equal((await run(url,'start','b',guard==='wrong ticket'?'x':guard==='manual'?null:'a')).state,'occupied',guard);
  assert.equal(clicks,2,guard);
}

for(const behavior of ['unchanged','replace']){
  reset();
  await first();
  assert.equal((await run(url,'start','b','a')).state,'recording');
  stopMode=behavior;
  assert.equal((await run(url,'stop','b')).state,'stopped-no-draft');
  assert.equal((await run(url,'start','c','b')).state,'occupied');
  assert.equal(clicks,4);
}
reset();
startMode='none';
assert.equal((await run(url,'start','a')).state,'start-uncertain');
phase='dictating';
assert.equal((await run(url,'stop','a')).state,'not-ours');
assert.equal(clicks,1);
phase='idle';
assert.equal((await run(url,'start','b','a')).state,'occupied');

reset();
assert.equal((await run(url,'start','a',null,15)).state,'recording');
await new Promise(resolve=>timers(resolve,25));
assert.equal(clicks,2);
assert.equal((await run(url,'start','b','a')).state,'occupied');

reset();
assert.equal((await run(url,'start','a',null,15)).state,'recording');
phase='idle';
mutate(doc.documentElement);
phase='dictating'; // A new, manually started recording can reuse the same element.
assert.equal((await run(url,'stop','a')).state,'not-ours');
await new Promise(resolve=>timers(resolve,25));
assert.equal(clicks,1);

globalThis.setTimeout=timers;
console.log('Official dictation: exact tab URL, draft ownership, confirmed append only, one-use stop, bounded watchdog and no send.');

reset();
let trustedEdit;
document.addEventListener=(name,cb)=>{if(name==='input')trustedEdit=cb;};
document.removeEventListener=()=>{};
await first();
const proof=globalThis.__voiceRoutesOfficialDictation.draft;
assert.equal(proof.matchesEditor(editor),true);
mutate(editor,[{type:'childList',target:editor}]); // editor re-renders with identical text
assert.equal(proof.matchesEditor(editor),true);
draft='changed without trusted event';
assert.equal(proof.matchesEditor(editor),false);
draft='听写成功';
trustedEdit({isTrusted:false,target:editor});
assert.equal(proof.matchesEditor(editor),true);
trustedEdit({isTrusted:true,target:editor});
assert.equal(proof.matchesEditor(editor),false);
console.log('Only genuine editor changes or changed text invalidate voice send, not rendering churn.');
