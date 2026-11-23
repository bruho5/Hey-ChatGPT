const assert = require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ids=['folder','status','chrome','badge','listen','choose','language','error','status-region'];
const elements=Object.fromEntries(ids.map(id=>[id,{setAttribute(k,v){this[k]=v;},classList:{toggle(){}}}]));
const labels=['eyebrow','language','subtitle','folderLabel','browse','hint','foot'].map(label=>({dataset:{label}}));
let snapshot={folder:'C:\\Safe\\Helper',message:'已暂停。',chrome:'',running:false,busy:false,ready:true,language:'zh'};
let tick;const calls=[];
const document={documentElement:{},getElementById:id=>elements[id],querySelectorAll:()=>labels,addEventListener(){}};
const context={document,setInterval(fn){tick=fn;},window:{mygo:{call:async(m,...args)=>{
 calls.push([m,...args]);
 switch(m){
 case 'Desktop.SetLanguage': snapshot={...snapshot,language:args[0],message:args[0]==='en'?'Listening paused.':'已暂停。'};break;
 case 'Desktop.StartListening': snapshot={...snapshot,message:'The local helper is ready.',running:true};break;
 case 'Desktop.PauseListening': snapshot={...snapshot,message:'Listening paused.',running:false};break;
 }
 return {...snapshot};
}}}};
const read=()=>readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
const flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
 vm.runInNewContext(read(),{...context});await flush();
 assert.equal(document.documentElement.lang,'zh-CN');
 assert.equal(elements.listen.textContent,'开始监听');
 assert.equal(elements.language.disabled,false);
 elements.language.onchange({target:{value:'en'}});await flush();
 assert.deepEqual(calls.at(-1),['Desktop.SetLanguage','en']);
 assert.equal(document.documentElement.lang,'en');
 assert.equal(elements['status-region']['aria-label'],'Helper status');
 assert.equal(elements.listen.textContent,'Start listening');
 assert.equal(elements.status.textContent,'Listening paused.');
 assert.equal(labels.find(x=>x.dataset.label==='folderLabel').textContent,'Wake-word helper folder');
 elements.listen.onclick();await flush();
 assert.equal(elements.listen.textContent,'Pause listening');
 assert.equal(elements.chrome.textContent,'Waiting for the Chrome extension…');
 await tick();
 assert.equal(elements.language.value,'en');
 elements.listen.onclick();await flush();
 vm.runInNewContext(read(),{...context});await flush();
 assert.equal(document.documentElement.lang,'en');
 elements.language.onchange({target:{value:'zh'}});await flush();
 assert.equal(document.documentElement.lang,'zh-CN');
 assert.equal(elements.listen.textContent,'开始监听');
 console.log('Desktop localization passes: zh/en picker, accessibility, native state, recording controls, persisted reload mock.');
})().catch(e=>{console.error(e);process.exitCode=1});
