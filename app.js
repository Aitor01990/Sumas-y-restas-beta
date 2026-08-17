

const $=id=>document.getElementById(id);
const STORAGE_KEY='sumasRestas_beta_v1'; // datos independientes del canal estable

let db=loadDB();
let currentUser='';
let selectedOp='add';
const DEFAULT_SETTINGS={
  add:{digits:3,count:3,carry:'yes'},
  sub:{digits:3,carry:'yes'},
  mul:{multiplicandDigits:2,multiplierDigits:1},
  div:{dividendDigits:2,divisorDigits:1,resultType:'integer'}
};
const DEFAULT_PROFILES={
  practice:{counts:{add:2,sub:2,mul:1,div:1},settings:clone(DEFAULT_SETTINGS)},
  exam:{counts:{add:2,sub:2,mul:1,div:1},settings:clone(DEFAULT_SETTINGS)}
};
let settingsState=clone(DEFAULT_SETTINGS),programProfiles=clone(DEFAULT_PROFILES);
let current=null,record=null,completedThisSession=0,exerciseSolved=false,revealConfirm=false;
let sessionMode='single',programMode='practice',programCounts={add:0,sub:0,mul:0,div:0},exerciseQueue=[],queueIndex=0,examResults=[],practiceResults=[];

function loadDB(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    const data=raw?JSON.parse(raw):{users:{},lastUser:''};
    if(!data.users)data.users={};
    pruneOld(data);
    return data;
  }catch(e){return{users:{},lastUser:''}}
}
function saveDB(){pruneOld(db);try{localStorage.setItem(STORAGE_KEY,JSON.stringify(db))}catch(e){}}
function pruneOld(data){/* Desde V15.2 el historial se conserva sin límite. */}
function ensureUser(name){
  const clean=(name||'').trim().slice(0,24);
  if(!clean)return'';
  if(!db.users[clean])db.users[clean]={history:[],created:new Date().toISOString()};
  db.lastUser=clean;saveDB();return clean
}
function historyFor(name){return db.users[name]?.history||[]}
function totalDone(name){return historyFor(name).length}
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active')}
function rint(min,max){return Math.floor(Math.random()*(max-min+1))+min}
function exactDigits(d){return [10**(d-1),10**d-1]}
function digitsOf(n,d){return String(n).padStart(d,'0').split('').map(Number)}
function labelOp(op){return({add:'Suma',sub:'Resta',mul:'Multiplicación',div:'División'})[op]||op}
function symbolOp(op){return({add:'+',sub:'−',mul:'×',div:'÷'})[op]||'?'}
function isExamSession(){return sessionMode==='exam'||sessionMode==='supportExam'}
function clone(value){return JSON.parse(JSON.stringify(value))}
function mergeSettings(source={}){
  const result=clone(DEFAULT_SETTINGS);
  Object.keys(result).forEach(op=>Object.assign(result[op],source[op]||{}));
  return result;
}
function ensureUserConfig(){
  const user=db.users[currentUser];if(!user)return;
  const oldMain=user.config?.main||user.settings||{};
  settingsState=mergeSettings(oldMain);
  programProfiles=clone(DEFAULT_PROFILES);
  Object.keys(programProfiles).forEach(mode=>{
    const saved=user.config?.profiles?.[mode];if(!saved)return;
    Object.assign(programProfiles[mode].counts,saved.counts||{});
    programProfiles[mode].settings=mergeSettings(saved.settings||{});
  });
  persistUserConfig();
}
function persistUserConfig(){const user=db.users[currentUser];if(!user)return;user.config={main:clone(settingsState),profiles:clone(programProfiles)};saveDB()}
function sessionsForUser(){const user=db.users[currentUser];if(!user)return[];if(!Array.isArray(user.sessions))user.sessions=[];return user.sessions}
function weekStartKey(value=new Date()){const d=new Date(value);d.setHours(12,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return localDateKey(d)}
function completedSession(mode,period){return sessionsForUser().some(x=>x.mode===mode&&(period==='day'?localDateKey(x.date)===localDateKey(new Date()):weekStartKey(x.date)===weekStartKey()))}
function examGrade(correct,total){return total?Math.round(correct/total*100)/10:0}
function formatGrade(grade){return Number.isInteger(grade)?String(grade):String(grade).replace('.',',')}
function examMotivation(grade){
  if(grade<5)return{icon:'🌱',message:'Sigue creciendo, estás aprendiendo paso a paso'};
  if(grade<7)return{icon:'👍',message:'¡Bien hecho! Vas por buen camino'};
  if(grade<9)return{icon:'🚀',message:'¡Muy bien! Se nota tu esfuerzo'};
  if(grade<10)return{icon:'🌟',message:'¡Asombroso! Casi perfecto'};
  return{icon:'🏆',message:'¡Brillante! Ha sido perfecto'};
}
function bestExamSession(items){return items.filter(x=>x.mode==='exam'&&Number.isFinite(x.grade)).sort((a,b)=>b.grade-a.grade)[0]||null}
function registerCompletedSession(mode,details={}){sessionsForUser().push({mode,date:new Date().toISOString(),...details});saveDB()}

function openUser(name){
  currentUser=name;
  db.lastUser=name;
  ensureUserConfig();
  $('operationUserName').textContent=name;
  updateOperationStats();
  showScreen('operationScreen');
}
function renderUsers(){
  const names=Object.keys(db.users).sort((a,b)=>a.localeCompare(b,'es'));
  const box=$('userList');
  box.innerHTML='';

  if(!names.length){
    box.innerHTML='<div class="empty">Todavía no hay usuarios. Crea el primero.</div>';
    $('newUserRow').classList.add('show');
    setTimeout(()=>$('newUserName').focus(),0);
  }else{
    names.forEach(name=>{
      const b=document.createElement('button');
      b.className='user-card';
      const count=totalDone(name);
      b.innerHTML=`<div><div class="user-name">${escapeHtml(name)}</div><div class="user-meta">${count} ejercicio${count===1?'':'s'} guardado${count===1?'':'s'}</div></div><span class="user-arrow">›</span>`;
      b.onclick=()=>openUser(name);
      box.appendChild(b);
    });
  }
}
function updateOperationStats(){
  if(!currentUser||!db.users[currentUser])return;
  const h=historyFor(currentUser);
  const first=h.filter(x=>x.attempts?.length===1&&x.attempts[0].correct&&!x.solutionUsed).length;
  $('operationUserStats').innerHTML=`<b>${escapeHtml(currentUser)}</b> · ${h.length} ejercicios · ${first} a la primera`;
  updateDailyGoal();
}
function updateDailyGoal(){
  if(!db.users[currentUser])return;const dailyDone=completedSession('practice','day'),weeklyDone=completedSession('exam','week'),weekSessions=sessionsForUser().filter(x=>x.mode==='exam'&&weekStartKey(x.date)===weekStartKey()),best=bestExamSession(weekSessions),motivation=best?examMotivation(best.grade):null;
  $('dailyGoalBox').innerHTML=`<div class="habit-goal ${dailyDone?'done':''}"><span>${dailyDone?'✓':'○'}</span><div><b>Objetivo diario</b><small>${dailyDone?'Modo ejercicios completado hoy':'Completa el Modo ejercicios una vez hoy'}</small></div></div><div class="habit-goal ${weeklyDone?'done':''}"><span>${weeklyDone?'★':'☆'}</span><div><b>Objetivo semanal</b><small>${best?`Mejor nota: <strong>${formatGrade(best.grade)}/10</strong> · ${motivation.icon} ${motivation.message}`:weeklyDone?'Modo examen completado esta semana':'Completa el Modo examen una vez esta semana'}</small></div></div>`;
}
$('newUserBtn').onclick=()=>{$('newUserRow').classList.toggle('show');if($('newUserRow').classList.contains('show'))$('newUserName').focus()};
$('saveUserBtn').onclick=()=>{
  const n=ensureUser($('newUserName').value);
  if(!n)return $('newUserName').focus();
  $('newUserName').value='';
  $('newUserRow').classList.remove('show');
  renderUsers();
  openUser(n);
};
$('newUserName').addEventListener('keydown',e=>{if(e.key==='Enter')$('saveUserBtn').click()});

function addCarries(numbers,n){
  let carry=0,carries=Array(n).fill(0),any=false;
  const all=numbers.map(x=>digitsOf(x,n));
  for(let i=n-1;i>=0;i--){
    const total=all.reduce((s,d)=>s+d[i],carry);
    const out=Math.floor(total/10);
    if(out>0)any=true;
    if(i>0)carries[i-1]=out;
    carry=out;
  }
  return{carries,any}
}

function generateNoCarryAddends(digits,count){
  const lengths=Array.from({length:count},()=>rint(1,digits));lengths[rint(0,count-1)]=digits;
  const columns=[];
  for(let col=0;col<digits;col++){
    const vals=Array(count).fill(0),active=[];
    for(let row=0;row<count;row++)if(lengths[row]>=digits-col)active.push(row);
    let remaining=9;
    active.forEach((row,pos)=>{
      const leading=lengths[row]===digits-col,min=leading?1:0;
      const futureMin=active.slice(pos+1).filter(r=>lengths[r]===digits-col).length;
      vals[row]=rint(min,Math.max(min,remaining-futureMin));remaining-=vals[row];
    });
    columns.push(vals);
  }
  const nums=Array(count).fill(0);
  for(let r=0;r<count;r++){
    let s='';
    for(let c=0;c<digits;c++)s+=columns[c][r];
    nums[r]=+s;
  }
  return nums;
}

function generateAddends(digits,count,carryMode){
  if(carryMode==='no')return generateNoCarryAddends(digits,count);
  const [,max]=exactDigits(digits),minFull=10**(digits-1);
  let nums,meta,tries=0;
  do{
    nums=Array.from({length:count},()=>rint(1,max));
    nums[rint(0,count-1)]=rint(minFull,max);
    meta=addCarries(nums,digits);
    tries++;
  }while(!meta.any&&tries<30000);
  return nums;
}
function subState(a,b,n){
  const A=digitsOf(a,n),B=digitsOf(b,n);
  let carryToBottom=0;
  const borrowTop=Array(n).fill(0),bottomReplacement=Array(n).fill(null);
  for(let i=n-1;i>=0;i--){
    const effectiveBottom=B[i]+carryToBottom;
    if(carryToBottom===1)bottomReplacement[i]=effectiveBottom;
    const borrow=A[i]<effectiveBottom?1:0;
    borrowTop[i]=borrow;
    carryToBottom=borrow;
  }
  return{borrowTop,bottomReplacement,any:borrowTop.some(Boolean)}
}
function matchCarry(any,mode){return mode==='mix'||(mode==='yes'?any:!any)}

function chooseOperation(op){
  selectedOp=op;
  $('difficultyTitle').textContent=({add:'Sumas',sub:'Restas',mul:'Multiplicaciones',div:'Divisiones'})[op];
  renderDifficulty();
  showScreen('difficultyScreen');
}

function levelButton(key,label,sub,active,onclick){
  return `<button class="level-btn ${active?'active':''}" data-key="${key}">${label}${sub?`<small>${sub}</small>`:''}</button>`;
}

function renderDifficulty(){
  const host=$('difficultyOptions');

  if(selectedOp==='add'){
    const s=settingsState.add;
    host.innerHTML=`
      <div class="section-title" style="margin-top:0">Máximo de columnas</div>
      <div class="level-grid">
        ${[2,3,4,5].map(d=>levelButton(`d${d}`,`${d} columnas`,'',s.digits===d)).join('')}
      </div>
      <div class="section-title">Número de líneas</div>
      <div class="level-grid">
        ${[2,3,4].map(c=>levelButton(`c${c}`,`${c} líneas`,'',s.count===c)).join('')}
      </div>
      <div class="section-title">Llevadas</div>
      <div class="segment">
        <button data-carry="yes" class="${s.carry==='yes'?'active':''}">Con llevadas</button>
        <button data-carry="no" class="${s.carry==='no'?'active':''}">Sin llevadas</button>
      </div>`;
    host.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>{const key=b.dataset.key;if(key[0]==='d')s.digits=+key.slice(1);else s.count=+key.slice(1);renderDifficulty()});
    host.querySelectorAll('[data-carry]').forEach(b=>b.onclick=()=>{s.carry=b.dataset.carry;renderDifficulty()});
  }

  if(selectedOp==='sub'){
    const s=settingsState.sub;
    host.innerHTML=`
      <div class="section-title" style="margin-top:0">Número de cifras</div>
      <div class="level-grid">
        ${[2,3,4,5].map(d=>levelButton(String(d),`${d} cifras`,'',s.digits===d)).join('')}
      </div>
      <div class="section-title">Llevadas</div>
      <div class="segment">
        <button data-carry="yes" class="${s.carry==='yes'?'active':''}">Con llevadas</button>
        <button data-carry="no" class="${s.carry==='no'?'active':''}">Sin llevadas</button>
      </div>`;
    host.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>{s.digits=+b.dataset.key;renderDifficulty()});
    host.querySelectorAll('[data-carry]').forEach(b=>b.onclick=()=>{s.carry=b.dataset.carry;renderDifficulty()});
  }

  if(selectedOp==='mul'){
    const s=settingsState.mul;
    host.innerHTML=`
      <div class="section-title" style="margin-top:0">Cifras del multiplicando (arriba)</div>
      <div class="level-grid">
        ${[1,2,3,4].map(d=>levelButton(`a${d}`,`${d} cifra${d===1?'':'s'}`,'',s.multiplicandDigits===d)).join('')}
      </div>
      <div class="section-title">Cifras del multiplicador (abajo)</div>
      <div class="level-grid">
        ${[1,2,3].map(d=>levelButton(`b${d}`,`${d} cifra${d===1?'':'s'}`,'',s.multiplierDigits===d)).join('')}
      </div>
      <div class="selected-user-box">Cada cifra se multiplica por separado, empezando por la derecha.</div>`;
    host.querySelectorAll('[data-key]').forEach(btn=>btn.onclick=()=>{const key=btn.dataset.key;if(key[0]==='a')s.multiplicandDigits=+key.slice(1);else s.multiplierDigits=+key.slice(1);renderDifficulty()});
  }

  if(selectedOp==='div'){
    const s=settingsState.div;
    host.innerHTML=`
      <div class="section-title" style="margin-top:0">Cifras del dividendo</div>
      <div class="level-grid">
        ${[2,3,4].map(d=>levelButton(String(d),`${d} cifras`,'',s.dividendDigits===d)).join('')}
      </div>
      <div class="section-title">Cifras del divisor</div>
      <div class="level-grid">
        ${[1,2,3].map(d=>levelButton(`d${d}`,`${d} cifra${d===1?'':'s'}`,'',s.divisorDigits===d)).join('')}
      </div>
      <div class="section-title">Tipo de resultado</div>
      <div class="level-grid">
        ${levelButton('integer','Entero exacto','Sin resto',s.resultType==='integer')}
        ${levelButton('terminating','Decimal exacto','El decimal termina',s.resultType==='terminating')}
        ${levelButton('pure','Periódico sencillo','El período empieza tras la coma',s.resultType==='pure')}
        ${levelButton('mixed','Periódico mixto','Tiene parte decimal no periódica',s.resultType==='mixed')}
      </div>
      <div class="selected-user-box">La V13 muestra el cociente y el desarrollo paso a paso. En los periódicos se practica <b>un ciclo del período</b>.</div>`;
    host.querySelectorAll('[data-key]').forEach(btn=>btn.onclick=()=>{
      const key=btn.dataset.key;
      if(/^d\d$/.test(key))s.divisorDigits=+key.slice(1);
      else if(/^\d$/.test(key))s.dividendDigits=+key;
      else s.resultType=key;
      if(s.resultType==='integer'&&s.divisorDigits>=s.dividendDigits)s.divisorDigits=Math.max(1,s.dividendDigits-1);
      renderDifficulty();
    });
  }
}

function selectOptions(values,current,labeler=v=>v){return values.map(v=>`<option value="${v}" ${String(v)===String(current)?'selected':''}>${labeler(v)}</option>`).join('')}
function programField(label,key,options){return `<label class="program-field"><span>${label}</span><select data-program-key="${key}">${options}</select></label>`}
function renderProgram(){
  $('programTitle').textContent=programMode==='exam'?'Modo examen':'Programar ejercicios';
  const qty=op=>programField('Cantidad',`${op}.quantity`,selectOptions([0,1,2,3,4,5,6,7,8,9,10,15,20],programCounts[op]));
  $('programOptions').innerHTML=`
    <div class="program-block"><h3>Sumas</h3><div class="program-fields">${qty('add')}${programField('Máximo de columnas','add.digits',selectOptions([2,3,4,5],settingsState.add.digits,v=>`${v} columnas`))}${programField('Líneas','add.count',selectOptions([2,3,4],settingsState.add.count,v=>`${v} líneas`))}${programField('Llevadas','add.carry',selectOptions(['yes','no'],settingsState.add.carry,v=>v==='yes'?'Con llevadas':'Sin llevadas'))}</div></div>
    <div class="program-block"><h3>Restas</h3><div class="program-fields">${qty('sub')}${programField('Cifras','sub.digits',selectOptions([2,3,4,5],settingsState.sub.digits,v=>`${v} cifras`))}${programField('Llevadas','sub.carry',selectOptions(['yes','no'],settingsState.sub.carry,v=>v==='yes'?'Con llevadas':'Sin llevadas'))}</div></div>
    <div class="program-block"><h3>Multiplicaciones</h3><div class="program-fields">${qty('mul')}${programField('Multiplicando','mul.multiplicandDigits',selectOptions([1,2,3,4],settingsState.mul.multiplicandDigits,v=>`${v} cifras`))}${programField('Multiplicador','mul.multiplierDigits',selectOptions([1,2,3],settingsState.mul.multiplierDigits,v=>`${v} cifras`))}</div></div>
    <div class="program-block"><h3>Divisiones</h3><div class="program-fields">${qty('div')}${programField('Dividendo','div.dividendDigits',selectOptions([2,3,4],settingsState.div.dividendDigits,v=>`${v} cifras`))}${programField('Divisor','div.divisorDigits',selectOptions([1,2,3],settingsState.div.divisorDigits,v=>`${v} cifras`))}${programField('Resultado','div.resultType',selectOptions(['integer','terminating','pure','mixed'],settingsState.div.resultType,v=>({integer:'Entero exacto',terminating:'Decimal exacto',pure:'Periódico sencillo',mixed:'Periódico mixto'})[v]))}</div></div>`;
  $('programOptions').querySelectorAll('[data-program-key]').forEach(select=>select.onchange=()=>{
    const [op,key]=select.dataset.programKey.split('.'),numeric=!['carry','resultType'].includes(key),value=numeric?+select.value:select.value;
    if(key==='quantity')programCounts[op]=value;else settingsState[op][key]=value;
    if(op==='div'&&settingsState.div.resultType==='integer'&&settingsState.div.divisorDigits>=settingsState.div.dividendDigits)settingsState.div.divisorDigits=Math.max(1,settingsState.div.dividendDigits-1);
    renderProgram();
  });
  renderSavedPrograms();
}

function savedPrograms(){return db.users[currentUser]?.programs||[]}
function renderSavedPrograms(){
  const list=savedPrograms();$('savedPrograms').innerHTML=list.length?list.map((p,i)=>`<div class="saved-program"><b>${escapeHtml(p.name)}</b><button data-load-program="${i}">Cargar</button><button class="delete-saved" data-delete-program="${i}">×</button></div>`).join(''):'<div class="empty" style="padding:8px">No hay programaciones guardadas.</div>';
  $('savedPrograms').querySelectorAll('[data-load-program]').forEach(btn=>btn.onclick=()=>{const p=list[+btn.dataset.loadProgram];programCounts=JSON.parse(JSON.stringify(p.counts));settingsState=JSON.parse(JSON.stringify(p.settings));renderProgram()});
  $('savedPrograms').querySelectorAll('[data-delete-program]').forEach(btn=>btn.onclick=()=>{db.users[currentUser].programs.splice(+btn.dataset.deleteProgram,1);saveDB();renderSavedPrograms()});
}
function saveCurrentProgram(){
  const name=$('programName').value.trim();if(!name)return $('programName').focus();
  const user=db.users[currentUser];if(!user.programs)user.programs=[];user.programs.push({name:name.slice(0,30),counts:JSON.parse(JSON.stringify(programCounts)),settings:JSON.parse(JSON.stringify(settingsState)),created:new Date().toISOString()});saveDB();$('programName').value='';renderSavedPrograms()
}

function openProgram(mode){programMode=mode;renderProgram();showScreen('programScreen')}
function shuffled(items){for(let i=items.length-1;i>0;i--){const j=rint(0,i);[items[i],items[j]]=[items[j],items[i]]}return items}
function startProgram(){
  exerciseQueue=[];
  ['add','sub','mul','div'].forEach(op=>{for(let i=0;i<programCounts[op];i++)exerciseQueue.push({op,settings:JSON.parse(JSON.stringify(settingsState[op]))})});
  if(!exerciseQueue.length){$('startProgramBtn').textContent='Añade al menos un ejercicio';setTimeout(()=>$('startProgramBtn').textContent='Empezar',1800);return}
  shuffled(exerciseQueue);queueIndex=0;examResults=[];practiceResults=[];completedThisSession=0;sessionMode=programMode;
  showScreen('exerciseScreen');newExercise(exerciseQueue[0]);
}

function settingField(scope,op,label,key,values,current,labeler=v=>v){return `<label class="program-field"><span>${label}</span><select data-setting-scope="${scope}" data-setting-op="${op}" data-setting-key="${key}">${selectOptions(values,current,labeler)}</select></label>`}
function settingsBlock(scope,title,help){
  const profile=scope==='main'?{settings:settingsState}:programProfiles[scope],s=profile.settings,count=op=>scope==='main'?'':settingField(scope,op,'Cantidad','quantity',[0,1,2,3,4,5,6,7,8,9,10,15,20],profile.counts[op]);
  return `<section class="settings-group"><h2>${title}</h2><p class="settings-help">${help}</p>
    <div class="settings-subtitle">Sumas</div><div class="program-fields">${count('add')}${settingField(scope,'add','Máximo de columnas','digits',[2,3,4,5],s.add.digits,v=>`${v} columnas`)}${settingField(scope,'add','Líneas','count',[2,3,4],s.add.count,v=>`${v} líneas`)}${settingField(scope,'add','Llevadas','carry',['yes','no'],s.add.carry,v=>v==='yes'?'Con llevadas':'Sin llevadas')}</div>
    <div class="settings-subtitle">Restas</div><div class="program-fields">${count('sub')}${settingField(scope,'sub','Cifras','digits',[2,3,4,5],s.sub.digits,v=>`${v} cifras`)}${settingField(scope,'sub','Llevadas','carry',['yes','no'],s.sub.carry,v=>v==='yes'?'Con llevadas':'Sin llevadas')}</div>
    <div class="settings-subtitle">Multiplicaciones</div><div class="program-fields">${count('mul')}${settingField(scope,'mul','Multiplicando','multiplicandDigits',[1,2,3,4],s.mul.multiplicandDigits,v=>`${v} cifras`)}${settingField(scope,'mul','Multiplicador','multiplierDigits',[1,2,3],s.mul.multiplierDigits,v=>`${v} cifras`)}</div>
    <div class="settings-subtitle">Divisiones</div><div class="program-fields">${count('div')}${settingField(scope,'div','Dividendo','dividendDigits',[2,3,4],s.div.dividendDigits,v=>`${v} cifras`)}${settingField(scope,'div','Divisor','divisorDigits',[1,2,3],s.div.divisorDigits,v=>`${v} cifras`)}${settingField(scope,'div','Resultado','resultType',['integer','terminating','pure','mixed'],s.div.resultType,v=>({integer:'Entero exacto',terminating:'Decimal exacto',pure:'Periódico sencillo',mixed:'Periódico mixto'})[v])}</div></section>`;
}
function renderSettings(){
  $('settingsOptions').innerHTML=settingsBlock('main','Modos principales','Estos niveles se usan al pulsar directamente Sumas, Restas, Multiplicar o Dividir.')+settingsBlock('practice','Modo ejercicios','Serie con Corregir y Ver respuesta. Completarla cumple el objetivo diario.')+settingsBlock('exam','Modo examen','Serie sin corrección durante el examen. Completarla cumple el objetivo semanal.');
  $('settingsOptions').querySelectorAll('[data-setting-scope]').forEach(select=>select.onchange=()=>{
    const scope=select.dataset.settingScope,op=select.dataset.settingOp,key=select.dataset.settingKey,numeric=!['carry','resultType'].includes(key),value=numeric?+select.value:select.value,target=scope==='main'?settingsState:programProfiles[scope].settings;
    if(key==='quantity')programProfiles[scope].counts[op]=value;else target[op][key]=value;
    if(op==='div'&&target.div.resultType==='integer'&&target.div.divisorDigits>=target.div.dividendDigits)target.div.divisorDigits=Math.max(1,target.div.dividendDigits-1);
    renderSettings();
  });
}
function startSingleOperation(op){selectedOp=op;sessionMode='single';exerciseQueue=[];queueIndex=0;completedThisSession=0;updateCounter();showScreen('exerciseScreen');newExercise()}
function startConfiguredProgram(mode){
  const profile=programProfiles[mode];exerciseQueue=[];
  ['add','sub','mul','div'].forEach(op=>{for(let i=0;i<(profile.counts[op]||0);i++)exerciseQueue.push({op,settings:clone(profile.settings[op])})});
  if(!exerciseQueue.length){$('dailyGoalBox').querySelector('.goal-done-text').textContent='Configura primero esta serie en Ajustes';return}
  shuffled(exerciseQueue);queueIndex=0;examResults=[];practiceResults=[];completedThisSession=0;programMode=mode;sessionMode=mode==='exam'?'exam':'practice';showScreen('exerciseScreen');newExercise(exerciseQueue[0]);
}

document.querySelectorAll('[data-op]').forEach(b=>b.onclick=()=>startSingleOperation(b.dataset.op));
document.querySelectorAll('[data-program]').forEach(b=>b.onclick=()=>startConfiguredProgram(b.dataset.program));

function divisionExpansion(a,b){
  const integer=Math.floor(a/b);
  let remainder=a%b;
  const decimals=[],seen=new Map();
  while(remainder&& !seen.has(remainder) && decimals.length<12){
    seen.set(remainder,decimals.length);
    remainder*=10;
    decimals.push(Math.floor(remainder/b));
    remainder%=b;
  }
  if(!remainder)return{kind:decimals.length?'terminating':'integer',integer,prefix:decimals,repeat:[]};
  const start=seen.get(remainder);
  if(start===undefined)return null;
  return{kind:start===0?'pure':'mixed',integer,prefix:decimals.slice(0,start),repeat:decimals.slice(start)};
}
function divisionDisplay(exp){
  const head=String(exp.integer);
  if(exp.kind==='integer')return head;
  const prefix=exp.prefix.join('');
  return exp.repeat.length?`${head},${prefix}(${exp.repeat.join('')})`:`${head},${prefix}`;
}
function divisionSteps(a,b,exp){
  const steps=[];
  let remainder=0,started=false;
  String(a).split('').forEach((char,index)=>{
    const partial=remainder*10+Number(char),digit=Math.floor(partial/b),product=digit*b;
    remainder=partial-product;
    if(digit||started||index===String(a).length-1){
      started=true;steps.push({partial,digit,product,remainder,decimal:false,column:index});
    }
  });
  const decimalDigits=[...exp.prefix,...exp.repeat];
  decimalDigits.forEach((digit,index)=>{
    const partial=remainder*10,product=digit*b;
    remainder=partial-product;
    steps.push({partial,digit,product,remainder,decimal:true,column:String(a).length+index});
  });
  return steps;
}
function generateDivision(settings){
  const [amin,amax]=exactDigits(settings.dividendDigits),[bmin,bmax]=exactDigits(settings.divisorDigits);
  if(settings.resultType==='integer'){
    for(let tries=0;tries<30000;tries++){
      const b=rint(Math.max(2,bmin),bmax),q=rint(2,99),a=b*q;
      if(a>=amin&&a<=amax){const expansion=divisionExpansion(a,b);return{a,b,expansion}}
    }
  }else{
    for(let tries=0;tries<60000;tries++){
      const a=rint(amin,amax),b=rint(Math.max(2,bmin),bmax),expansion=divisionExpansion(a,b);
      if(!expansion||expansion.kind!==settings.resultType)continue;
      if(expansion.prefix.length<=3&&expansion.repeat.length<=3)return{a,b,expansion};
    }
  }
  // Respaldo poco probable: ampliar la búsqueda de forma determinista.
  for(let b=Math.max(2,bmin);b<=bmax;b++)for(let a=amin;a<=amax;a++){
    const expansion=divisionExpansion(a,b);
    if(expansion&&expansion.kind===settings.resultType&&expansion.prefix.length<=3&&expansion.repeat.length<=3)return{a,b,expansion};
  }
  return generateDivision({...settings,resultType:'terminating'});
}

function newExercise(queueItem=null){
  const op=queueItem?.op||selectedOp;
  if(queueItem){selectedOp=op;settingsState[op]=JSON.parse(JSON.stringify(queueItem.settings))}
  let a,b,result,n,meta={},tries=0,operands=null;

  if(op==='add'){
    const s=settingsState.add;
    n=s.digits;
    operands=generateAddends(s.digits,s.count,s.carry);
    meta=addCarries(operands,n);
    result=operands.reduce((sum,x)=>sum+x,0);
    a=operands[0];b=operands[1]??0;
    meta.carryMode=s.carry;
    meta.addendCount=s.count;
  }else if(op==='sub'){
    const s=settingsState.sub,[min,max]=exactDigits(s.digits);
    n=s.digits;
    do{
      a=rint(min,max);b=rint(min,max);if(b>a)[a,b]=[b,a];meta=subState(a,b,n);tries++;
    }while(!matchCarry(meta.any,s.carry)&&tries<30000);
    result=a-b;meta.carryMode=s.carry;
  }else if(op==='mul'){
    const s=settingsState.mul,[amin,amax]=exactDigits(s.multiplicandDigits),[bmin,bmax]=exactDigits(s.multiplierDigits);
    n=s.multiplicandDigits;
    a=rint(amin,amax);b=rint(bmin,bmax);
    result=a*b;
    const topDigits=[...String(a)].reverse().map(Number),bottomDigits=[...String(b)].reverse().map(Number);
    meta.mulSteps=[];
    bottomDigits.forEach((multiplierDigit,multiplierIndex)=>topDigits.forEach((topDigit,topIndex)=>meta.mulSteps.push({topDigit,multiplierDigit,topIndex,multiplierIndex,product:topDigit*multiplierDigit})));
    meta.stepProducts=meta.mulSteps.map(step=>step.product);
  }else{
    const s=settingsState.div;
    const generated=generateDivision(s);
    a=generated.a;b=generated.b;
    const expansion=generated.expansion;
    result=divisionDisplay(expansion);
    n=String(expansion.integer).length+expansion.prefix.length+expansion.repeat.length;
    meta.division=expansion;
    meta.answerDigits=String(expansion.integer)+expansion.prefix.join('')+expansion.repeat.join('');
    meta.divisionSteps=divisionSteps(a,b,expansion);
    meta.resultType=expansion.kind;
  }

  current={op,a,b,result,n,operands,...meta};
  record={
    date:new Date().toISOString(),
    operation:op,a,b,result,
    operands:operands?operands.slice():undefined,
    settings:JSON.parse(JSON.stringify(settingsState[op])),
    attempts:[],solutionUsed:false
  };
  updateCounter();
  renderExercise();
}
function makeText(parent,row,col,text,cls='digit',id=''){const el=document.createElement('div');el.textContent=text;el.className=cls;el.style.gridRow=row;el.style.gridColumn=col;if(id)el.id=id;parent.appendChild(el);return el}
function onEdit(){exerciseSolved=false;$('mainBtn').textContent=isExamSession()?'Siguiente':'Corregir';$('solutionBtn').disabled=false;$('status').textContent='';$('status').className='status';resetReveal()}
function makeInput(parent,row,col,type,index,enabled=true,maxLength=1){const input=document.createElement('input');input.className='small-input'+(maxLength===2?' two':'');input.inputMode='numeric';input.maxLength=maxLength;input.autocomplete='off';input.dataset.type=type;input.dataset.index=index;input.style.gridRow=row;input.style.gridColumn=col;if(!enabled)input.disabled=true;input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'').slice(0,maxLength);input.classList.remove('good','bad');onEdit();if(type==='bottomreplacement'){const original=$('bottom-'+index);if(original)original.classList.toggle('changed',input.value!=='')}});parent.appendChild(input);return input}
function makeAnswer(parent,row,col,index){const input=document.createElement('input');input.className='answer';input.inputMode='numeric';input.maxLength=1;input.autocomplete='off';input.dataset.type='answer';input.dataset.index=index;input.style.gridRow=row;input.style.gridColumn=col;input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'').slice(-1);input.classList.remove('good','bad');onEdit()});parent.appendChild(input);return input}
function renderExercise(){
  exerciseSolved=false;
  resetReveal();
  const exam=isExamSession();
  $('solutionBtn').disabled=false;$('solutionBtn').style.display=exam?'none':'';
  document.querySelector('#exerciseScreen .actions').style.gridTemplateColumns=exam?'1fr':'';
  $('mainBtn').textContent=exam?'Siguiente':'Corregir';
  $('status').textContent='';
  $('status').className='status';
  $('exerciseLabel').textContent=labelOp(current.op);
  const host=$('math');
  host.innerHTML='';

  if(current.op==='div')return renderDivision(host);
  if(current.op==='add')return renderAddition(host);
  if(current.op==='mul')return renderMultiplication(host);

  const n=current.n,grid=document.createElement('div');
  grid.className='math';
  grid.style.setProperty('--digits',n);
  host.appendChild(grid);
  const A=digitsOf(current.a,n),B=digitsOf(current.b,n);
  let row=1;

  for(let i=0;i<n;i++)makeInput(grid,row,i+2,'borrow',i,true,1);
  row++;
  for(let i=0;i<n;i++)makeText(grid,row,i+2,A[i]);
  row++;
  for(let i=0;i<n;i++)makeInput(grid,row,i+2,'bottomreplacement',i,true,2);
  row++;
  makeText(grid,row,1,'−','op');
  for(let i=0;i<n;i++)makeText(grid,row,i+2,B[i],'digit','bottom-'+i);
  row++;
  const rule=document.createElement('div');
  rule.className='rule';rule.style.gridRow=row;grid.appendChild(rule);row++;
  const rs=String(current.result);
  if(rs.length>n)makeAnswer(grid,row,1,-1);
  for(let i=0;i<n;i++)makeAnswer(grid,row,i+2,i);
  setTimeout(focusLast,0);
}

function renderAddition(host){
  const n=current.n,grid=document.createElement('div');
  grid.className='math addition-math';
  grid.style.setProperty('--digits',n);
  host.appendChild(grid);
  let row=1;

  // Llevadas
  for(let i=0;i<n;i++)makeInput(grid,row,i+2,'addcarry',i,i<n-1,1);
  row++;

  // Las cifras son un máximo: los números más cortos quedan alineados a la derecha.
  current.operands.forEach((num,idx)=>{
    const raw=String(num),offset=n-raw.length;
    if(idx===current.operands.length-1)makeText(grid,row,1,'+','op');
    raw.split('').forEach((digit,i)=>makeText(grid,row,offset+i+2,digit));
    row++;
  });

  const rule=document.createElement('div');
  rule.className='rule';rule.style.gridRow=row;grid.appendChild(rule);row++;

  const rs=String(current.result);
  if(rs.length>n)makeAnswer(grid,row,1,-1);
  for(let i=0;i<n;i++)makeAnswer(grid,row,i+2,i);

  const note=document.createElement('div');
  note.className='addend-note';
  note.textContent=`${current.operands.length} líneas · hasta ${n} cifras por número`;
  host.appendChild(note);
  setTimeout(focusLast,0);
}

function renderMultiplication(host){
  const wrap=document.createElement('div');
  wrap.className='mul-process';
  host.appendChild(wrap);

  const paper=document.createElement('div');
  paper.className='mul-paper';
  const columns=Math.max(String(current.a).length+String(current.b).length,String(current.result).length);
  paper.style.setProperty('--mul-columns',columns);
  wrap.appendChild(paper);

  String(current.a).split('').forEach((digit,i)=>{
    const cell=document.createElement('div');
    cell.className='mul-number';
    cell.textContent=digit;
    cell.style.gridColumn=String(2+columns-current.n+i);
    paper.appendChild(cell);
  });

  const sign=document.createElement('div');
  sign.className='mul-sign';
  sign.textContent='×';
  sign.style.gridColumn='1';
  sign.style.gridRow='2';
  paper.appendChild(sign);

  String(current.b).split('').forEach((digit,i)=>{
    const multiplier=document.createElement('div');multiplier.className='mul-multiplier';multiplier.textContent=digit;multiplier.style.gridColumn=String(2+columns-String(current.b).length+i);multiplier.style.gridRow='2';paper.appendChild(multiplier);
  });

  const topRule=document.createElement('div');
  topRule.className='mul-rule';
  paper.appendChild(topRule);

  current.mulSteps.forEach((step,i)=>{
    const row=document.createElement('div');
    row.className='mul-step-row';row.dataset.mulStep=i;
    row.style.setProperty('--step',i);
    row.style.setProperty('--mul-columns',columns);

    if(step.topIndex===0){const label=document.createElement('div');label.className='mul-step-label';label.textContent=`×${step.multiplierDigit}`;row.appendChild(label)}
    const product=String(step.product).padStart(2,' ');
    const startColumn=columns-step.topIndex-step.multiplierIndex;
    product.split('').forEach((_,digitIndex)=>{
      const inp=document.createElement('input');
      inp.className='mul-step-input';
      inp.inputMode='numeric';
      inp.maxLength=1;
      inp.autocomplete='off';
      inp.dataset.type='mulstep';
      inp.dataset.step=i;
      inp.dataset.digit=digitIndex;
      inp.dataset.index=`${i}:${digitIndex}`;
      inp.setAttribute('aria-label',`${step.topDigit} por ${step.multiplierDigit}, cifra ${digitIndex+1}`);
      inp.title=`${step.topDigit} × ${step.multiplierDigit}`;
      inp.style.gridColumn=String(startColumn+digitIndex);
      inp.addEventListener('input',()=>{
        inp.value=inp.value.replace(/\D/g,'').slice(-1);
        inp.classList.remove('good','bad');
        onEdit();updateMultiplicationProgress();
      });
      row.appendChild(inp);
    });
    paper.appendChild(row);
  });

  const singleProduct=current.mulSteps.length===1;
  if(!singleProduct){
    const rule=document.createElement('div');rule.className='mul-rule';rule.dataset.mulFinal='true';paper.appendChild(rule);
    const final=document.createElement('div');final.className='mul-final';final.dataset.mulFinal='true';final.style.setProperty('--mul-columns',columns);
    const rs=String(current.result),len=rs.length;
    for(let i=0;i<len;i++){
      const inp=document.createElement('input');inp.className='answer';inp.inputMode='numeric';inp.maxLength=1;inp.autocomplete='off';inp.dataset.type='answer';inp.dataset.index=i;inp.style.gridColumn=String(2+columns-len+i);
      inp.addEventListener('input',()=>{inp.value=inp.value.replace(/\D/g,'').slice(-1);inp.classList.remove('good','bad');onEdit()});final.appendChild(inp);
    }
    paper.appendChild(final);
  }

  const note=document.createElement('div');
  note.className='mul-order-note';
  note.textContent=singleProduct?'Escribe directamente el producto':'Empieza por la cifra de la derecha del multiplicador';
  wrap.appendChild(note);
  updateMultiplicationProgress();setTimeout(()=>paper.querySelector('.mul-step-row:not(.mul-hidden) [data-type="mulstep"]')?.focus(),0);
}
function updateMultiplicationProgress(){
  if(current?.op!=='mul')return;
  const rows=[...document.querySelectorAll('#math [data-mul-step]')],final=[...document.querySelectorAll('#math [data-mul-final]')];
  if(isExamSession()){rows.forEach(x=>x.classList.remove('mul-hidden'));final.forEach(x=>x.classList.remove('mul-hidden'));return}
  rows.forEach(x=>x.classList.add('mul-hidden'));final.forEach(x=>x.classList.add('mul-hidden'));
  let pending=null;
  for(let i=0;i<rows.length;i++){
    const row=rows[i],inputs=[...row.querySelectorAll('[data-type="mulstep"]')],expected=String(current.stepProducts[i]).padStart(2,' ');
    row.classList.remove('mul-hidden');
    if(!inputs.every((inp,d)=>inp.value===expected[d].trim())){pending=inputs.find((inp,d)=>inp.value!==expected[d].trim());break}
    inputs.forEach(inp=>inp.classList.add('good'));
  }
  if(!pending&&rows.length===current.mulSteps.length)final.forEach(x=>x.classList.remove('mul-hidden'));
  document.querySelectorAll('#math .mul-current').forEach(x=>x.classList.remove('mul-current'));if(pending)pending.classList.add('mul-current');
}
function divisionAnswerInput(index){
  const inp=document.createElement('input');inp.className='answer';inp.inputMode='numeric';inp.maxLength=1;inp.autocomplete='off';inp.dataset.type='answer';inp.dataset.index=index;
  inp.dataset.step=index;inp.addEventListener('input',()=>{inp.value=inp.value.replace(/\D/g,'').slice(-1);inp.classList.remove('good','bad');onEdit();updateDivisionProgress()});return inp
}
function renderDivision(host){
  const work=document.createElement('div');work.className='division-work';
  const board=document.createElement('div');board.className='division-traditional';
  const left=document.createElement('div');left.className='division-left';
  const decimalCount=current.division.prefix.length+current.division.repeat.length;
  const totalColumns=String(current.a).length+decimalCount;
  left.style.setProperty('--div-cols',totalColumns);
  String(current.a).split('').forEach((digit,index)=>makeText(left,1,index+1,digit,'division-top-digit'));
  for(let i=0;i<decimalCount;i++){
    const zero=makeText(left,1,String(current.a).length+i+1,'0','division-top-digit division-fixed-digit decimal-zero');
    if(i===0)zero.dataset.comma='true';
  }
  const right=document.createElement('div');right.className='division-right-traditional';
  const divisor=document.createElement('div');divisor.className='divisor';divisor.textContent=current.b;
  const q=document.createElement('div');q.className='quotient-inputs';
  let answerIndex=0;
  String(current.division.integer).split('').forEach(()=>q.appendChild(divisionAnswerInput(answerIndex++)));
  if(current.division.kind!=='integer'){
    const comma=document.createElement('span');comma.className='decimal-comma';comma.textContent=',';q.appendChild(comma);
    current.division.prefix.forEach(()=>q.appendChild(divisionAnswerInput(answerIndex++)));
    if(current.division.repeat.length){
      const repeat=document.createElement('span');repeat.className='repeat-group';
      current.division.repeat.forEach(()=>repeat.appendChild(divisionAnswerInput(answerIndex++)));
      q.appendChild(repeat);
    }
  }
  right.append(divisor,q);
  current.divisionSteps.forEach((step,stepIndex)=>{
    const product=String(step.product),productRow=2+stepIndex*2,endColumn=step.column+1;
    const minus=makeText(left,productRow,Math.max(1,endColumn-product.length),'−','division-minus');minus.dataset.reveal='product';minus.dataset.step=stepIndex;
    product.split('').forEach((_,digitIndex)=>{
      const inp=document.createElement('input');inp.className='division-work-input';inp.inputMode='numeric';inp.maxLength=1;inp.autocomplete='off';inp.dataset.type='divproduct';inp.dataset.index=`${stepIndex}-${digitIndex}`;inp.style.gridRow=productRow;inp.style.gridColumn=endColumn-product.length+digitIndex+1;
      inp.dataset.step=stepIndex;inp.addEventListener('input',()=>{inp.value=inp.value.replace(/\D/g,'').slice(-1);inp.classList.remove('good','bad');onEdit();updateDivisionProgress()});left.appendChild(inp);
    });
    const rule=document.createElement('div');rule.className='division-sub-rule';rule.dataset.reveal='product';rule.dataset.step=stepIndex;rule.style.gridRow=productRow;rule.style.gridColumn=`${Math.max(1,endColumn-product.length)} / ${endColumn+1}`;left.appendChild(rule);
    const remainder=String(step.remainder),remainderRow=productRow+1;
    remainder.split('').forEach((_,digitIndex)=>{
      const inp=document.createElement('input');inp.className='division-work-input';inp.inputMode='numeric';inp.maxLength=1;inp.autocomplete='off';inp.dataset.type='divremainder';inp.dataset.index=`${stepIndex}-${digitIndex}`;inp.style.gridRow=remainderRow;inp.style.gridColumn=Math.max(1,endColumn-remainder.length+digitIndex+1);
      inp.dataset.step=stepIndex;inp.addEventListener('input',()=>{inp.value=inp.value.replace(/\D/g,'').slice(-1);inp.classList.remove('good','bad');onEdit();updateDivisionProgress()});left.appendChild(inp);
    });
    const next=current.divisionSteps[stepIndex+1];
    if(next){
      const lowered=String(next.partial).slice(-1),inp=document.createElement('input');
      inp.className='division-work-input';inp.inputMode='numeric';inp.maxLength=1;inp.autocomplete='off';inp.dataset.type='divlower';inp.dataset.index=stepIndex;inp.dataset.step=stepIndex;inp.dataset.expected=lowered;inp.style.gridRow=remainderRow;inp.style.gridColumn=next.column+1;
      inp.addEventListener('input',()=>{inp.value=inp.value.replace(/\D/g,'').slice(-1);inp.classList.remove('good','bad');onEdit();updateDivisionProgress()});left.appendChild(inp);
    }
  });
  board.append(left,right);work.appendChild(board);
  const names={integer:'entero exacto',terminating:'decimal exacto',pure:'periódico sencillo',mixed:'periódico mixto'};
  const note=document.createElement('div');note.className='division-note';note.textContent=`Resultado ${names[current.resultType]}.${current.division.repeat.length?' La línea morada marca el período.':''}`;work.appendChild(note);
  const guide=document.createElement('div');guide.className='division-guide';guide.innerHTML='<b>Divide · multiplica · resta · baja la siguiente cifra</b><br>Completa la cuenta directamente en su posición.';work.appendChild(guide);
  host.appendChild(work);updateDivisionProgress();setTimeout(()=>q.querySelector('.answer:not(.division-hidden)')?.focus(),0)
}
function updateDivisionProgress(){
  if(current?.op!=='div')return;
  const all=[...document.querySelectorAll('#math [data-step],#math [data-reveal]')];
  if(isExamSession()){all.forEach(el=>el.classList.remove('division-hidden','division-current','good','bad'));return}
  all.forEach(el=>el.classList.add('division-hidden'));
  let nextFocus=null;
  for(let stepIndex=0;stepIndex<current.divisionSteps.length;stepIndex++){
    const q=document.querySelector(`#math [data-type="answer"][data-step="${stepIndex}"]`),expectedQ=current.answerDigits[stepIndex];
    if(!q)break;
    q.classList.remove('division-hidden');
    if(q.value!==expectedQ){nextFocus=q;break}
    q.classList.add('good');
    const products=[...document.querySelectorAll(`#math [data-type="divproduct"][data-step="${stepIndex}"]`)];
    document.querySelectorAll(`#math [data-reveal="product"][data-step="${stepIndex}"]`).forEach(el=>el.classList.remove('division-hidden'));
    products.forEach(el=>el.classList.remove('division-hidden'));
    const expectedProduct=String(current.divisionSteps[stepIndex].product);
    if(!products.every((el,i)=>el.value===expectedProduct[i])){nextFocus=products.find((el,i)=>el.value!==expectedProduct[i]);break}
    products.forEach(el=>el.classList.add('good'));
    const remainders=[...document.querySelectorAll(`#math [data-type="divremainder"][data-step="${stepIndex}"]`)];
    remainders.forEach(el=>el.classList.remove('division-hidden'));
    const expectedRemainder=String(current.divisionSteps[stepIndex].remainder);
    if(!remainders.every((el,i)=>el.value===expectedRemainder[i])){nextFocus=remainders.find((el,i)=>el.value!==expectedRemainder[i]);break}
    remainders.forEach(el=>el.classList.add('good'));
    const lower=document.querySelector(`#math [data-type="divlower"][data-step="${stepIndex}"]`);
    if(lower){
      lower.classList.remove('division-hidden');
      if(lower.value!==lower.dataset.expected){nextFocus=lower;break}
      lower.classList.add('good');
    }
  }
  document.querySelectorAll('#math .division-current').forEach(el=>el.classList.remove('division-current'));
  if(nextFocus)nextFocus.classList.add('division-current');
}
function focusLast(){const arr=[...document.querySelectorAll('#math .answer')];if(arr.length)arr[arr.length-1].focus()}

function expectedMap(){
  const s=String(current.result),map={};
  if(current.op==='div'||current.op==='mul'){
    (current.op==='div'?current.answerDigits:s).split('').forEach((c,i)=>map[i]=c);
    return map;
  }
  const n=current.n;
  if(s.length>n){
    map[-1]=s[0];
    const rest=s.slice(1).padStart(n,'0');
    for(let i=0;i<n;i++)map[i]=rest[i];
  }else{
    const rest=s.padStart(n,'0');
    for(let i=0;i<n;i++)map[i]=rest[i];
  }
  return map;
}
function enteredAnswer(){
  const inputs=[...document.querySelectorAll('#math [data-type="answer"]')];
  if(current.op==='div'||current.op==='mul'){
    if(current.op==='mul'&&!inputs.length)return[...document.querySelectorAll('#math [data-type="mulstep"]')].sort((a,b)=>+a.dataset.digit-+b.dataset.digit).map(x=>x.value).join('')||'—';
    return inputs.sort((a,b)=>+a.dataset.index-+b.dataset.index).map(x=>x.value).join('')||'—';
  }
  const extra=inputs.find(x=>+x.dataset.index===-1);
  let s=extra?extra.value:'';
  for(let i=0;i<current.n;i++){
    const x=inputs.find(el=>+el.dataset.index===i);
    s+=x?.value||'';
  }
  return s||'—';
}
function snapshotWork(){const values={};document.querySelectorAll('#math input').forEach(inp=>values[`${inp.dataset.type}:${inp.dataset.index}`]=inp.value);return values}
function isCurrentCorrect(){
  const ans=expectedMap();
  if([...document.querySelectorAll('#math [data-type="answer"]')].some(inp=>inp.value!==(ans[+inp.dataset.index]??'')))return false;
  if(current.op==='add'&&[...document.querySelectorAll('[data-type="addcarry"]')].some(inp=>!inp.disabled&&!(inp.value===(current.carries[+inp.dataset.index]?String(current.carries[+inp.dataset.index]):'')||(!current.carries[+inp.dataset.index]&&inp.value==='0'))))return false;
  if(current.op==='mul'&&[...document.querySelectorAll('[data-type="mulstep"]')].some(inp=>inp.value!==String(current.stepProducts[+inp.dataset.step]).padStart(2,' ')[+inp.dataset.digit].trim()))return false;
  if(current.op==='sub'){
    if([...document.querySelectorAll('[data-type="borrow"]')].some(inp=>{const exp=current.borrowTop[+inp.dataset.index]?'1':'';return inp.value!==exp&&!(exp===''&&inp.value==='0')}))return false;
    if([...document.querySelectorAll('[data-type="bottomreplacement"]')].some(inp=>{const repl=current.bottomReplacement[+inp.dataset.index],exp=repl===null?'':String(repl);return inp.value!==exp&&!(exp===''&&inp.value==='0')}))return false;
  }
  if(current.op==='div'){
    if([...document.querySelectorAll('[data-type="divproduct"],[data-type="divremainder"]')].some(inp=>{const [si,di]=inp.dataset.index.split('-').map(Number),step=current.divisionSteps[si];return inp.value!==String(inp.dataset.type==='divproduct'?step.product:step.remainder)[di]}))return false;
    if([...document.querySelectorAll('[data-type="divlower"]')].some(inp=>inp.value!==inp.dataset.expected))return false;
  }
  return true;
}
function expressionCurrent(){return current.op==='add'?`${current.operands.join(' + ')} = ${current.result}`:`${current.a} ${symbolOp(current.op)} ${current.b} = ${current.result}`}
function examMistakes(){
  const mistakes=[],ans=expectedMap(),name={answer:'resultado',addcarry:'llevada',borrow:'préstamo',bottomreplacement:'número modificado',mulstep:'producto parcial',divproduct:'producto',divremainder:'resto',divlower:'cifra bajada'};
  document.querySelectorAll('#math input').forEach(inp=>{
    if(inp.disabled)return;let exp='',valid=false,type=inp.dataset.type;
    if(type==='answer'){exp=ans[+inp.dataset.index]??'';valid=inp.value===exp}
    else if(type==='addcarry'){exp=current.carries[+inp.dataset.index]?String(current.carries[+inp.dataset.index]):'';valid=inp.value===exp||(exp===''&&inp.value==='0')}
    else if(type==='mulstep'){exp=String(current.stepProducts[+inp.dataset.step]).padStart(2,' ')[+inp.dataset.digit].trim();valid=inp.value===exp}
    else if(type==='borrow'){exp=current.borrowTop[+inp.dataset.index]?'1':'';valid=inp.value===exp||(exp===''&&inp.value==='0')}
    else if(type==='bottomreplacement'){const repl=current.bottomReplacement[+inp.dataset.index];exp=repl===null?'':String(repl);valid=inp.value===exp||(exp===''&&inp.value==='0')}
    else if(type==='divproduct'||type==='divremainder'){const [si,di]=inp.dataset.index.split('-').map(Number),step=current.divisionSteps[si];exp=String(type==='divproduct'?step.product:step.remainder)[di];valid=inp.value===exp}
    else if(type==='divlower'){exp=inp.dataset.expected;valid=inp.value===exp}else return;
    if(!valid)mistakes.push(`${name[type]||'casilla'}: ${inp.value||'vacío'} → ${exp||'vacío'}`)
  });return mistakes
}
function submitExamExercise(){
  const correct=isCurrentCorrect(),answer=enteredAnswer(),expression=expressionCurrent(),mistakes=examMistakes();
  if(sessionMode==='exam'){record.attempts.push({at:new Date().toISOString(),answer,correct,work:snapshotWork()});commitRecord()}else record=null;
  examResults.push({correct,answer,expression,operation:current.op,mistakes});completedThisSession++;
  advanceQueuedExercise();
}
function advanceQueuedExercise(){
  queueIndex++;
  if(queueIndex<exerciseQueue.length){newExercise(exerciseQueue[queueIndex]);return}
  if(sessionMode==='exam')showExamResults();else if(sessionMode==='supportExam')showSupportResults();else showPracticeResults();
}
function showSupportResults(){
  const correct=examResults.filter(x=>x.correct).length,passed=correct===4;
  $('supportResultMessage').textContent=passed?'¡Ahora sí te creemos! 😄 Gracias de corazón por valorar el trabajo y por ese café.':'¡Casi! Parece que todavía necesitas un poco más de práctica 😄';
  $('supportScore').textContent=`${correct} / 4`;
  $('supportReview').innerHTML=examResults.map((x,i)=>`<div class="exam-review-item ${x.correct?'ok':'fail'}"><div>${i+1}. ${escapeHtml(x.expression)} · ${x.correct?'✓':`Tu respuesta final: ${escapeHtml(x.answer)} ✗`}</div>${x.mistakes?.length?`<small>${x.mistakes.map(m=>escapeHtml(m)).join(' · ')}</small>`:''}</div>`).join('');
  $('openSupportLink').style.display=passed?'inline-grid':'none';$('retrySupportBtn').style.display=passed?'none':'';showScreen('supportResultScreen');
}
function leaveSupportChallenge(){sessionMode='single';exerciseQueue=[];examResults=[];queueIndex=0;record=null;showScreen('userScreen');renderUsers()}
function startSupportChallenge(){
  exerciseQueue=shuffled([
    {op:'add',settings:{digits:3,count:3,carry:'yes'}},
    {op:'sub',settings:{digits:3,carry:'yes'}},
    {op:'mul',settings:{multiplicandDigits:2,multiplierDigits:1}},
    {op:'div',settings:{dividendDigits:2,divisorDigits:1,resultType:'integer'}}
  ]);queueIndex=0;examResults=[];practiceResults=[];completedThisSession=0;sessionMode='supportExam';showScreen('exerciseScreen');newExercise(exerciseQueue[0]);
}
function showExamResults(){
  const correct=examResults.filter(x=>x.correct).length,total=examResults.length,grade=examGrade(correct,total),motivation=examMotivation(grade);
  registerCompletedSession('exam',{correct,total,grade});
  $('resultTitle').textContent='Resultado del examen';
  $('examScore').innerHTML=`<span class="exam-sticker">${motivation.icon}</span><b>${formatGrade(grade)}/10</b><small>${motivation.message}</small><em>${correct} de ${total} ejercicios correctos</em>`;
  $('examReview').innerHTML=examResults.map((x,i)=>`<div class="exam-review-item ${x.correct?'ok':'fail'}"><div>${i+1}. ${escapeHtml(x.expression)} · ${x.correct?'✓':`Tu respuesta final: ${escapeHtml(x.answer)} ✗`}</div>${x.mistakes?.length?`<small>${x.mistakes.map(m=>escapeHtml(m)).join(' · ')}</small>`:''}</div>`).join('');
  showScreen('examResultScreen');
}
function showPracticeResults(){
  registerCompletedSession('practice');
  $('resultTitle').textContent='Resumen de la práctica';
  $('examScore').textContent=`${practiceResults.length} ejercicio${practiceResults.length===1?'':'s'}`;
  $('examReview').innerHTML=practiceResults.map((x,i)=>`<div class="exam-review-item ${x.correct?'ok':x.solutionUsed?'':'fail'}"><div>${i+1}. ${escapeHtml(x.expression)}</div><small>Intentos: ${x.attempts} · ${x.correct?'Completado correctamente ✓':x.solutionUsed?'Completado con la respuesta':'Sin completar'}${x.solutionUsed?' · Usó Ver respuesta':' · Sin ver la respuesta'}</small></div>`).join('');
  showScreen('examResultScreen');
}
function grade(){
  let ok=true;
  const ans=expectedMap();
  document.querySelectorAll('#math input').forEach(x=>x.classList.remove('good','bad'));

  document.querySelectorAll('#math [data-type="answer"]').forEach(inp=>{
    if((current.op==='div'&&inp.classList.contains('division-hidden'))||(current.op==='mul'&&inp.closest('.mul-hidden'))){ok=false;return}
    const exp=ans[+inp.dataset.index]??'';
    const good=inp.value===exp;
    inp.classList.add(good?'good':'bad');
    if(!good)ok=false;
  });

  if(current.op==='add'){
    document.querySelectorAll('[data-type="addcarry"]').forEach(inp=>{
      if(inp.disabled)return;
      const exp=current.carries[+inp.dataset.index]?String(current.carries[+inp.dataset.index]):'';
      const good=inp.value===exp||(exp===''&&inp.value==='0');
      inp.classList.add(good?'good':'bad');
      if(!good)ok=false;
    });
  }else if(current.op==='mul'){
    document.querySelectorAll('[data-type="mulstep"]').forEach(inp=>{
      if(inp.closest('.mul-hidden')){ok=false;return}
      const exp=String(current.stepProducts[+inp.dataset.step]).padStart(2,' ')[+inp.dataset.digit].trim();
      const good=inp.value===exp;
      inp.classList.add(good?'good':'bad');
      if(!good)ok=false;
    });
  }else if(current.op==='div'){
    document.querySelectorAll('[data-type="divproduct"],[data-type="divremainder"]').forEach(inp=>{
      if(inp.classList.contains('division-hidden')){ok=false;return}
      const [stepIndex,digitIndex]=inp.dataset.index.split('-').map(Number),step=current.divisionSteps[stepIndex];
      const exp=String(inp.dataset.type==='divproduct'?step.product:step.remainder)[digitIndex];
      const good=inp.value===exp;inp.classList.add(good?'good':'bad');if(!good)ok=false;
    });
    document.querySelectorAll('[data-type="divlower"]').forEach(inp=>{
      if(inp.classList.contains('division-hidden')){ok=false;return}
      const good=inp.value===inp.dataset.expected;inp.classList.add(good?'good':'bad');if(!good)ok=false;
    });
  }else if(current.op==='sub'){
    document.querySelectorAll('[data-type="borrow"]').forEach(inp=>{
      const exp=current.borrowTop[+inp.dataset.index]?'1':'';
      const good=inp.value===exp||(exp===''&&inp.value==='0');
      inp.classList.add(good?'good':'bad');
      if(!good)ok=false;
    });
    document.querySelectorAll('[data-type="bottomreplacement"]').forEach(inp=>{
      const repl=current.bottomReplacement[+inp.dataset.index];
      const exp=repl===null?'':String(repl);
      const good=inp.value===exp||(exp===''&&inp.value==='0');
      inp.classList.add(good?'good':'bad');
      if(!good)ok=false;
      const original=$('bottom-'+inp.dataset.index);
      if(original)original.classList.toggle('changed',inp.value!=='');
    });
  }

  record.attempts.push({at:new Date().toISOString(),answer:enteredAnswer(),correct:ok,work:snapshotWork()});

  if(ok){
    exerciseSolved=true;
    $('status').textContent='¡Muy bien! ✓';
    $('status').className='status ok';
    $('mainBtn').textContent='Siguiente';
    $('solutionBtn').disabled=true;
    commitRecord();
    completedThisSession++;
    updateCounter();
  }else{
    $('status').textContent='Revisa las casillas en rojo';
    $('status').className='status error';
  }
  return ok;
}
function fillSolution(){
  const ans=expectedMap();

  document.querySelectorAll('#math [data-type="answer"]').forEach(inp=>{
    inp.value=ans[+inp.dataset.index]??'';
    inp.classList.remove('bad');
    inp.classList.add('good');
  });

  if(current.op==='add'){
    document.querySelectorAll('[data-type="addcarry"]').forEach(inp=>{
      if(!inp.disabled){
        inp.value=current.carries[+inp.dataset.index]?String(current.carries[+inp.dataset.index]):'';
        inp.classList.add('good');
      }
    });
  }else if(current.op==='mul'){
    document.querySelectorAll('[data-type="mulstep"]').forEach(inp=>{
      inp.value=String(current.stepProducts[+inp.dataset.step]).padStart(2,' ')[+inp.dataset.digit].trim();
      inp.classList.remove('bad');
      inp.classList.add('good');
    });
    updateMultiplicationProgress();
  }else if(current.op==='div'){
    document.querySelectorAll('[data-type="divproduct"],[data-type="divremainder"]').forEach(inp=>{
      const [stepIndex,digitIndex]=inp.dataset.index.split('-').map(Number),step=current.divisionSteps[stepIndex];
      inp.value=String(inp.dataset.type==='divproduct'?step.product:step.remainder)[digitIndex];inp.classList.remove('bad');inp.classList.add('good');
    });
    document.querySelectorAll('[data-type="divlower"]').forEach(inp=>{inp.value=inp.dataset.expected;inp.classList.remove('bad','division-hidden');inp.classList.add('good')});
    document.querySelectorAll('[data-reveal="product"]').forEach(el=>el.classList.remove('division-hidden'));
    updateDivisionProgress();
  }else if(current.op==='sub'){
    document.querySelectorAll('[data-type="borrow"]').forEach(inp=>{
      inp.value=current.borrowTop[+inp.dataset.index]?'1':'';
      inp.classList.add('good');
    });
    document.querySelectorAll('[data-type="bottomreplacement"]').forEach(inp=>{
      const repl=current.bottomReplacement[+inp.dataset.index];
      inp.value=repl===null?'':String(repl);
      inp.classList.add('good');
      const original=$('bottom-'+inp.dataset.index);
      if(original)original.classList.toggle('changed',repl!==null);
    });
  }

  record.solutionUsed=true;
  exerciseSolved=true;
  $('status').textContent='Respuesta mostrada';
  $('status').className='status ok';
  $('mainBtn').textContent='Siguiente';
  $('solutionBtn').disabled=true;
  resetReveal();
  commitRecord();
  completedThisSession++;
  updateCounter();
}
function commitRecord(){
  if(!record||!currentUser)return;
  record.completedAt=new Date().toISOString();
  if(sessionMode==='practice')practiceResults.push({expression:record.operation==='add'&&record.operands?.length?`${record.operands.join(' + ')} = ${record.result}`:`${record.a} ${symbolOp(record.operation)} ${record.b} = ${record.result}`,attempts:record.attempts.length,correct:record.attempts.some(x=>x.correct),solutionUsed:record.solutionUsed});
  db.users[currentUser].history.push(record);saveDB();record=null
}
function resetReveal(){revealConfirm=false;$('solutionBtn').textContent='Ver respuesta';$('solutionBtn').classList.remove('confirm')}
function updateCounter(){$('counter').textContent=sessionMode==='single'?`Hechas: ${completedThisSession} · Total: ${totalDone(currentUser)}`:`Ejercicio ${queueIndex+1} de ${exerciseQueue.length}`}

function infoHtml(){
  if(selectedOp==='add')return '<p><b>Sumas:</b> escribe las llevadas en las casillas pequeñas de arriba y el resultado debajo de la línea.</p><p>Los números pueden tener distinta cantidad de cifras y se alinean por la derecha.</p>';
  if(selectedOp==='sub')return '<p><b>Restas:</b> si no puedes restar, escribe un <b>1 arriba</b> para añadir 10.</p><p>Ese 1 pasa a la columna de la izquierda: <b>súmalo al número de abajo y escribe su nuevo valor</b>. El número anterior se tacha automáticamente.</p>';
  if(selectedOp==='mul')return '<p><b>Multiplicaciones:</b> elige por separado las cifras del multiplicando y del multiplicador. Empieza por la cifra derecha del multiplicador y calcula cada pareja de cifras por separado.</p><p>Las casillas se colocan escalonadas según su posición. Después escribe el resultado final debajo de la línea.</p>';
  return '<p><b>Divisiones:</b> elige las cifras del dividendo y del divisor, y practica resultados enteros, decimales exactos o periódicos.</p><p>Sigue el método tradicional: escribe una cifra del cociente, multiplica por el divisor, coloca el producto debajo, resta y baja la siguiente cifra. La línea morada indica las cifras periódicas.</p>';
}
let historyMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1),selectedHistoryDate='';
function localDateKey(value){const d=new Date(value),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return`${y}-${m}-${day}`}
function historyExpression(x){return x.operation==='add'&&x.operands?.length?x.operands.join(' + '):`${x.a} ${symbolOp(x.operation)} ${x.b}`}
function activityStreak(keys){
  const active=new Set(keys),cursor=new Date();cursor.setHours(12,0,0,0);
  if(!active.has(localDateKey(cursor)))cursor.setDate(cursor.getDate()-1);
  let streak=0;while(active.has(localDateKey(cursor))){streak++;cursor.setDate(cursor.getDate()-1)}return streak
}
function renderCalendar(hist){
  const dayCounts={};hist.forEach(x=>{const key=localDateKey(x.date);dayCounts[key]=(dayCounts[key]||0)+1});const active=new Set(Object.keys(dayCounts)),sessions=sessionsForUser(),practiceDays=new Set(sessions.filter(x=>x.mode==='practice').map(x=>localDateKey(x.date))),bestExamByDay={};sessions.filter(x=>x.mode==='exam'&&Number.isFinite(x.grade)).forEach(x=>{const key=localDateKey(x.date);bestExamByDay[key]=Math.max(bestExamByDay[key]??-1,x.grade)});const year=historyMonth.getFullYear(),month=historyMonth.getMonth(),first=(new Date(year,month,1).getDay()+6)%7,days=new Date(year,month+1,0).getDate();
  let cells='<div class="calendar-week">'+['L','M','X','J','V','S','D'].map(x=>`<span>${x}</span>`).join('')+'</div><div class="calendar-grid">';
  for(let i=0;i<first;i++)cells+='<span class="calendar-day empty"></span>';
  for(let day=1;day<=days;day++){const key=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,examGradeForDay=bestExamByDay[key];cells+=`<button class="calendar-day ${active.has(key)?'has-work':''} ${selectedHistoryDate===key?'selected':''}" data-history-day="${key}" title="${dayCounts[key]||0} ejercicios"><span class="calendar-number">${day}</span><span class="calendar-marks">${practiceDays.has(key)?'<i title="Modo ejercicios completado">✓</i>':''}${Number.isFinite(examGradeForDay)?`<b title="Mejor nota del día">★ ${formatGrade(examGradeForDay)}</b>`:''}</span></button>`}
  cells+='</div>';
  $('historyCalendar').innerHTML=`<div class="calendar-head"><button data-calendar-move="-1">‹</button><b>${historyMonth.toLocaleDateString('es-ES',{month:'long',year:'numeric'})}</b><button data-calendar-move="1">›</button></div>${cells}`;
  $('historyCalendar').querySelectorAll('[data-calendar-move]').forEach(btn=>btn.onclick=()=>{historyMonth=new Date(year,month+(+btn.dataset.calendarMove),1);renderHistoryCalendar(currentUser)});
  $('historyCalendar').querySelectorAll('[data-history-day]').forEach(btn=>btn.onclick=()=>{selectedHistoryDate=btn.dataset.historyDay;renderHistoryCalendar(currentUser)});
}
function historySummaryItems(hist){
  const period=$('historyPeriod')?.value||'month';if(period==='all')return hist;
  const days={week:7,month:30,year:365}[period],limit=Date.now()-days*86400000;return hist.filter(x=>new Date(x.date).getTime()>=limit)
}
function historyPeriodLabel(){return({week:'última semana',month:'último mes',year:'último año',all:'todo el historial'})[$('historyPeriod')?.value||'month']}
function renderHistoryCalendar(name){
  const hist=[...historyFor(name)].sort((a,b)=>new Date(b.date)-new Date(a.date)),summaryHist=historySummaryItems(hist);$('historyUser').textContent=name?`${name} · resumen: ${historyPeriodLabel()}`:'Selecciona un usuario';
  if(!name||!db.users[name]){$('stats').innerHTML='';$('streakNote').textContent='';$('historyCalendar').innerHTML='';$('historyList').innerHTML='<div class="empty">No hay un usuario seleccionado.</div>';$('clearHistory').style.display='none';return}
  $('clearHistory').style.display='inline-block';const total=summaryHist.length,firstTry=summaryHist.filter(x=>x.attempts?.length===1&&x.attempts[0].correct&&!x.solutionUsed).length,solutions=summaryHist.filter(x=>x.solutionUsed).length,streak=activityStreak(hist.map(x=>localDateKey(x.date)));
  $('stats').innerHTML=`<div class="stat"><b>${total}</b><span>ejercicios</span></div><div class="stat"><b>${firstTry}</b><span>a la primera</span></div><div class="stat"><b>${solutions}</b><span>con respuesta</span></div><div class="stat"><b>${streak}</b><span>días de racha</span></div>`;
  $('streakNote').textContent=streak?`🔥 ${streak} día${streak===1?'':'s'} seguido${streak===1?'':'s'} practicando`:'Haz un ejercicio hoy para comenzar una racha';
  if(!selectedHistoryDate)selectedHistoryDate=hist.length?localDateKey(hist[0].date):localDateKey(new Date());renderCalendar(hist);
  const dayHist=hist.filter(x=>localDateKey(x.date)===selectedHistoryDate),daySessions=sessionsForUser().filter(x=>localDateKey(x.date)===selectedHistoryDate),practiceDone=daySessions.some(x=>x.mode==='practice'),bestDayExam=bestExamSession(daySessions),dateLabel=new Date(`${selectedHistoryDate}T12:00:00`).toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'}),dayAchievements=`<div class="day-achievements">${practiceDone?'<span>✓ Modo ejercicios completado</span>':''}${bestDayExam?`<span>★ Mejor nota: <b>${formatGrade(bestDayExam.grade)}/10</b> · ${examMotivation(bestDayExam.grade).icon} ${examMotivation(bestDayExam.grade).message}</span>`:''}</div>`;
  if(!dayHist.length){$('historyList').innerHTML=`<div class="history-day-title">${dateLabel}</div>${dayAchievements}<div class="empty">No se hicieron ejercicios este día.</div>`;return}
  const counts=['add','sub','mul','div'].map(op=>{const n=dayHist.filter(x=>x.operation===op).length;return n?`<span class="tag">${labelOp(op)}: ${n}</span>`:''}).join('');
  $('historyList').innerHTML=`<div class="history-day-title">${dateLabel}</div>${dayAchievements}<div>${counts}</div>`+dayHist.map(x=>{const tries=(x.attempts||[]).map((a,i)=>`<span class="tag ${a.correct?'oktag':'badtag'}">${i+1}: ${escapeHtml(a.answer)} ${a.correct?'✓':'✗'}</span>`).join(' '),sol=x.solutionUsed?'<span class="tag">vio respuesta</span>':'';return`<div class="history-item"><div class="history-top"><div><div class="expression">${historyExpression(x)} = ${x.result}</div><span class="tag">${labelOp(x.operation)}</span></div></div><div class="attempts">${tries||'<span class="tag">sin correcciones</span>'} ${sol}</div></div>`}).join('');
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

$('backUsersBtn').onclick=()=>{showScreen('userScreen');renderUsers()};
$('supportProjectBtn').onclick=()=>showScreen('supportIntroScreen');
$('backSupportIntroBtn').onclick=leaveSupportChallenge;$('declineSupportBtn').onclick=leaveSupportChallenge;
$('acceptSupportBtn').onclick=startSupportChallenge;
$('backSupportResultBtn').onclick=leaveSupportChallenge;$('leaveSupportBtn').onclick=leaveSupportChallenge;
$('retrySupportBtn').onclick=startSupportChallenge;
$('backSettingsBtn').onclick=()=>{showScreen('operationScreen');updateOperationStats()};
$('saveSettingsBtn').onclick=()=>{persistUserConfig();$('settingsSaveNote').textContent='Ajustes guardados';setTimeout(()=>{$('settingsSaveNote').textContent='';showScreen('operationScreen');updateOperationStats()},650)};
$('backOperationsBtn').onclick=()=>{showScreen('operationScreen');updateOperationStats()};
$('backProgramBtn').onclick=()=>{showScreen('operationScreen');updateOperationStats()};
$('startProgramBtn').onclick=startProgram;
$('saveProgramBtn').onclick=saveCurrentProgram;
$('startBtn').onclick=()=>{
  if(!currentUser||!db.users[currentUser])return showScreen('userScreen');
  sessionMode='single';exerciseQueue=[];queueIndex=0;
  completedThisSession=0;
  updateCounter();
  showScreen('exerciseScreen');
  newExercise();
};
$('backBtn').onclick=()=>{if(sessionMode==='supportExam'){record=null;showScreen('supportIntroScreen');return}showScreen('operationScreen');updateOperationStats()};
$('mainBtn').onclick=()=>{if(isExamSession())return submitExamExercise();if(exerciseSolved)return sessionMode==='practice'?advanceQueuedExercise():newExercise();grade()};
$('finishExamBtn').onclick=()=>{sessionMode='single';showScreen('operationScreen');updateOperationStats()};
$('solutionBtn').onclick=()=>{
  if(!revealConfirm){
    revealConfirm=true;
    $('solutionBtn').textContent='¿Seguro?';
    $('solutionBtn').classList.add('confirm');
    setTimeout(()=>{if(revealConfirm)resetReveal()},4000);
  }else fillSolution()
};
$('infoBtn').onclick=()=>{$('infoText').innerHTML=infoHtml();$('infoModal').classList.add('show')};
$('closeInfo').onclick=()=>$('infoModal').classList.remove('show');
$('infoModal').onclick=e=>{if(e.target===$('infoModal'))$('infoModal').classList.remove('show')};
$('historyBtn').onclick=()=>{historyMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);selectedHistoryDate='';renderHistoryCalendar(currentUser);$('historyModal').classList.add('show')};
$('historyPeriod').onchange=()=>renderHistoryCalendar(currentUser);
$('closeHistory').onclick=()=>$('historyModal').classList.remove('show');
$('historyModal').onclick=e=>{if(e.target===$('historyModal'))$('historyModal').classList.remove('show')};
$('closeParentGate').onclick=()=>$('parentGateModal').classList.remove('show');
$('parentGateModal').onclick=e=>{if(e.target===$('parentGateModal'))$('parentGateModal').classList.remove('show')};
function openParentGate(){$('parentAnswer').value='';$('parentGateStatus').textContent='';$('parentGateModal').classList.add('show');setTimeout(()=>$('parentAnswer').focus(),0)}
function validateParentGate(){
  if($('parentAnswer').value.trim().toLowerCase()!=='oli'){$('parentGateStatus').textContent='Pregunta a un adulto';$('parentGateStatus').className='status bad';return}
  $('parentGateModal').classList.remove('show');renderSettings();showScreen('settingsScreen');
}
$('parentGateBtn').onclick=validateParentGate;$('parentAnswer').onkeydown=e=>{if(e.key==='Enter')validateParentGate()};
$('settingsBtn').onclick=openParentGate;
$('clearHistory').onclick=()=>{
  if(!currentUser||!db.users[currentUser])return;
  if(confirm(`¿Borrar todo el historial de ${currentUser}?`)){
    db.users[currentUser].history=[];
    db.users[currentUser].sessions=[];
    saveDB();
    renderHistoryCalendar(currentUser);
    updateOperationStats();
    renderUsers();
  }
};

/* Instalación y actualizaciones PWA */
let deferredInstallPrompt=null,swRegistration=null,refreshing=false;
function updateConnectionStatus(){$('offlineBadge').classList.toggle('show',!navigator.onLine)}
window.addEventListener('online',()=>{updateConnectionStatus();swRegistration?.update().catch(()=>{})});
window.addEventListener('offline',updateConnectionStatus);
updateConnectionStatus();
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event});
function showUpdate(){if(navigator.serviceWorker.controller)$('updateBanner').classList.add('show')}
$('updateBtn').onclick=()=>{if(swRegistration?.waiting)swRegistration.waiting.postMessage({type:'SKIP_WAITING'})};
if('serviceWorker'in navigator){
  window.addEventListener('load',async()=>{
    try{
      swRegistration=await navigator.serviceWorker.register('./service-worker.js');
      if(swRegistration.waiting)showUpdate();
      swRegistration.addEventListener('updatefound',()=>{
        const nw=swRegistration.installing;
        nw?.addEventListener('statechange',()=>{if(nw.state==='installed'&&navigator.serviceWorker.controller)showUpdate()})
      });
      swRegistration.update().catch(()=>{})
    }catch(e){}
  });
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;location.reload()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')swRegistration?.update().catch(()=>{})})
}

renderUsers();



