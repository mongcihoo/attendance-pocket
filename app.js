'use strict';

const DB_NAME = 'attendance-pocket-db';
const DB_VERSION = 1;
const APP_VERSION = '1.3.0-pwa.9';
const STORES = ['people', 'places', 'tasks', 'records', 'meta'];
let db;
let state = { people: [], places: [], tasks: [], records: [], activePersonId: '', month: new Date(), selectedDate: localDate(new Date()) };
let textAction = null;
let serviceWorkerRegistration = null;
let waitingServiceWorker = null;
let reloadingForUpdate = false;
let selectedRecordDates = [];

const $ = id => document.getElementById(id);
const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function localDate(date) { const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
function localTime(date) { return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`; }
function parseDate(value) { const [y,m,d]=value.split('-').map(Number); return new Date(y,m-1,d); }
function formatDate(value, withYear=true) { const d=parseDate(value); return new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',weekday:'short',...(withYear?{year:'numeric'}:{})}).format(d); }
function weekday(value){ return ['日','一','二','三','四','五','六'][parseDate(value).getDay()]; }
function byId(list,id){ return list.find(x=>x.id===id); }
function normalizeName(value){ return value.trim().replace(/\s+/g,' '); }
function monthRange(date){ const y=date.getFullYear(),m=date.getMonth(); return [localDate(new Date(y,m,1)),localDate(new Date(y,m+1,0))]; }
function periodLabel(period){ return {am:'上午',pm:'下午',full:'全天'}[period] || period; }
function coversPeriod(recordPeriod,period){ return recordPeriod===period || recordPeriod==='full'; }
function periodDots(period){ return period==='full'?'<span class="full-dots"><i class="dot am"></i><i class="dot pm"></i></span>':`<i class="dot ${period}"></i>`; }

function openDB(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{ const d=request.result; STORES.forEach(name=>{ if(!d.objectStoreNames.contains(name)) d.createObjectStore(name,{keyPath:'id'}); }); };
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
}
function getAll(store){ return new Promise((resolve,reject)=>{ const r=db.transaction(store).objectStore(store).getAll(); r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); }); }
function put(store,value){ return new Promise((resolve,reject)=>{ const r=db.transaction(store,'readwrite').objectStore(store).put(value);r.onsuccess=()=>resolve(value);r.onerror=()=>reject(r.error); }); }
function putMany(store,values){ return new Promise((resolve,reject)=>{ const transaction=db.transaction(store,'readwrite'),objectStore=transaction.objectStore(store); values.forEach(value=>objectStore.put(value)); transaction.oncomplete=()=>resolve(values);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error); }); }
function remove(store,id){ return new Promise((resolve,reject)=>{ const r=db.transaction(store,'readwrite').objectStore(store).delete(id);r.onsuccess=resolve;r.onerror=()=>reject(r.error); }); }
function clearStore(store){ return new Promise((resolve,reject)=>{ const r=db.transaction(store,'readwrite').objectStore(store).clear();r.onsuccess=resolve;r.onerror=()=>reject(r.error); }); }
async function loadState(){
  const [people,places,tasks,records,meta]=await Promise.all(STORES.map(getAll));
  state.people=people.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)); state.places=places; state.tasks=tasks; state.records=records;
  const active=meta.find(x=>x.id==='activePerson'); state.activePersonId=active?.value || people[0]?.id || '';
}
async function seed(){
  if(state.people.length) return;
  const now=new Date().toISOString();
  await put('people',{id:uid('person'),name:'我',createdAt:now});
  await loadState(); await setActivePerson(state.people[0].id);
}
async function setActivePerson(id){ state.activePersonId=id; await put('meta',{id:'activePerson',value:id}); renderAll(); }

function toast(message){ const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),1800); }
function showView(name, historyMode='none'){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`${name}View`));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===name));
  $('pageTitle').textContent={records:'记录',calendar:'月历',stats:'统计',settings:'设置'}[name];
  $('quickAdd').classList.toggle('hidden',name==='settings'); window.scrollTo({top:0,behavior:'smooth'});
  if(name==='calendar') renderCalendar(); if(name==='stats') renderStats(); if(name==='settings') renderSettings();
  if(historyMode==='push' && history.state?.view!==name) history.pushState({view:name},'',`#${name}`);
}
function personOptions(includeAll=false,selected=''){ return `${includeAll?'<option value="">全部人员</option>':''}${state.people.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}`; }
function vocabOptions(list,includeAll=false,selected=''){ return `${includeAll?'<option value="">全部</option>':''}${list.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}`; }
function recordLabel(record){ return `${byId(state.places,record.placeId)?.name || '未知地点'} · ${byId(state.tasks,record.taskId)?.name || '未知内容'}`; }
function filteredRecords(personId=state.activePersonId,start='',end=''){ return state.records.filter(r=>(!personId||r.personId===personId)&&(!start||r.date>=start)&&(!end||r.date<=end)).sort((a,b)=>b.date.localeCompare(a.date)||b.period.localeCompare(a.period)||b.createdAt.localeCompare(a.createdAt)); }

function renderAll(){
  $('activePerson').innerHTML=personOptions(false,state.activePersonId); $('statsPerson').innerHTML=personOptions(true,$('statsPerson').value);
  $('statsPlace').innerHTML=vocabOptions(state.places,true,$('statsPlace').value); $('statsTask').innerHTML=vocabOptions(state.tasks,true,$('statsTask').value);
  renderRecords(); renderCalendar(); renderStats(); renderSettings();
}
function renderRecords(){
  const today=localDate(new Date()), dayRecords=filteredRecords(state.activePersonId,today,today);
  $('todayDots').innerHTML=['am','pm'].map(period=>`<span class="session-pill ${dayRecords.some(r=>coversPeriod(r.period,period))?'done':''}"><i class="dot ${dayRecords.some(r=>coversPeriod(r.period,period))?period:''}"></i>${periodLabel(period)}</span>`).join('');
  const records=filteredRecords(state.activePersonId,$('listStart').value,$('listEnd').value); $('recordCountText').textContent=`${records.length} 条记录`;
  renderRecordCards($('recordList'),records,true);
}
function renderRecordCards(container,records,showDate){
  if(!records.length){ container.innerHTML='<div class="empty"><strong>还没有记录</strong>点击“记一笔”开始记录上午、下午或全天的工作。</div>'; return; }
  container.innerHTML=records.map(r=>`<button class="record-card" data-record="${r.id}" type="button"><div class="date-tile"><strong>${parseDate(r.date).getDate()}</strong><small>周${weekday(r.date)}</small></div><div class="record-main"><strong>${escapeHtml(recordLabel(r))}</strong><span>${showDate?formatDate(r.date):byId(state.people,r.personId)?.name||''}${r.notes?` · ${escapeHtml(r.notes)}`:''}</span></div><div class="record-meta"><strong>${Number(r.hours).toFixed(2).replace(/\.00$/,'')}h</strong><small>${periodDots(r.period)}${periodLabel(r.period)} ${r.time}</small></div></button>`).join('');
  container.querySelectorAll('[data-record]').forEach(button=>button.addEventListener('click',()=>openRecord(button.dataset.record)));
}

function renderCalendar(){
  const month=state.month,y=month.getFullYear(),m=month.getMonth(),first=new Date(y,m,1),start=new Date(y,m,1-((first.getDay()+6)%7));
  $('monthTitle').textContent=`${y}年${m+1}月`; const [from,to]=monthRange(month); const monthRecords=filteredRecords('',from,to); const days=new Set(monthRecords.map(r=>r.date)); $('monthSummary').textContent=`${days.size} 个有记录日期 · ${monthRecords.length} 条记录`;
  $('calendarGrid').innerHTML=Array.from({length:42},(_,i)=>{ const d=new Date(start);d.setDate(start.getDate()+i);const key=localDate(d),rs=state.records.filter(r=>r.date===key);return `<button class="calendar-day ${d.getMonth()!==m?'outside':''} ${key===localDate(new Date())?'today':''} ${key===state.selectedDate?'selected':''}" data-date="${key}" type="button"><span>${d.getDate()}</span><span class="day-dots">${rs.some(r=>coversPeriod(r.period,'am'))?'<i class="dot am"></i>':'<i></i>'}${rs.some(r=>coversPeriod(r.period,'pm'))?'<i class="dot pm"></i>':''}</span></button>`;}).join('');
  $('calendarGrid').querySelectorAll('[data-date]').forEach(button=>button.addEventListener('click',()=>{state.selectedDate=button.dataset.date;state.month=parseDate(state.selectedDate);renderCalendar();}));
  const selected=filteredRecords('',state.selectedDate,state.selectedDate); $('calendarDayTitle').textContent=`${formatDate(state.selectedDate)} · ${selected.length} 条`; renderRecordCards($('calendarDayRecords'),selected,false);
}

function renderStats(){
  const person=$('statsPerson').value,place=$('statsPlace').value,task=$('statsTask').value,start=$('statsStart').value,end=$('statsEnd').value;
  const records=state.records.filter(r=>(!person||r.personId===person)&&(!start||r.date>=start)&&(!end||r.date<=end)&&(!place||r.placeId===place)&&(!task||r.taskId===task));
  const days=new Set(records.map(r=>`${r.personId}:${r.date}`)).size,hours=records.reduce((sum,r)=>sum+Number(r.hours||0),0);
  $('statCards').innerHTML=[['出勤天数',days,'天'],['记录次数',records.length,'次'],['总工时',hours.toFixed(1),'小时']].map(([label,value,unit])=>`<div class="card stat-card"><strong>${value}</strong><small>${label} · ${unit}</small></div>`).join('');
  renderPlaceBreakdown($('placeStats'),records); renderBreakdown($('taskStats'),records,state.tasks,'taskId');
}
function renderPlaceBreakdown(container,records){
  const rows=state.places.map(item=>{const list=records.filter(r=>r.placeId===item.id).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));return {item,list,days:new Set(list.map(r=>`${r.personId}:${r.date}`)).size,hours:list.reduce((s,r)=>s+Number(r.hours||0),0)}}).filter(x=>x.list.length).sort((a,b)=>b.hours-a.hours);
  container.innerHTML=rows.length?rows.map(({item,list,days,hours})=>`<details class="place-stat"><summary><span><strong>${escapeHtml(item.name)}</strong><small>${days} 个出勤日 · ${list.length} 次 · ${hours.toFixed(1)} 小时</small></span><i>展开</i></summary><div class="place-details">${list.map(r=>`<button type="button" data-record="${r.id}"><span><strong>${formatDate(r.date)}</strong><small>${escapeHtml(byId(state.people,r.personId)?.name||'未知人员')}</small></span><span>${periodDots(r.period)}${periodLabel(r.period)} · ${Number(r.hours).toFixed(2).replace(/\.00$/,'')}h</span></button>`).join('')}</div></details>`).join(''):'<div class="empty">当前条件下暂无数据</div>';
  container.querySelectorAll('[data-record]').forEach(button=>button.onclick=()=>openRecord(button.dataset.record));
}
function renderBreakdown(container,records,items,key){
  const rows=items.map(item=>{const list=records.filter(r=>r[key]===item.id);return {name:item.name,count:list.length,hours:list.reduce((s,r)=>s+Number(r.hours||0),0)}}).filter(x=>x.count).sort((a,b)=>b.hours-a.hours); const max=Math.max(...rows.map(x=>x.hours),1);
  container.innerHTML=rows.length?rows.map(x=>`<div class="bar-row"><span class="bar-label">${escapeHtml(x.name)}</span><span class="bar-track"><i class="bar-fill" style="width:${x.hours/max*100}%"></i></span><span class="bar-value">${x.hours.toFixed(1)}h · ${x.count}次</span></div>`).join(''):'<div class="empty">当前条件下暂无数据</div>';
}

function renderSettings(){
  $('peopleList').innerHTML=state.people.map(p=>`<div class="manage-row"><div><strong>${escapeHtml(p.name)}</strong><small>${state.records.filter(r=>r.personId===p.id).length} 条记录${p.id===state.activePersonId?' · 当前':''}</small></div><div class="row-actions"><button data-edit-person="${p.id}">编辑</button><button data-delete-person="${p.id}">删除</button></div></div>`).join('');
  renderManageList($('placeManageList'),state.places,'place'); renderManageList($('taskManageList'),state.tasks,'task');
  $('storageSummary').textContent=`当前共有 ${state.people.length} 人、${state.records.length} 条考勤、${state.places.length} 个地点、${state.tasks.length} 项工作内容。`;
  renderPwaStatus();
  document.querySelectorAll('[data-edit-person]').forEach(b=>b.onclick=()=>promptText('编辑人员','姓名',byId(state.people,b.dataset.editPerson).name,async value=>{const p=byId(state.people,b.dataset.editPerson);p.name=value;await put('people',p);await loadState();renderAll();toast('人员已更新')}));
  document.querySelectorAll('[data-delete-person]').forEach(b=>b.onclick=()=>deletePerson(b.dataset.deletePerson));
}
function renderManageList(container,items,type){
  container.innerHTML=items.length?items.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(item=>`<div class="manage-row"><div><strong>${escapeHtml(item.name)}</strong><small>${state.records.filter(r=>r[type==='place'?'placeId':'taskId']===item.id).length} 次使用</small></div><div class="row-actions"><button data-rename-${type}="${item.id}">重命名</button><button data-merge-${type}="${item.id}">合并</button></div></div>`).join(''):'<div class="empty">暂无项目，录入记录时会自动保存。</div>';
  container.querySelectorAll(`[data-rename-${type}]`).forEach(b=>b.onclick=()=>renameVocab(type,b.dataset[`rename${type[0].toUpperCase()}${type.slice(1)}`]));
  container.querySelectorAll(`[data-merge-${type}]`).forEach(b=>b.onclick=()=>mergeVocab(type,b.dataset[`merge${type[0].toUpperCase()}${type.slice(1)}`]));
}

function openRecord(id=''){
  const record=id?byId(state.records,id):null,now=new Date(); $('recordForm').reset(); $('recordId').value=record?.id||''; $('recordDialogTitle').textContent=record?'编辑记录':'新增记录'; $('deleteRecord').classList.toggle('hidden',!record); $('recordError').textContent='';
  const selectedPersonId=record?.personId||state.activePersonId;
  $('recordPeople').innerHTML=state.people.map(person=>`<label class="person-choice"><input type="checkbox" name="recordPerson" value="${person.id}" ${person.id===selectedPersonId?'checked':''} ${record&&person.id!==selectedPersonId?'disabled':''}><span>${escapeHtml(person.name)}</span></label>`).join('');
  $('personSelectionHint').textContent=record?'编辑已有记录时只修改这一人的记录。':'可同时选择多人，保存后会分别生成独立记录。';
  selectedRecordDates=[record?.date||localDate(now)]; $('recordDate').value=selectedRecordDates[0]; $('recordDate').disabled=Boolean(record); $('addRecordDate').classList.toggle('hidden',Boolean(record)); $('dateSelectionHint').textContent=record?'编辑记录时日期保持单选。':'默认已选择今天，可继续添加其他日期。'; renderSelectedDates();
  $('recordTime').value=record?.time||localTime(now); $('recordHours').value=record?.hours??4; $('recordPlace').value=byId(state.places,record?.placeId)?.name||''; $('recordTask').value=byId(state.tasks,record?.taskId)?.name||''; $('recordNotes').value=record?.notes||'';
  document.querySelector(`input[name="period"][value="${record?.period||(now.getHours()<13?'am':'pm')}"]`).checked=true; $('recordDialog').showModal();
}
function renderSelectedDates(){
  $('recordDates').innerHTML=selectedRecordDates.sort().map(date=>`<span>${formatDate(date,false)}${$('recordId').value?'':`<button type="button" data-remove-date="${date}" aria-label="移除 ${date}">×</button>`}</span>`).join('');
  $('recordDates').querySelectorAll('[data-remove-date]').forEach(button=>button.onclick=()=>{selectedRecordDates=selectedRecordDates.filter(date=>date!==button.dataset.removeDate);renderSelectedDates();});
}
function addSelectedDate(){ const date=$('recordDate').value;if(!date)return;if(!selectedRecordDates.includes(date))selectedRecordDates.push(date);renderSelectedDates();$('recordError').textContent=''; }
function showSuggestions(kind){
  const input=$(kind==='place'?'recordPlace':'recordTask'),container=$(kind==='place'?'placeSuggestions':'taskSuggestions'),items=kind==='place'?state.places:state.tasks,query=normalizeName(input.value).toLocaleLowerCase('zh-CN');
  const matches=items.filter(item=>!query||item.name.toLocaleLowerCase('zh-CN').includes(query)||(item.aliases||[]).some(alias=>alias.toLocaleLowerCase('zh-CN').includes(query))).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).slice(0,12);
  container.innerHTML=matches.map(item=>`<div role="option" data-suggestion="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>`).join('');container.classList.toggle('hidden',!matches.length);
}
function bindSuggestions(kind){
  const input=$(kind==='place'?'recordPlace':'recordTask'),container=$(kind==='place'?'placeSuggestions':'taskSuggestions');
  input.addEventListener('focus',()=>showSuggestions(kind));input.addEventListener('input',()=>showSuggestions(kind));input.addEventListener('blur',()=>setTimeout(()=>container.classList.add('hidden'),120));
  container.addEventListener('pointerdown',event=>{const option=event.target.closest('[data-suggestion]');if(!option)return;event.preventDefault();input.value=option.dataset.suggestion;container.classList.add('hidden');input.focus();});
}
async function ensureVocab(storeName,name){
  const list=storeName==='places'?state.places:state.tasks,clean=normalizeName(name),existing=list.find(x=>x.name.localeCompare(clean,undefined,{sensitivity:'base'})===0 || (x.aliases||[]).some(a=>a.localeCompare(clean,undefined,{sensitivity:'base'})===0));
  if(existing)return existing; const item={id:uid(storeName==='places'?'place':'task'),name:clean,aliases:[],createdAt:new Date().toISOString()}; await put(storeName,item); list.push(item); return item;
}
async function saveRecord(){
  const id=$('recordId').value,period=document.querySelector('input[name="period"]:checked').value,personIds=[...document.querySelectorAll('input[name="recordPerson"]:checked')].map(input=>input.value); if(!id)addSelectedDate(); const dates=id?[byId(state.records,id)?.date]:[...new Set(selectedRecordDates)];
  if(!personIds.length){$('recordError').textContent='请至少选择 1 名人员。';return;}
  if(!dates.length){$('recordError').textContent='请至少选择 1 个工作日期。';return;}
  const conflicts=[];for(const personId of personIds)for(const date of dates){const found=state.records.filter(r=>r.personId===personId&&r.date===date&&r.id!==id&&(period==='full'||r.period==='full'||r.period===period));if(found.length)conflicts.push({person:byId(state.people,personId),date,records:found});}
  if(conflicts.length){$('recordError').textContent=conflicts.map(({person,date,records})=>`${person?.name||'该人员'} ${date}：${period==='full'?`已有${records.map(r=>periodLabel(r.period)).join('、')}，不能新增全天`:`已有${records.some(r=>r.period==='full')?'全天':periodLabel(period)}记录`}`).join('；');return;}
  if(!$('recordPlace').value.trim()||!$('recordTask').value.trim()){ $('recordError').textContent='请填写工作地点和工作内容。'; return; }
  const place=await ensureVocab('places',$('recordPlace').value),task=await ensureVocab('tasks',$('recordTask').value),existing=id?byId(state.records,id):null,now=new Date().toISOString();
  const records=[];for(const personId of personIds)for(const date of dates)records.push({id:id||uid('record'),personId,date,period,time:$('recordTime').value,hours:Number($('recordHours').value),placeId:place.id,taskId:task.id,notes:$('recordNotes').value.trim(),createdAt:existing?.createdAt||now,updatedAt:now}); await putMany('records',records); await loadState(); $('recordDialog').close(); renderAll(); toast(existing?'记录已更新':`${records.length} 条记录已保存`);
}
async function deleteCurrentRecord(){ const id=$('recordId').value;if(!id||!confirm('确定删除这条记录？此操作无法撤销。'))return;await remove('records',id);await loadState();$('recordDialog').close();renderAll();toast('记录已删除'); }

function promptText(title,label,value,callback){ textAction=callback;$('textDialogTitle').textContent=title;$('textInputLabel').childNodes[0].nodeValue=label;$('textInput').value=value||'';$('textError').textContent='';$('textDialog').showModal();setTimeout(()=>$('textInput').focus(),50); }
async function addNamed(type){ const labels={person:['添加人员','姓名'],place:['添加地点','地点名称'],task:['添加工作内容','工作内容']};promptText(...labels[type],'',async value=>{if(type==='person'){if(state.people.length>=5&&!confirm('当前已有 5 人，仍要继续添加吗？'))return;await put('people',{id:uid('person'),name:value,createdAt:new Date().toISOString()});}else await ensureVocab(type==='place'?'places':'tasks',value);await loadState();renderAll();toast('已添加');}); }
async function deletePerson(id){ if(state.people.length<=1){toast('至少保留 1 人');return;}const p=byId(state.people,id),count=state.records.filter(r=>r.personId===id).length;if(!confirm(`删除“${p.name}”及其 ${count} 条记录？此操作无法撤销。`))return;for(const r of state.records.filter(r=>r.personId===id))await remove('records',r.id);await remove('people',id);await loadState();if(state.activePersonId===id)await setActivePerson(state.people[0].id);else renderAll();toast('人员已删除'); }
function renameVocab(type,id){ const list=type==='place'?state.places:state.tasks,item=byId(list,id);promptText('重命名',type==='place'?'地点名称':'工作内容',item.name,async value=>{const duplicate=list.find(x=>x.id!==id&&x.name.localeCompare(value,undefined,{sensitivity:'base'})===0);if(duplicate){toast('已有同名项目，请使用“合并”');return;}item.aliases=[...(item.aliases||[]),item.name];item.name=value;await put(type==='place'?'places':'tasks',item);await loadState();renderAll();toast('已重命名');}); }
function mergeVocab(type,id){ const list=type==='place'?state.places:state.tasks,source=byId(list,id),others=list.filter(x=>x.id!==id);if(!others.length){toast('没有其他项目可合并');return;}const names=others.map((x,i)=>`${i+1}. ${x.name}`).join('\n');const raw=prompt(`把“${source.name}”合并到哪一项？请输入序号：\n\n${names}`);const target=others[Number(raw)-1];if(!target)return;mergeInto(type,source,target); }
async function mergeInto(type,source,target){ if(!confirm(`合并后，所有“${source.name}”记录会改为“${target.name}”，确定继续？`))return;const key=type==='place'?'placeId':'taskId';for(const record of state.records.filter(r=>r[key]===source.id)){record[key]=target.id;record.updatedAt=new Date().toISOString();await put('records',record);}target.aliases=Array.from(new Set([...(target.aliases||[]),source.name,...(source.aliases||[])]));await put(type==='place'?'places':'tasks',target);await remove(type==='place'?'places':'tasks',source.id);await loadState();renderAll();toast('已合并'); }

function buildBackup(){ return {app:'AttendancePocket',version:1,exportedAt:new Date().toISOString(),people:state.people,places:state.places,tasks:state.tasks,records:state.records,meta:{activePersonId:state.activePersonId}}; }
async function shareFile(name,mime,text){
  const handler=window.webkit?.messageHandlers?.shareFile;if(handler){handler.postMessage({name,mime,base64:btoa(unescape(encodeURIComponent(text)))});return;}
  const file=new File([text],name,{type:mime,lastModified:Date.now()});
  if(navigator.share && navigator.canShare?.({files:[file]})){
    try{await navigator.share({files:[file],title:name});return 'shared';}catch(error){if(error.name==='AbortError')return 'cancelled';}
  }
  const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=name;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return 'downloaded';
}
async function exportJSON(){const result=await shareFile(`考勤备份_${localDate(new Date())}.json`,'application/json',JSON.stringify(buildBackup(),null,2));if(result!=='cancelled')toast('完整备份已生成');}
async function exportCSV(){const header=['人员','日期','星期','时段','打卡时间','实际工时','工作地点','工作内容','备注','创建时间','更新时间'];const rows=[...state.records].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>[byId(state.people,r.personId)?.name,r.date,`周${weekday(r.date)}`,periodLabel(r.period),r.time,r.hours,byId(state.places,r.placeId)?.name,byId(state.tasks,r.taskId)?.name,r.notes,r.createdAt,r.updatedAt]);const csv='\ufeff'+[header,...rows].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');const result=await shareFile(`考勤记录_${localDate(new Date())}.csv`,'text/csv',csv);if(result!=='cancelled')toast('CSV 已生成');}
async function importJSON(file){
  try{const data=JSON.parse(await file.text());if(data.app!=='AttendancePocket'||!Array.isArray(data.people)||!Array.isArray(data.records))throw new Error('格式不正确');if(!confirm(`备份包含 ${data.people.length} 人、${data.records.length} 条记录。导入会覆盖当前全部数据，确定继续？`))return;for(const store of STORES)await clearStore(store);for(const name of ['people','places','tasks','records'])for(const item of data[name]||[])await put(name,item);await put('meta',{id:'activePerson',value:data.meta?.activePersonId||data.people[0]?.id});await loadState();renderAll();toast('备份恢复完成');}catch(error){alert(`导入失败：${error.message}`);}finally{$('importJson').value='';}
}

function bindEvents(){
  document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>showView(tab.dataset.view,'push')); $('quickAdd').onclick=()=>openRecord(); $('activePerson').onchange=e=>setActivePerson(e.target.value); $('toggleRecordFilters').onclick=()=>$('recordFilters').classList.toggle('hidden'); ['listStart','listEnd'].forEach(id=>$(id).onchange=renderRecords); $('clearRecordFilters').onclick=()=>{$('listStart').value='';$('listEnd').value='';renderRecords();};
  $('prevMonth').onclick=()=>{state.month=new Date(state.month.getFullYear(),state.month.getMonth()-1,1);state.selectedDate=localDate(state.month);renderCalendar();}; $('nextMonth').onclick=()=>{state.month=new Date(state.month.getFullYear(),state.month.getMonth()+1,1);state.selectedDate=localDate(state.month);renderCalendar();};
  ['statsPerson','statsStart','statsEnd','statsPlace','statsTask'].forEach(id=>$(id).onchange=renderStats); $('resetStats').onclick=()=>{const [a,b]=monthRange(new Date());$('statsStart').value=a;$('statsEnd').value=b;$('statsPerson').value='';$('statsPlace').value='';$('statsTask').value='';renderStats();};
  $('recordForm').onsubmit=e=>{e.preventDefault();saveRecord();}; $('closeRecord').onclick=$('cancelRecord').onclick=()=>$('recordDialog').close(); $('deleteRecord').onclick=deleteCurrentRecord;
  $('addRecordDate').onclick=addSelectedDate; $('recordDate').onchange=()=>{$('recordError').textContent='';}; bindSuggestions('place');bindSuggestions('task');
  document.querySelectorAll('input[name="period"]').forEach(input=>input.onchange=()=>{$('recordError').textContent='';}); $('recordPeople').onchange=()=>{$('recordError').textContent='';};
  $('textForm').onsubmit=async e=>{e.preventDefault();const value=normalizeName($('textInput').value);if(!value){$('textError').textContent='名称不能为空';return;}const action=textAction;$('textDialog').close();textAction=null;await action(value);}; $('closeText').onclick=$('cancelText').onclick=()=>$('textDialog').close();
  $('addPerson').onclick=()=>addNamed('person');$('addPlace').onclick=()=>addNamed('place');$('addTask').onclick=()=>addNamed('task');$('exportJson').onclick=()=>exportJSON().catch(error=>alert(`导出失败：${error.message}`));$('exportCsv').onclick=()=>exportCSV().catch(error=>alert(`导出失败：${error.message}`));$('importJson').onchange=e=>e.target.files[0]&&importJSON(e.target.files[0]);
  $('applyUpdate').onclick=()=>waitingServiceWorker?.postMessage({type:'SKIP_WAITING'});
  $('checkUpdate').onclick=async()=>{if(!serviceWorkerRegistration){toast('当前环境不支持应用更新检查');return;}try{await serviceWorkerRegistration.update();toast(waitingServiceWorker?'已有新版本可更新':'已是最新版本');}catch(_){toast('离线状态下无法检查更新');}};
  window.addEventListener('popstate',event=>showView(event.state?.view||'records'));
  window.addEventListener('online',renderPwaStatus);window.addEventListener('offline',renderPwaStatus);
}

function isStandalone(){return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;}
function renderPwaStatus(){const el=$('pwaStatus');if(!el)return;el.textContent=`版本 ${APP_VERSION} · ${isStandalone()?'主屏幕模式':'浏览器模式'} · ${navigator.onLine?'当前联网':'当前离线'} · 业务数据仅存于本机 IndexedDB`;}
function offerUpdate(worker){waitingServiceWorker=worker;$('updateBanner').classList.remove('hidden');renderPwaStatus();}
async function registerServiceWorker(){
  if(!('serviceWorker'in navigator)||!location.protocol.startsWith('http')){renderPwaStatus();return;}
  try{
    const hadController=Boolean(navigator.serviceWorker.controller);
    const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});serviceWorkerRegistration=registration;
    if(registration.waiting)offerUpdate(registration.waiting);
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)offerUpdate(worker);});});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!hadController||reloadingForUpdate)return;reloadingForUpdate=true;location.reload();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&navigator.onLine)registration.update().catch(()=>{});});
    registration.update().catch(()=>{});renderPwaStatus();
  }catch(_){renderPwaStatus();}
}

async function init(){
  try{bindEvents();db=await openDB();await loadState();await seed();const [a,b]=monthRange(new Date());$('statsStart').value=a;$('statsEnd').value=b;const initialView=['records','calendar','stats','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'records';history.replaceState({view:initialView},'',initialView==='records'?location.pathname+location.search:`#${initialView}`);renderAll();showView(initialView);navigator.storage?.persist?.().catch(()=>{});await registerServiceWorker();}catch(error){document.body.innerHTML=`<div class="empty"><strong>应用无法启动</strong>${escapeHtml(error.message)}。请确认浏览器允许本地存储。</div>`;}
}
init();
