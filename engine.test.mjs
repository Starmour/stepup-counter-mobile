import test from 'node:test';
import assert from 'node:assert/strict';
import {NORMS,calculateScore} from '../norms.mjs';
import {StepUpEngine} from '../engine.mjs';
const good=(feet)=>({feet,visible:true,kneeMin:174,torsoLean:7});
const bent=(feet)=>({feet,visible:true,kneeMin:110,torsoLean:38});
function timeline(engine, blocks) {
 let t=0, events=[];
 for(const [foot, duration, pose='good'] of blocks){
   const ob=pose==='good'?good(foot):bent(foot);
   for(let i=0;i<duration;i+=50){const event=engine.update(ob,t);if(event)events.push(event); t+=50;}
 }
 return events;
}
const valid=[['floor',500],['mixed',350],['top',850],['mixed',300],['floor',500]];
test('Полный подъём с фиксацией засчитывается ровно один раз',()=>{
 const e=new StepUpEngine();const events=timeline(e,[...valid,['floor',1500]]);
 assert.equal(e.count,1);assert.equal(e.rejected,0);assert.equal(events.filter(v=>v.kind==='count').length,1);
});
test('Возврат после установки одной ноги не засчитывается',()=>{
 const e=new StepUpEngine();timeline(e,[['floor',500],['mixed',350],['floor',600]]);
 assert.equal(e.count,0);assert.equal(e.rejected,1);
});
test('Без фиксации наверху - НЕ СЧИТАТЬ',()=>{
 const e=new StepUpEngine();const events=timeline(e,[['floor',500],['mixed',400],['top',200],['mixed',450],['floor',500]]);
 assert.equal(e.count,0);assert.ok(events.some(v=>v.kind==='reject'&&v.reason.includes('фиксации')));
});
test('Согнутые колени наверху препятствуют зачёту',()=>{
 const e=new StepUpEngine();timeline(e,[['floor',500],['mixed',350],['top',750,'bent'],['mixed',300],['floor',500]]);
 assert.equal(e.count,0);assert.equal(e.rejected,1);
});
test('Невозможность видеть ноги прерывает повторение без зачёта',()=>{
 const e=new StepUpEngine();timeline(e,[['floor',500],['mixed',350],['unknown',1500]]);
 assert.equal(e.count,0);assert.equal(e.rejected,1);
});
test('Все 99 строк нормативов: монотонность и интерпретация',()=>{
 assert.equal(NORMS.length,99);
 assert.deepEqual(NORMS[0],{score:100,young:400,older:360});
 assert.deepEqual(NORMS.at(-1),{score:2,young:217,older:199});
 for(let i=1;i<NORMS.length;i++){
   assert.equal(NORMS[i].score,NORMS[i-1].score-1);
   assert.ok(NORMS[i].young<NORMS[i-1].young);
   assert.ok(NORMS[i].older<NORMS[i-1].older);
 }
 for(const group of ['young','older'])for(const n of NORMS){
   assert.equal(calculateScore(n[group],group).score,n.score);
   if(n.score<100 && NORMS.find(x=>x.score===n.score+1)[group] > n[group]+1)assert.equal(calculateScore(n[group]+1,group).score,n.score);
 }
});
test('Границы 35+ и нестандартные пороги из изображения',()=>{
 assert.equal(calculateScore(310,'older').score,76);
 assert.equal(calculateScore(312,'older').score,76);
 assert.equal(calculateScore(310,'young').score,56);
 assert.equal(calculateScore(312,'young').score,56);
 assert.equal(calculateScore(236,'older').score,39);
 assert.equal(calculateScore(235,'older').score,38);
 assert.equal(calculateScore(232,'young').score,17);
 assert.equal(calculateScore(231,'young').score,16);
 assert.equal(calculateScore(216,'young').score,null);
 assert.equal(calculateScore(198,'older').score,null);
 assert.equal(calculateScore(1000,'young').score,100);
});

test('Положение стоп определяется относительно откалиброванных линий', async()=>{
 const {extractObservation}=await import('../engine.mjs');
 const pose=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));
 for(const [hip,knee,ankle,heel,toe,shoulder,x] of [[23,25,27,29,31,11,.4],[24,26,28,30,32,12,.6]]){
  pose[shoulder]={x,y:.24,visibility:1};pose[hip]={x,y:.42,visibility:1};
  pose[knee]={x,y:.61,visibility:1};pose[ankle]={x,y:.78,visibility:1};
  pose[heel]={x,y:.85,visibility:1};pose[toe]={x,y:.85,visibility:1};
 }
 assert.equal(extractObservation(pose,.85,.69,720,1280).feet,'floor');
 pose[29].y=pose[31].y=.69;
 assert.equal(extractObservation(pose,.85,.69,720,1280).feet,'mixed');
 pose[30].y=pose[32].y=.69;
 assert.equal(extractObservation(pose,.85,.69,720,1280).feet,'top');
 pose[32].visibility=.1;pose[30].visibility=.1;
 assert.equal(extractObservation(pose,.85,.69,720,1280).feet,'unknown');
});
