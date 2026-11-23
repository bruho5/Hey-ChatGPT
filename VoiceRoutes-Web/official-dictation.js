// Injected in Chrome's isolated world; no network, microphone access, or submit calls here.
export async function officialDictation(expected, action, ticket, priorDraftTicket=null, maxRecordingMs=null, allowTextAppend=false) {
  const exact=()=>location.origin+location.pathname.replace(/\/$/,'')===expected;
  const key='__voiceRoutesOfficialDictation';
  const memory=globalThis[key]??=(Object.create(null));
  const selector='button[data-dictation-button]';
  const editors='[data-composer-markdown][contenteditable="true"], #prompt-textarea';
  const visible=e=>e?.getClientRects().length && !e.closest('[hidden],[inert]');
  const available=e=>visible(e) && !e.disabled && e.getAttribute('aria-disabled')!=='true' && e.getAttribute('aria-busy')!=='true';
  const text=e=>e?.value ?? e?.innerText ?? e?.textContent ?? '';
  const read=e=>text(e).replace(/[\u200b\u00a0]/g,' ').trim();
  const snapshot=e=>JSON.stringify([e.value??null,e.innerText??null,e.textContent??null,e.innerHTML??null]);
  const find=()=>[...document.querySelectorAll('[data-composer-trailing-controls] '+selector)].filter(visible);
  const getEditor=()=>{
    const matches=[...document.querySelectorAll(editors)].filter(visible);
    return matches.length===1 ? matches[0] : null;
  };
  const getComposer=e=>e?.closest('form, [data-testid="composer"]') ?? e?.closest('fieldset');
  const hasAttachment=(editor,composer)=>editor.querySelector('img,[contenteditable="false"]') ||
    composer.querySelector('[data-testid="remove-attachment-button"],button[aria-label^="Remove attachment"],button[aria-label^="移除附件"],[data-testid="stop-button"]');
  const recordingControls=()=>[...document.querySelectorAll('button[data-dictation-button="dictating"]')].filter(visible);
  const stopButton=()=>{
    const playing=recordingControls();
    if(playing.length!==1)return null;
    const b=playing[0];
    const label=(b.getAttribute('aria-label')??'').trim();
    return b.closest('[data-composer-trailing-controls]') ||
      /^(停止听写|停止聽寫|Stop dictation)$/i.test(label) ? b : null;
  };
  const result=(state,reason)=>reason?{state,reason}:{state};
  const samePage=s=>exact() && s?.doc===document && s.href===location.href;
  const forgetDraft=()=>{
    memory.draft?.dispose();
    delete memory.draft;
  };
  const removeRecorder=s=>{
    s.disarm?.();
    if(memory.recording===s) delete memory.recording;
  };
  if(!exact()) {
    forgetDraft();
    memory.recording?.disarm?.();
    return result('wrong');
  }
  const buttons=find();
  const button=buttons.length===1 ? buttons[0] : null;
  const phase=button?.getAttribute('data-dictation-button');
  let session;
  if(action==='start'){
    const editor=getEditor(), composer=getComposer(editor);
    if(!editor || !button || !composer?.contains(button.closest('[data-composer-trailing-controls]'))) return result('unavailable');
    if(phase!=='idle' || !available(button) || recordingControls().length || memory.settling) return result('unavailable');
    if(memory.recording) {
      if(memory.recording.pending) return result('unavailable');
      removeRecorder(memory.recording);
    }
    const owner=memory.draft;
    // Flush a pending mutation synchronously as well as observing already-delivered mutations.
    const priorMatches=priorDraftTicket!==null && owner?.ticket===priorDraftTicket && owner.expected===expected &&
      samePage(owner) && owner.editor===editor && !owner.hasChanges() &&
      snapshot(editor)===owner.snapshot && !!read(editor);
    const occupied=hasAttachment(editor,composer) || (!allowTextAppend && (priorDraftTicket===null ? !!read(editor) : !priorMatches));
    forgetDraft();
    if(occupied) return result('occupied');
    session={ticket,expected,doc:document,href:location.href,before:snapshot(editor),beforeText:text(editor),hadText:!!read(editor),confirmed:false,pending:true};
    memory.recording=session;
    button.click();
  } else if(action==='stop'){
    session=memory.recording;
    if(session?.ticket!==ticket || session.expected!==expected) return result('not-ours');
    if(!samePage(session)) {removeRecorder(session);return result('wrong');}
    const stop=stopButton();
    if(!stop || !available(stop)) {
      if(!recordingControls().length && phase==='idle' && available(button) && getEditor()) {removeRecorder(session);return result('already-ended');}
      return result('unavailable',stop?'disabled':recordingControls().length?'ambiguous':'missing');
    }
    if(!session.ownsRecorder?.(stop)) {removeRecorder(session);return result('not-ours');}
    removeRecorder(session);
    forgetDraft();
    memory.settling=session;
    // This is the square Stop dictation button, not the arrow that sends.
    stop.click();
  } else return result('unavailable');
  return new Promise(resolve=>{
    let timer, quietTimer, candidate, userEdited=false;
    const onUserEdit=event=>{if(event.isTrusted && (event.target===getEditor() || getEditor()?.contains(event.target)))userEdited=true;};
    const finish=state=>{
      clearTimeout(timer);clearTimeout(quietTimer);observer.disconnect();
      document.removeEventListener?.('beforeinput',onUserEdit,true);
      session.pending=false;
      if(memory.settling===session)delete memory.settling;
      resolve(allowTextAppend && state==='recording' ? {...result(state),hadText:session.hadText} : result(state));
    };
    const currentDraft=()=>{
      if(recordingControls().length || userEdited) return null;
      const editor=getEditor(), composer=getComposer(editor);
      if(!editor || !composer || hasAttachment(editor,composer)) return null;
      const current=text(editor), snap=snapshot(editor);
      // Official dictation must actually add text. Do not mistake the existing draft for a result
      // or silently recover by rewriting the user's draft if ChatGPT replaces it.
      const previous=session.beforeText;
      if(!read(editor) || snap===session.before || current.trim()===previous.trim() ||
        (previous.trim() && !current.startsWith(previous))) return null;
      return {editor,snapshot:snap};
    };
    const observeRecording=recorder=>{
      let cutoff, observer, lost=false;
      const disarm=()=>{
        clearTimeout(cutoff);
        observer.disconnect();
        recorder.removeEventListener?.('click',onClick,true);
      };
      const invalidate=()=>{lost=true;disarm();};
      const onClick=event=>{if(event.isTrusted)invalidate();};
      const valid=()=>!lost && memory.recording===session && samePage(session) && stopButton()===recorder;
      const interrupted=records=>records.some(m=>
        (m.target===recorder && m.type==='attributes' && m.attributeName==='data-dictation-button' && m.oldValue!=='dictating') ||
        (m.type==='childList' && [...m.removedNodes].some(n=>n===recorder || n.contains?.(recorder))));
      const onMutation=records=>{if(!valid() || interrupted(records))invalidate();};
      observer=new MutationObserver(onMutation);
      observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeOldValue:true});
      recorder.addEventListener?.('click',onClick,true);
      session.disarm=invalidate;
      session.ownsRecorder=button=>button===recorder && valid() && !interrupted(observer.takeRecords());
      if(!Number.isFinite(maxRecordingMs) || maxRecordingMs<=0) return;
      cutoff=setTimeout(()=>{
        const stopNow=valid() && !interrupted(observer.takeRecords()) && available(recorder);
        disarm();
        if(!stopNow)return;
        // The cutoff only bounds recording. It never issues a continuation ticket.
        removeRecorder(session);
        recorder.click();
      },Math.min(maxRecordingMs,60000));
    };
    const remember=current=>{
      const editor=current.editor;
      const composer=getComposer(editor);
      let userChanged=false, domChanged=false;
      // Capture actual text, not ProseMirror's transient markup, styling or DOM node identity.
      const textValue=e=>{
        const render=n=>n.nodeName==='BR'
          ? (n.classList?.contains('ProseMirror-trailingBreak')?'':'\n')
          : n.nodeType===3 ? n.nodeValue : [...(n.childNodes??[])].map(render).join('');
        const nodes=[...(e.childNodes??[])];
        const content=nodes.length && nodes.every(n=>['P','DIV'].includes(n.nodeName))
          ? nodes.map(render).join('\n') : null;
        return (e.value??content??e.innerText??e.textContent??'')
          .replace(/\r\n/g,'\n').replace(/\u00a0/g,' ').trim();
      };
      const confirmedText=textValue(editor);
      const events=['beforeinput','input','paste','drop','cut','compositionstart'];
      const onEdit=event=>{
        if(!event.isTrusted)return;
        const active=getEditor();
        const target=event.target;
        if(active && (target===active || active.contains?.(target))) userChanged=true;
      };
      const affectsContent=record=>record.type!=='attributes' || record.target!==editor ||
        ['contenteditable','value'].includes(record.attributeName);
      const ownership=new MutationObserver(records=>{if(records.some(affectsContent))domChanged=true;});
      const owner={...current,ticket,expected,doc:document,href:location.href,
        hasChanges:()=>userChanged||domChanged||ownership.takeRecords().some(affectsContent),
        matchesEditor:active=>!!confirmedText && !userChanged && active===getEditor() &&
          !!composer && getComposer(active)===composer && textValue(active)===confirmedText,
        dispose:()=>{
          ownership.disconnect();
          for(const event of events) document.removeEventListener?.(event,onEdit,true);
        }};
      ownership.observe(editor,{subtree:true,childList:true,characterData:true,attributes:true});
      for(const event of events) document.addEventListener?.(event,onEdit,true);
      forgetDraft();
      memory.draft=owner;
    };
    const check=()=>{
      if(!samePage(session)) {
        if(action==='start')removeRecorder(session);
        return finish('wrong');
      }
      if(action==='start'){
        const recorder=stopButton();
        if(recorder){
          session.confirmed=true;
          observeRecording(recorder);
          return finish('recording');
        }
        return;
      }
      const current=currentDraft();
      if(!current){
        candidate=null;
        clearTimeout(quietTimer);
        return;
      }
      if(candidate?.editor===current.editor && candidate.snapshot===current.snapshot) return;
      candidate=current;
      clearTimeout(quietTimer);
      quietTimer=setTimeout(()=>{
        if(!samePage(session))return finish('wrong');
        const settled=currentDraft();
        if(settled?.editor!==current.editor || settled.snapshot!==current.snapshot) {candidate=null;return check();}
        if(session.confirmed)remember(settled);
        finish(session.confirmed?'draft':'stopped-no-draft');
      },320);
    };
    const observer=new MutationObserver(check);
    if(action==='stop')document.addEventListener?.('beforeinput',onUserEdit,true);
    observer.observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});
    timer=setTimeout(()=>finish(action==='start'?'start-uncertain':recordingControls().length?'still-recording':'stopped-no-draft'),action==='start'?4500:16000);
    check();
  });
}
