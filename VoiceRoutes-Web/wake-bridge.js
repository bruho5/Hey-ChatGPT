const endpoint = 'http://127.0.0.1:18765';
export function stopReason(segment, now) {
  if(now - segment.started >= 45000) return 'limit';
  if(segment.lastVoice != null && now - segment.lastVoice >= 2000) return 'silence';
  if(segment.lastVoice == null && now - segment.started >= 9000) return 'no-speech';
}
export class WakeBridge {
  constructor({wake, stop, status, isRecording, onAudio=()=>{}, command=()=>{}, now=Date.now, request=(...args)=>globalThis.fetch(...args)}){
    Object.assign(this,{wake,stop,status,isRecording,onAudio,command,now,request});
    this.generation=0;
    this.active=false;this.connected=false;
  }
  start(token,routes){
    if(this.active || !/^[A-Za-z0-9_-]{20,128}$/.test(token) || !routes?.length)return false;
    this.active=true;this.token=token;this.cursor=null;this.segment=null;
    this.routeById=new Map(routes.map(r=>[r.id,r]));
    const gen=++this.generation;
    this.status('正在连接本机口令助手…');
    void this.configure(gen,routes);
    return true;
  }
  disconnect(message='口令监听已断开。'){
    this.active=false;this.connected=false;this.token=null;this.segment=null;
    ++this.generation;
    clearTimeout(this.timer);this.requestAbort?.abort();
    this.status(message);
    if(this.isRecording()) void this.stop('disconnect');
  }
  async post(path,payload,signal){
    const response=await this.request(endpoint+path,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:this.token,...payload}),
      credentials:'omit',cache:'no-store',redirect:'error',signal
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw Error(response.status===401?'配对码不对，或助手已重启。':response.status===403?'助手拒绝了浏览器连接。':
      (response.status===400&&typeof data?.error==='string' ? data.error.slice(0,240) : '本机助手未能处理请求。'));
    return data;
  }
  async configure(gen,routes){
    const ac=new AbortController(); this.requestAbort=ac;
    const timer=setTimeout(()=>ac.abort(),8000);
    try{
      const data=await this.post('/configure',{routes},ac.signal);
      if(!this.active || gen!==this.generation)return;
      if(data?.ok!==true || (routes.some(r=>r.intent==='send') && data.sendGuard!==true) || !Number.isSafeInteger(data.cursor) || data.cursor<0) throw Error('本机助手版本不匹配，请更新并重启助手。');
      this.cursor=data.cursor;this.connected=true;
      this.status('口令已就绪。请说你为目标会话保存的口令。');
      void this.poll(gen);
    }catch(e){
      if(this.active && gen===this.generation)this.disconnect(e?.name==='AbortError'?'加载口令超时，已暂停。':e.message||'加载口令失败。');
    }finally{
      clearTimeout(timer);
      if(this.requestAbort===ac)this.requestAbort=null;
    }
  }
  async poll(gen){
    const current=()=>this.active && gen===this.generation;
    if(!current())return;
    const ac=new AbortController();this.requestAbort=ac;
    const timeout=setTimeout(()=>ac.abort(),1750);
    try{
      const data=await this.post('/events',{after:this.cursor},ac.signal);
      if(!current())return;
      if(data?.connected!==true || !Number.isSafeInteger(data.cursor) || data.cursor<0 || !Array.isArray(data.events) || data.events.length>256)throw Error('本机助手返回了不兼容的数据。');
      const before=this.cursor;this.cursor=data.cursor;
      if(data.cursor<before){
        throw Error('本机助手的连接已重置。');
      }else{
        let prev=before;
        for(const event of data.events) {
          if(!Number.isSafeInteger(event?.id)||event.id<=prev||event.id>data.cursor)continue;
          prev=event.id;
          if(!Number.isFinite(event.at)||Math.abs(this.now()-event.at)>1800)continue;
          this.accept(event,gen);
        }
      }
      if(this.segment && this.isRecording()){
        const reason=stopReason(this.segment,this.now());
        if(reason){this.segment=null;void this.stop(reason);}
      }
    }catch(e){
      if(current())this.disconnect(e?.name==='AbortError'?'口令助手连接超时，已暂停。':(e.message||'口令监听已暂停。'));
    }finally{
      clearTimeout(timeout);
      if(this.requestAbort===ac)this.requestAbort=null;
      if(current()) this.timer=setTimeout(()=>void this.poll(gen),230);
    }
  }
  accept(event,gen){
    if(event.type==='audio'){
      if(typeof event.speech!=='boolean')return;
      this.onAudio(event.speech);
      if(event.speech && this.segment){
        const t=Number.isFinite(event.at)?Math.min(event.at,this.now()):this.now();
        if(t>=this.segment.started+250)
          this.segment.lastVoice=Math.max(this.segment.lastVoice??0,t);
      }
      return;
    }
    const route=this.routeById?.get(event.routeId);
    if(event.type!=='wake' || !route || route.text!==event.phrase || this.launch || this.isRecording())return;
    if(route.intent==='send'){this.command(event);return;}
    const launch={};this.launch=launch;
    void (async()=>{
      try{
        if(await this.wake(event.routeId,event.phrase)){
          if(!this.active || gen!==this.generation) {if(this.isRecording())void this.stop('disconnect');return;}
          this.segment={started:this.now(),lastVoice:null};
        }
      }finally{ if(this.launch===launch)this.launch=null; }
    })().catch(()=>{if(this.active && gen===this.generation)this.disconnect('口令处理失败，已暂停。');});
  }
  clearSegment(){this.segment=null;}
}
