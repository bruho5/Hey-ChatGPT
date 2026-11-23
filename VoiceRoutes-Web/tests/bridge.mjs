import assert from 'node:assert/strict';
import {stopReason,WakeBridge} from '../wake-bridge.js';
assert.equal(stopReason({started:0,lastVoice:null},8999),undefined);
assert.equal(stopReason({started:0,lastVoice:null},9000),'no-speech');
assert.equal(stopReason({started:0,lastVoice:7000},8999),undefined);
assert.equal(stopReason({started:0,lastVoice:7000},9000),'silence');
assert.equal(stopReason({started:0,lastVoice:44000},45000),'limit');
let recording=false, now=0, requests=[];
const calls=[];
const bridge=new WakeBridge({
  now:()=>now,isRecording:()=>recording,status:()=>{},
  wake:async (id,p)=>{calls.push([id,p]);recording=true;return true;},
  stop:async r=>{calls.push(r);recording=false;},
  request:async (url,init)=>{
    requests.push([url,JSON.parse(init.body)]);
    return Response.json(url.endsWith('/configure')?{ok:true,cursor:21}:{connected:true,cursor:23,events:[
      {type:'wake',routeId:'r1',phrase:'Open Writing',id:22,at:now},
      {type:'wake',routeId:'r9',phrase:'莫发送',id:23,at:now}
    ]});
  }
});
assert.equal(bridge.start('abcdefghijklmnopqrstuvwxyz012345', [{id:'r1',text:'Open Writing'}]),true);
await new Promise(r=>setTimeout(r,30));
assert.equal(requests.length,2);
assert.equal(requests[1][1].after,21);
assert.deepEqual(calls,[['r1','Open Writing']]);
now=500;
bridge.accept({type:'audio',speech:true,at:500},bridge.generation);
assert.equal(bridge.segment.lastVoice,500);
bridge.accept({type:'wake',routeId:'r1',phrase:'Open Writing'},bridge.generation);
assert.equal(calls.length,1);
bridge.disconnect();
assert.equal(calls.at(-1),'disconnect');
assert.equal(bridge.token,null);
console.log('Wake bridge configuration, cursor, exact route ID, no send, audio timing and disconnect pass.');
