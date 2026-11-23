import assert from 'node:assert/strict';
const testUrl='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';
let stored={uiLanguage:'en',uiTheme:'dark',routes:[{phrase:'Hey莫去写作',type:'chat',url:testUrl}],wakeSendPhrase:'确认发送'};
let calls=[],listener, views=new Map(), status={connected:true,active:true,mode:'idle',wake:'口令已就绪。请说你为目标会话保存的口令。'};
const E=(kind='')=>({kind,children:[],dataset:{},attrs:{},value:'',checked:false,textContent:'',open:false,
 append(...els){this.children.push(...els)},replaceChildren(...els){this.children=[...els]},
 setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},
 showModal(){this.open=true},close(){this.open=false},
 querySelector(q){return this.children.flatMap(e=>[e,...e.children]).find(e=>'.'+e.className===q)}});
const get=id=>{if(!views.has(id))views.set(id,E());return views.get(id);};
globalThis.document={documentElement:E('html'),getElementById:get,createElement:E,createElementNS:(_,tag)=>E(tag),querySelectorAll:()=>[]};
globalThis.chrome={runtime:{onMessage:{addListener:f=>{listener=f}},sendMessage:async m=>{calls.push(m);return status}},storage:{local:{get:async()=>stored,set:async next=>{stored={...stored,...next}}}}};
await import('../panel.js');
assert.deepEqual(calls,[{type:'hey-desktop-status'}]);
assert.equal(document.documentElement.dataset.theme,'dark');
assert.equal(document.documentElement.lang,'en');
assert.equal(get('bridge-badge').textContent,'Helper connected');
assert.equal(get('route-list').children[0].children[1].textContent,'Hey莫去写作');
assert.equal(get('route-list').children[0].children[2].textContent,'Chat 1');
status={connected:true,active:true,officialSession:true,mode:'recording',wake:{key:'听到「{0}」，提示音后请说正文。',args:['Hey莫去写作']}};
listener({type:'hey-desktop-update',status});
assert.equal(get('main-action').textContent,'Finish segment');
assert.match(get('wake-status').textContent,/Heard “Hey莫去写作”/);
get('main-action').onclick();await Promise.resolve();
assert.deepEqual(calls.at(-1),{type:'hey-desktop-finish'});
const liveDraft=get('routes').children[0].querySelector('.phrase');
liveDraft.value='莫 open 写作';
get('ui-language').value='zh';get('ui-language').onchange();
assert.equal(get('routes').children[0].querySelector('.phrase').value,'莫 open 写作');
assert.equal(stored.routes[0].phrase,'Hey莫去写作');
status={connected:true,active:true,mode:'idle'};listener({type:'hey-desktop-update',status});
await get('save').onclick();
assert.equal(stored.routes[0].phrase,'莫 open 写作');
assert.equal(stored.uiTheme,'dark');
console.log('Desktop settings mock: lightweight UI works without running the listener; preference persistence, edited phrase, mixed route and live state verified.');
