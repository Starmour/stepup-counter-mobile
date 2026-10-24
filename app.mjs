import {StepUpEngine,extractObservation} from './engine.mjs';
import {NORMS,calculateScore} from './norms.mjs';
const PACKAGE='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/+esm';
const WASM='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const MODEL='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const DURATION=600_000;
const $=id=>document.getElementById(id);
const video=$('video'),stage=$('stage'),overlay=$('overlay'),ctx=overlay.getContext('2d');
const engine=new StepUpEngine();
let model=null,stream=null,runningCamera=false,loading=false,session='idle',startedAt=null,finishedAt=null;
let latestPose=null,latestObservation=null,frameId=0,lastFrameTime=-1,lastProcessed=0;
let calibrationMode=null,floorY=null,stepY=null,facing='environment', events=[],notifyTimeout=0;
let savedSession=null, clockTicker=0;
const EDGES=[[11,12],[11,13],[12,14],[13,15],[14,16],[11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],[30,32]];
function cameraStatus(label,type=''){$('camStatus').textContent=label;$('camStatus').className=`badge ${type}`;}
function msg(str,type=''){$('lastMessage').textContent=str;$('lastMessage').className=`message ${type}`;}
function ready(){return runningCamera && !loading && floorY!==null && stepY!==null && floorY-stepY>=.055 && $('heightConfirmed').checked;}
function syncUI(){
 const engaged=session==='active'; const finished=session==='finished';
 $('camBtn').disabled=loading||runningCamera||engaged;
 $('camBtn').textContent=loading?'Загрузка модели…':'Включить камеру';
 $('camOffBtn').disabled=!runningCamera||engaged;
 $('flipBtn').disabled=loading||engaged;
 $('floorBtn').disabled=!runningCamera||engaged;
 $('stepBtn').disabled=!runningCamera||engaged;
 $('marchBtn').disabled=engaged||finished||!ready();
 $('finishBtn').disabled=!engaged;
 $('newBtn').hidden=!finished;
 $('age').disabled=engaged||finished;
 $('heightConfirmed').disabled=engaged||finished;
 $('exportBtn').disabled=events.length===0;
 $('readyMsg').className=ready()?'readymsg ok':'readymsg';
 $('readyMsg').textContent=engaged?'Идёт выполнение: фиксированный интервал 10:00.':finished?'Выполнение завершено. Результат зафиксирован.':
 !runningCamera?'Подключите камеру и укажите уровни.':!$('heightConfirmed').checked?'Подтвердите высоту и устойчивость платформы.':floorY===null||stepY===null?'Отметьте обе горизонтальные линии на видео.':floorY-stepY<.055?'Ошибка: линия тумбы должна быть выше линии пола и достаточно удалена от неё.':'Готово. Встаньте перед тумбой, обе стопы на полу, нажмите «МАРШ».';
}
function renderNormTable(){
 const group=$('age').value,sc=calculateScore(engine.count,group);
 const tbody=$('normRows'); tbody.replaceChildren();
 for(const row of NORMS){const tr=document.createElement('tr');if(row.score===sc.score)tr.className='hit';for(const val of [row.score,row.young,row.older]){const cell=document.createElement('td');cell.textContent=val;tr.append(cell);}tbody.append(tr);}
 const min=sc.minCount;
 $('count').textContent=engine.count.toLocaleString('ru-RU');
 $('rejects').textContent=engine.rejected.toLocaleString('ru-RU');
 $('points').textContent=sc.score===null?'–':String(sc.score);
 $('scoreHint').textContent=sc.score===null?`Ниже таблицы: ещё ${min-engine.count} до ${min} повторений (2 балла)`:
 sc.nextCount!==null?`${sc.score} балл${scoreSuffix(sc.score)} · до ${sc.nextScore} баллов: ещё ${sc.nextCount-engine.count} повторений`:'Достигнута максимальная оценка 100 баллов';
 $('normIntro').textContent=`Для категории «${group==='young'?'до 35 лет':'35 лет и старше'}»: максимальная оценка 100 баллов при ${sc.maxCount} и более. Порог на 2 балла – ${sc.minCount}.`;
}
function scoreSuffix(n){return n%10===1&&n%100!==11?'':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'а':'ов';}
function updateClock(){
 let elapsed=session==='idle'?0:Math.max(0,(session==='finished'?finishedAt:Date.now())-startedAt);
 if(session==='active'&&elapsed>=DURATION){finish(false);elapsed=DURATION;}
 const remaining=Math.max(0,Math.ceil((DURATION-elapsed)/1000));
 $('clock').textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
 $('clock').className='time'+(remaining===0?' done':remaining<=60?' low':'');
 $('timeBar').style.width=`${Math.min(100,elapsed/DURATION*100)}%`;
}
function newLog(event){
 const time=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
 const entry={time,kind:event.kind,reason:event.reason,count:engine.count,points:calculateScore(engine.count,$('age').value).score};
 events.unshift(entry);
 const list=$('events');if(list.querySelector('.emptylog'))list.replaceChildren();
 const li=document.createElement('li');if(event.kind==='reject')li.className='no';
 const title=document.createElement('strong');title.textContent=event.kind==='count'?`ЗАСЧИТАНО · ${entry.count} повторений`:'НЕ СЧИТАТЬ';
 const timeText=document.createElement('span');timeText.textContent=`${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`;
 const description=document.createElement('div');description.textContent=event.reason.replace(/^НЕ СЧИТАТЬ:\s*/, '');
 li.append(timeText,title,description);list.prepend(li);
 if(list.children.length>80)list.lastChild.remove();
 $('exportBtn').disabled=false;
 msg(event.reason,event.kind==='count'?'ok':'error');
 $('flag').replaceChildren(); const banner=document.createElement('div');banner.textContent=event.kind==='count'?`ЗАСЧИТАНО · ${entry.count}`:'НЕ СЧИТАТЬ';
 const fine=document.createElement('small');fine.textContent=event.kind==='count'?`Баллы: ${entry.points??'ниже минимума таблицы'}`:event.reason.replace(/^НЕ СЧИТАТЬ:\s*/, '');
 $('flag').append(banner,fine);$('flag').className='flag'+(event.kind==='reject'?' no':'');$('flag').hidden=false;
 clearTimeout(notifyTimeout);notifyTimeout=setTimeout(()=>{$('flag').hidden=true;},event.kind==='reject'?2900:1400);
 if(navigator.vibrate)navigator.vibrate(event.kind==='reject'?[180,90,180]:[90]);
 if($('sound').value==='on'&&'speechSynthesis'in window){
  try{speechSynthesis.cancel();const utter=new SpeechSynthesisUtterance(event.kind==='count'?`Засчитано. ${engine.count}`:'Не считать');utter.lang='ru-RU';utter.rate=1.15;speechSynthesis.speak(utter);}catch(_){/* Не все мобильные браузеры разрешают озвучивание */}
 }
 renderNormTable();persist();
}
function persist(){try{localStorage.setItem('step-up-last-v1',JSON.stringify({events,startedAt,finishedAt,active:session==='active',age:$('age').value,count:engine.count,rejected:engine.rejected}));}catch(_){}}
function restore(){
 try{savedSession=JSON.parse(localStorage.getItem('step-up-last-v1')||'null');}catch(_){savedSession=null;}
 if(!savedSession?.startedAt||!Number.isInteger(savedSession?.count))return;
 // Прерванную перезагрузкой браузера попытку не возобновляем без визуальной калибровки.
 msg(`Предыдущая попытка: ${savedSession.count} засчитано, ${savedSession.rejected||0} отклонено. Новый отсчёт начнётся после «МАРШ».`);
}
function finish(early){
 if(session!=='active')return;
 finishedAt=early?Date.now():startedAt+DURATION;
 session='finished';
 const sc=calculateScore(engine.count,$('age').value);
 msg(`${early?'Упражнение завершено досрочно':'Время 10 минут истекло'}. Засчитано ${engine.count}, отклонено ${engine.rejected}. Баллы: ${sc.score===null?'не определены таблицей':sc.score+'.'}`,'ok');
 cameraStatus('Итог зафиксирован','good');
 $('phase').textContent='Упражнение завершено';
 syncUI();updateClock();persist();
}
function begin(){
 if(!ready()||session!=='idle')return;
 engine.reset();events=[];$('events').replaceChildren();$('count').textContent='0';$('rejects').textContent='0';
 session='active';startedAt=Date.now();finishedAt=null;latestObservation=null;
 setCalibration(null);
 $('flag').hidden=true;
 cameraStatus('Упражнение идёт','good');msg('МАРШ. Начните с положения стоя перед тумбой.');
 syncUI();renderNormTable();updateClock();persist();
}
function resetCalibration(){floorY=null;stepY=null;calibrationMode=null;$('floorVal').textContent='Не отмечен';$('stepVal').textContent='Не отмечена';setCalibration(null);syncUI();}
function setCalibration(mode){calibrationMode=mode;stage.classList.toggle('calibrating',Boolean(mode));$('prompt').hidden=!mode;
 $('prompt').textContent=mode==='floor'?'Коснитесь на видео пола у подошв (уровень опоры)':mode==='step'?'Коснитесь на видео верхней поверхности тумбы':'';
 $('floorBtn').classList.toggle('active',mode==='floor');$('stepBtn').classList.toggle('active',mode==='step');}
function tapStage(event){
 if(!calibrationMode||!video.videoWidth||session!=='idle')return;
 const r=stage.getBoundingClientRect(),W=video.videoWidth,H=video.videoHeight;
 const scale=Math.min(r.width/W,r.height/H);
 const shownHeight=H*scale,yOffset=(r.height-shownHeight)/2;
 const py=event.clientY-r.top-yOffset;
 if(py<0||py>shownHeight)return;
 const yn=+(py/shownHeight).toFixed(4);
 if(calibrationMode==='floor'){floorY=yn;$('floorVal').textContent=`${Math.round(yn*100)}% высоты`;}
 else{stepY=yn;$('stepVal').textContent=`${Math.round(yn*100)}% высоты`;}
 setCalibration(null);syncUI();renderCanvas();
}
function drawDot(p,color,size=4){ctx.beginPath();ctx.arc(p.x*overlay.width,p.y*overlay.height,size,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
function drawLine(y,color,label){
 if(y===null)return;
 const yy=y*overlay.height;ctx.save();ctx.lineWidth=Math.max(2,overlay.width/480*2);ctx.setLineDash([14,8]);ctx.strokeStyle=color;
 ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(overlay.width,yy);ctx.stroke();ctx.setLineDash([]);
 ctx.font=`bold ${Math.max(16,overlay.width/42)}px system-ui`;ctx.fillStyle=color;ctx.shadowColor='#061018';ctx.shadowBlur=5;ctx.fillText(label,12,Math.max(24,yy-10));ctx.restore();
}
function renderCanvas(){
 if(!overlay.width||!overlay.height)return;
 const w=overlay.width,h=overlay.height;ctx.clearRect(0,0,w,h);
 drawLine(floorY,'#ffcc81','ПОЛ');drawLine(stepY,'#65e6b4','ТУМБА');
 const pose=latestPose;
 if(!pose)return;
 ctx.save();ctx.lineWidth=Math.max(2,w/320);ctx.strokeStyle='#c9e2ffb8';
 for(const [i,j] of EDGES){const a=pose[i],b=pose[j];if(!a||!b||(a.visibility??0)<.38||(b.visibility??0)<.38)continue;
 ctx.beginPath();ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);ctx.stroke();}
 for(const i of [11,12,23,24,25,26,27,28,29,30,31,32]){
 const p=pose[i];if(!p||(p.visibility??0)<.38)continue;
 drawDot(p,[29,30,31,32].includes(i)?'#ffd18a':'#6aebbb',Math.max(3,w/160));
 }
 ctx.restore();
}
function showObs(obs){
 if(!obs?.visible){$('poseDetails').textContent='Не все ключевые суставы и обе стопы видны. Поправьте камеру или ракурс.';return;}
 const names={floor:'обе ноги на полу',mixed:'одна нога на тумбе',top:'обе ноги на тумбе',unknown:'неопределённое положение'};
 $('poseDetails').textContent=`По видео: ${names[obs.feet]}. Мин. угол в коленях: ${Math.round(obs.kneeMin)}°. Отклонение туловища: ${Math.round(obs.torsoLean)}°.`;
}
function showPhase(){
 $('phase').textContent=session==='active'?engine.getLabel():session==='finished'?'Упражнение завершено':'Ожидание команды «МАРШ»';
 const activeByState={waiting:0,ready:0,ascending:1,on_top:2,top_ok:2,descending:3,landing:4,recover:0};
 const i=session==='active'?(activeByState[engine.state]||0):0;
 [...$('steps').children].forEach((x,j)=>x.classList.toggle('now',i===j));
}
function frame(now){
 if(!runningCamera)return;
 frameId=requestAnimationFrame(frame);
 if(!video.videoWidth||video.readyState<2||now-lastProcessed<75)return;
 if(video.currentTime===lastFrameTime)return;
 lastFrameTime=video.currentTime;lastProcessed=now;
 try{
   const result=model.detectForVideo(video,now);
   latestPose=result.landmarks?.[0]??null;
   if(overlay.width!==video.videoWidth||overlay.height!==video.videoHeight){overlay.width=video.videoWidth;overlay.height=video.videoHeight;}
   if(floorY!==null&&stepY!==null){latestObservation=extractObservation(latestPose,floorY,stepY,video.videoWidth,video.videoHeight);showObs(latestObservation);}
   else {$('poseDetails').textContent=latestPose?'Скелет определён. Укажите уровни пола и тумбы.':'Тело не найдено полностью в кадре.';}
   if(session==='active'){
     if(Date.now()>=startedAt+DURATION){finish(false);}
     else if(floorY!==null&&stepY!==null){const ev=engine.update(latestObservation,now);if(ev)newLog(ev);showPhase();}
   }
   renderCanvas();
 }catch(e){console.error(e);cameraStatus('Ошибка обработки','bad');msg(`Не удалось распознать кадр: ${e.message||e}`,'error');stopCamera();if(session==='active')finish(true);}
}
async function createPose(){
 if(model)return;
 const {FilesetResolver,PoseLandmarker}=await import(PACKAGE);
 const wasm=await FilesetResolver.forVisionTasks(WASM);
 for(const delegate of ['GPU','CPU']){
   try{model=await PoseLandmarker.createFromOptions(wasm,{baseOptions:{modelAssetPath:MODEL,delegate},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5});return;}
   catch(e){if(delegate==='CPU')throw e;}
 }
}
async function launchCamera(){
 if(loading||runningCamera||session==='active')return;
 if(!navigator.mediaDevices?.getUserMedia){cameraStatus('Требуется HTTPS','bad');msg('Камера недоступна. Откройте приложение через HTTPS или localhost.','error');return;}
 loading=true;cameraStatus('Загрузка…','warn');syncUI();
 try{
   await createPose();
   stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}});
   video.srcObject=stream;await video.play();
   runningCamera=true;lastFrameTime=-1;lastProcessed=0;latestPose=null;
   stage.classList.toggle('mirror',facing==='user');$('placeholder').hidden=true;
   resetCalibration();
   cameraStatus('Камера активна','good');frameId=requestAnimationFrame(frame);
   for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{if(runningCamera){stopCamera();if(session==='active')finish(true);}});
 }catch(e){
   if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
   const str=e.name==='NotAllowedError'?'Доступ к камере запрещён в настройках браузера.':e.name==='NotFoundError'?'Камера устройства не найдена.':e.name==='NotReadableError'?'Камера занята другим приложением.':`Ошибка запуска: ${e.message||e}`;
   cameraStatus('Ошибка камеры','bad');msg(str,'error');
 }finally{loading=false;syncUI();}
}
function stopCamera(){
 if(frameId)cancelAnimationFrame(frameId);frameId=0;
 runningCamera=false; if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
 video.srcObject=null;latestPose=null;latestObservation=null;
 $('placeholder').hidden=false;resetCalibration();
 if(session==='idle')cameraStatus('Камера выключена');
 syncUI();
}
function exportReport(){
 if(!events.length)return;
 const label=$('age').selectedOptions[0].textContent;
 const header=[['Упражнение №29'],['Категория',label],['Засчитано',String(engine.count)],['Не засчитано',String(engine.rejected)],['Баллы',String(calculateScore(engine.count,$('age').value).score??'не определены')],[],['Время (мм:сс)','Событие','Причина','Засчитано (всего)','Баллы']];
 const rows=events.slice().reverse().map(e=>[`${String(Math.floor(e.time/60)).padStart(2,'0')}:${String(e.time%60).padStart(2,'0')}`,e.kind==='count'?'ЗАСЧИТАНО':'НЕ СЧИТАТЬ',e.reason,e.count,e.points??'–']);
 const csv=[...header,...rows].map(row=>row.map(s=>`"${String(s??'').replaceAll('"','""')}"`).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=`stepup-protocol-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),6000);
}
$('camBtn').addEventListener('click',launchCamera);
$('camOffBtn').addEventListener('click',stopCamera);
$('flipBtn').addEventListener('click',async()=>{if(session==='active')return;facing=facing==='user'?'environment':'user';if(runningCamera){stopCamera();await launchCamera();}});
$('floorBtn').addEventListener('click',()=>setCalibration(calibrationMode==='floor'?null:'floor'));
$('stepBtn').addEventListener('click',()=>setCalibration(calibrationMode==='step'?null:'step'));
stage.addEventListener('pointerup',tapStage);
$('age').addEventListener('change',()=>{renderNormTable();syncUI();});
$('heightConfirmed').addEventListener('change',syncUI);
$('marchBtn').addEventListener('click',begin);
$('finishBtn').addEventListener('click',()=>finish(true));
$('newBtn').addEventListener('click',()=>{
 if(session!=='finished')return;
 if(!window.confirm('Начать новую попытку? Сохраните текущий протокол CSV перед сбросом.'))return;
 session='idle';startedAt=null;finishedAt=null;events=[];engine.reset();
 $('events').replaceChildren(); const empty=document.createElement('li');empty.className='emptylog';empty.textContent='Протокол пока пуст.';$('events').append(empty);
 $('flag').hidden=true;msg('Новая попытка. Проверьте калибровку и нажмите «МАРШ».');
 cameraStatus(runningCamera?'Камера активна':'Камера выключена',runningCamera?'good':'');
 renderNormTable();updateClock();showPhase();syncUI();persist();
});
$('exportBtn').addEventListener('click',exportReport);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')updateClock();});
window.addEventListener('pagehide',()=>{persist();});
if('serviceWorker'in navigator && (location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
restore();renderNormTable();syncUI();showPhase();updateClock();clockTicker=setInterval(updateClock,200);
