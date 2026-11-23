
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chatUrl,checkRoutes,capture,fillDraft} from '../core.js';
const a='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc', b='https://chatgpt.com/g/g-p-abc/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const routes=checkRoutes([{phrase:'莫去写作',type:'chat',url:a+'?x=2'},{phrase:'莫去开发',type:'chat',url:b},{phrase:'莫记一下',type:'note'}]);
assert.equal(chatUrl(a+'/#test'),a);
assert.throws(()=>chatUrl('https://chatgpt.com/share/abc'));
assert.throws(()=>chatUrl(a.replace('chatgpt.com','chatgpt.com.evil.test')));
assert.throws(()=>chatUrl(a.replace('chatgpt.com','x@chatgpt.com')));
assert.throws(()=>checkRoutes([routes[0],{...routes[0],phrase:'莫，去写作'}]));
assert.deepEqual(capture('莫，去写作，试一下第二幕',routes,undefined,0).action,{route:routes[0],body:'试一下第二幕'});
assert.deepEqual(capture('莫去开发。改一下窗口',routes,undefined,0).action,{route:routes[1],body:'改一下窗口'});
assert.equal(capture('之前说了莫去写作',routes,undefined,0).action,undefined);
assert.equal(capture('莫记一下，刀回收',routes,undefined,0).action.route.type,'note');
const p=capture('莫去开发',routes,undefined,0).pending;
assert.equal(capture('修输入框',routes,p,7999).action.route.url,b);
assert.equal(capture('修输入框',routes,p,8001).action,undefined);
assert.equal(capture('取消。',routes,p,500).action,undefined);
const form={querySelector:()=>null};
let region={value:'',innerText:'',getClientRects:()=>[1],closest:s=>s === '[inert]' ? null : form,querySelector:()=>null,
  dispatchEvent(event){writes++;this.value=event.clipboardData.getData('text/plain');},
  focus(){assert.fail('background drafts must not focus the editor');}
};
globalThis.location=new URL(a);
let writes=0;
globalThis.DataTransfer=class {setData(k,v){this[k]=v;}getData(k){return this[k];}};
globalThis.ClipboardEvent=class {constructor(type,options){assert.equal(type,'paste');Object.assign(this,options);}};
globalThis.document={visibilityState:'hidden',querySelectorAll:s=>s.includes('[data-composer-markdown][contenteditable="true"][role="textbox"]') && region ? [region] : []};
assert.equal(fillDraft(b,'foo').state,'wrong');
assert.equal(writes,0);
assert.equal(fillDraft(a,'foo').state,'filled');
assert.equal(region.value,'foo');
assert.equal(fillDraft(a,'bar').state,'occupied');
assert.equal(writes,1);
region.value='';form.querySelector=()=>true;
assert.equal(fillDraft(a,'bar').state,'occupied');
region.value='';form.querySelector=()=>null;
region.dispatchEvent=()=>{};
assert.equal(fillDraft(a,'baz').state,'uncertain');
assert.equal(writes,1);
region=null;
assert.equal(fillDraft(a,'bar').state,'waiting');
const manifest=JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));
assert.deepEqual(manifest.host_permissions,['https://chatgpt.com/*','http://127.0.0.1/*']);
console.log('Routing, background paste, draft safety and permissions assertions passed');
