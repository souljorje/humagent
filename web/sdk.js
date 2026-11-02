import {selector, context, isNativeInteractiveControl} from './vendor/targets.js';
import {buildContext} from './vendor/anchors.js';

const boot=window.__HUMAGENT__;
if(!boot||window.parent===window)throw new Error('Humagent SDK requires an attached workspace');
let mode='interact',state={},stateVersion=0,initialized=false,ended=false,resolveReady;
const ready=new Promise(resolve=>{resolveReady=resolve;});
const pending=new Map();let serial=Promise.resolve();const timers=new Map();
const send=(method,params={},id)=>parent.postMessage({humagent:1,channel:boot.channel,method,params,id,revision:boot.revision},boot.parentOrigin);
const clone=value=>JSON.parse(JSON.stringify(value));
function request(method,params) {
  if(ended)return Promise.reject(new Error('Review session has ended'));
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Workspace did not confirm the request. Check its pending inputs.'));},15000);pending.set(id,{resolve,reject,timer});send(method,params,id);});
}
function notice(message) {send('notice',{message});}
function setState(patch) {
  const operation=serial.catch(()=>{}).then(async()=>{
    await ready;
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('setState expects an object');
    const result=await request('state',{state:{...state,...clone(patch)},expectedVersion:stateVersion});
    state=result.state;stateVersion=result.stateVersion;return clone(state);
  });serial=operation;return operation;
}
async function submit(value) {
  await ready;
  return request('submit',{kind:'submission',payload:clone(value)});
}
window.humagent=Object.freeze({ready,submit,getState:()=>clone(state),setState,
  on(type,handler){const fn=e=>handler(e.detail);window.addEventListener(`humagent:${type}`,fn);return()=>window.removeEventListener(`humagent:${type}`,fn);}});

function controls(form) {return [...form.elements].filter(el=>el.name&&!el.matches(':disabled')&&['INPUT','TEXTAREA','SELECT'].includes(el.tagName)&&!['password','file','hidden','submit','button','reset','image'].includes(el.type));}
export function formValues(form) {
  const result=Object.create(null),groups=new Map();
  for(const el of controls(form)){if(['__proto__','prototype','constructor'].includes(el.name))throw new Error('Reserved field name');const group=groups.get(el.name)||[];group.push(el);groups.set(el.name,group);}
  for(const [name,group] of groups) {
    if(group.every(el=>el.type==='checkbox'))result[name]=group.length===1?group[0].checked:group.filter(el=>el.checked).map(el=>el.value);
    else if(group.every(el=>el.type==='radio'))result[name]=group.find(el=>el.checked)?.value??null;
    else {const values=group.flatMap(el=>el.tagName==='SELECT'&&el.multiple?[...el.selectedOptions].map(o=>o.value):[el.value]);result[name]=group.length===1&&!group[0].multiple?values[0]:values;}
  }
  return result;
}
function persistedForms(){return [...document.querySelectorAll('form[data-humagent-intent][data-humagent-persist][id]')];}
function restoreForms() {
  for(const form of persistedForms()) {
    const values=state.forms?.[form.id];if(!values)continue;
    const seen=new Map();
    for(const el of controls(form)) {
      const value=values[el.name];if(value===undefined)continue;
      if(el.type==='checkbox')el.checked=Array.isArray(value)?value.includes(el.value):value===true;
      else if(el.type==='radio')el.checked=value===el.value;
      else if(el.multiple){for(const option of el.options)option.selected=Array.isArray(value)&&value.includes(option.value);}
      else if(Array.isArray(value)){const index=seen.get(el.name)||0;el.value=value[index]??'';seen.set(el.name,index+1);}
      else el.value=value??'';
    }
  }
}
function persist(form) {
  clearTimeout(timers.get(form));timers.delete(form);
  // Capture now, merge after earlier saves complete; never snapshot stale form maps.
  const values=formValues(form);
  const operation=serial.catch(()=>{}).then(async()=>{
    await ready;const result=await request('state',{state:{...state,forms:{...(state.forms||{}),[form.id]:values}},expectedVersion:stateVersion});
    state=result.state;stateVersion=result.stateVersion;
  });serial=operation;return operation;
}
async function flush(){for(const form of [...timers.keys()])await persist(form);await serial;}
function status(form,message) {
  let output=form.querySelector('[data-humagent-status]');
  if(!output){output=document.createElement('output');output.dataset.humagentStatus='';output.dataset.humagentUi='';output.setAttribute('role','status');form.append(output);}
  output.textContent=message;
}
document.addEventListener('input',event=>{
  const form=event.target.closest?.('form[data-humagent-intent][data-humagent-persist][id]');if(!form)return;
  clearTimeout(timers.get(form));timers.set(form,setTimeout(()=>persist(form).catch(e=>notice(e.message)),250));
});
document.addEventListener('change',event=>{
  const form=event.target.closest?.('form[data-humagent-intent][data-humagent-persist][id]');if(form){clearTimeout(timers.get(form));timers.set(form,setTimeout(()=>persist(form).catch(e=>notice(e.message)),50));}
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.matches?.('form[data-humagent-intent]'))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(form.dataset.humagentSending)return;form.dataset.humagentSending='true';
  try{await flush();status(form,'Sending to the agent…');await submit({intent:form.dataset.humagentIntent,message:form.dataset.humagentMessage||'',values:formValues(form)});status(form,'Queued for the agent.');}
  catch(e){status(form,e.message);notice(e.message);}finally{delete form.dataset.humagentSending;}
},true);

// Selection UI does not mutate the application's elements or styles.
const overlay=document.createElement('div');overlay.dataset.humagentUi='';
const shadow=overlay.attachShadow({mode:'open'});
shadow.innerHTML='<style>:host{all:initial}.box{position:fixed;border:2px solid #0e8d83;background:#0e8d8312;border-radius:3px;pointer-events:none;z-index:2147483646;display:none}</style><div class="box"></div>';
(document.body||document.documentElement).append(overlay);const box=shadow.querySelector('.box');
function ignored(el){return !(el instanceof Element)||el.closest('[data-humagent-ui],script,style')||el===document.body||el===document.documentElement;}
function highlight(el){if(mode==='interact'||ignored(el)){box.style.display='none';return;}const r=el.getBoundingClientRect();Object.assign(box.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});}
document.addEventListener('pointermove',e=>highlight(e.target),true);
let selectedByDrag=false;
function selected(target,quote,anchor) {
  const before=quote??(target.innerText||target.textContent||'').trim();
  if(before.length>50000){notice('Select a smaller section (maximum 50,000 characters).');return;}
  send('selected',{target:{...context(target),url:boot.sourceUrl,...(anchor?{anchor}:{})},before,
    editable:!isNativeInteractiveControl(target),mode});
}
document.addEventListener('mouseup',e=>{
  if(mode==='interact'||ignored(e.target))return;
  const selection=document.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount)return;
  const range=selection.getRangeAt(0);const quote=range.toString();if(!quote.trim())return;
  const prefix=range.cloneRange();prefix.selectNodeContents(document.body);prefix.setEnd(range.startContainer,range.startOffset);
  const suffix=range.cloneRange();suffix.selectNodeContents(document.body);suffix.setStart(range.endContainer,range.endOffset);
  const before=prefix.toString().slice(-32),after=suffix.toString().slice(0,32);
  const el=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
  selectedByDrag=true;selected(el,quote,buildContext(before+quote+after,before.length,before.length+quote.length));
},true);
document.addEventListener('click',e=>{
  if(mode==='interact'||ignored(e.target)||e.ctrlKey||e.metaKey)return;
  e.preventDefault();e.stopImmediatePropagation();if(selectedByDrag){selectedByDrag=false;return;}selected(e.target);
},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){mode='interact';box.style.display='none';send('mode',{mode});}},true);

window.addEventListener('message',async event=>{
  const data=event.data;if(event.source!==parent||event.origin!==boot.parentOrigin||data?.humagent!==1||data.channel!==boot.channel)return;
  if(data.method==='result') {
    const call=pending.get(data.id);if(!call)return;pending.delete(data.id);clearTimeout(call.timer);
    if(data.error)call.reject(new Error(data.error));else call.resolve(data.result);return;
  }
  if(data.method==='init') {
    mode=data.params.mode||'interact';ended=!!data.params.ended;state=data.params.state||{};stateVersion=data.params.stateVersion||0;
    if(!initialized){initialized=true;clearInterval(hello);restoreForms();resolveReady();window.dispatchEvent(new CustomEvent('humagent:ready'));}return;
  }
  if(data.method==='mode'){mode=data.params.mode;box.style.display='none';return;}
  if(data.method==='ended'){ended=true;mode='interact';box.style.display='none';return;}
  if(data.method==='reply')window.dispatchEvent(new CustomEvent('humagent:reply',{detail:data.params}));
  if(data.method==='flush'){try{await flush();send('flushed',{ok:true},data.id);}catch(e){send('flushed',{error:e.message},data.id);}}
});
const hello=setInterval(()=>send('hello'),1000);send('hello');
