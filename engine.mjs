/**
 * Консервативный автомат состояний одного восхождения.
 * Базовый цикл: пол -> одна нога на тумбе -> обе на тумбе (выпрямление + фиксация)
 * -> одна нога на полу -> обе на полу (выпрямление) -> зачёт.
 * Анализ 2D-кадра НЕ доказывает контакт стоп с поверхностью.
 */
export class StepUpEngine {
  constructor({debounceMs=90, holdTopMs=340, holdFloorMs=160, kneeStraight=153, maxTorsoLean=26, visibilityTimeoutMs=1100}={}) {
    Object.assign(this,{debounceMs,holdTopMs,holdFloorMs,kneeStraight,maxTorsoLean,visibilityTimeoutMs});
    this.reset();
  }
  reset() {
    this.state='waiting'; this.phase='unknown'; this.phaseRaw='unknown';this.rawSince=0;
    this.topSince=null;this.floorSince=null;this.lostSince=null;
    this.count=0;this.rejected=0; this.justEvent=null;
  }
  getLabel() {
    return ({waiting:'Встаньте перед платформой',ready:'Начните восхождение',ascending:'Поставьте вторую ногу',on_top:'Выпрямитесь и зафиксируйтесь',top_ok:'Опускайте первую ногу',descending:'Приставьте вторую ногу на пол',landing:'Выпрямитесь в исходном положении',recover:'Вернитесь в исходное положение'})[this.state];
  }
  #fail(message) {this.rejected++;this.state='recover';this.topSince=null;this.floorSince=null;this.justEvent={kind:'reject',reason:message};}
  #success() {this.count++;this.state='recover';this.topSince=null;this.floorSince=null;this.justEvent={kind:'count',reason:'Полное восхождение засчитано'};}
  update(obs, nowMs) {
    this.justEvent=null;
    if (!Number.isFinite(nowMs)) throw new TypeError('Некорректная временная метка');
    const visible = Boolean(obs && obs.visible && ['floor','mixed','top','unknown'].includes(obs.feet));
    if (!visible || obs.feet==='unknown') {
      if (this.lostSince===null) this.lostSince=nowMs;
      if (['ascending','on_top','top_ok','descending','landing'].includes(this.state) && nowMs-this.lostSince > this.visibilityTimeoutMs) {
        this.#fail('НЕ СЧИТАТЬ: положение стоп не подтверждено камерой');
      }
      return this.justEvent;
    }
    this.lostSince=null;
    if (obs.feet!==this.phaseRaw) {this.phaseRaw=obs.feet;this.rawSince=nowMs;}
    if (nowMs-this.rawSince<this.debounceMs) return null;
    this.phase=obs.feet;
    const straight = Number.isFinite(obs.kneeMin) && obs.kneeMin>=this.kneeStraight &&
      Number.isFinite(obs.torsoLean) && obs.torsoLean<=this.maxTorsoLean;
    switch(this.state) {
      case 'waiting': case 'recover':
        if (this.phase==='floor' && straight) {
          if(this.floorSince===null) this.floorSince=nowMs;
          if(nowMs-this.floorSince>=this.holdFloorMs) this.state='ready';
        } else this.floorSince=null;
        break;
      case 'ready':
        if(this.phase==='mixed') this.state='ascending';
        else if(this.phase==='top') this.#fail('НЕ СЧИТАТЬ: не подтверждён последовательный подъём ног');
        break;
      case 'ascending':
        if(this.phase==='top') {this.state='on_top';this.topSince=straight?nowMs:null;}
        else if(this.phase==='floor') this.#fail('НЕ СЧИТАТЬ: подъём не завершён');
        break;
      case 'on_top':
        if(this.phase==='top') {
          if(straight){
            if(this.topSince===null)this.topSince=nowMs;
            if(nowMs-this.topSince>=this.holdTopMs)this.state='top_ok';
          } else this.topSince=null;
        } else if(this.phase==='mixed'||this.phase==='floor') {
          this.#fail('НЕ СЧИТАТЬ: нет выпрямления и фиксации наверху');
        }
        break;
      case 'top_ok':
        if(this.phase==='mixed') this.state='descending';
        else if(this.phase==='floor') this.#fail('НЕ СЧИТАТЬ: не подтверждён последовательный спуск ног');
        break;
      case 'descending':
        if(this.phase==='floor'){this.state='landing';this.floorSince=straight?nowMs:null;}
        else if(this.phase==='top') this.#fail('НЕ СЧИТАТЬ: нарушена последовательность спуска');
        break;
      case 'landing':
        if(this.phase==='floor') {
          if(straight){
            if(this.floorSince===null)this.floorSince=nowMs;
            if(nowMs-this.floorSince>=this.holdFloorMs)this.#success();
          } else this.floorSince=null;
        } else if(this.phase==='mixed'||this.phase==='top') {
          this.#fail('НЕ СЧИТАТЬ: не принято исходное положение');
        }
        break;
    }
    return this.justEvent;
  }
}

export function angleDegrees(a,b,c,width,height) {
  const u={x:(a.x-b.x)*width,y:(a.y-b.y)*height};
  const v={x:(c.x-b.x)*width,y:(c.y-b.y)*height};
  const den=Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y);
  if(den<1e-8)return null;
  return Math.acos(Math.max(-1,Math.min(1,(u.x*v.x+u.y*v.y)/den)))*180/Math.PI;
}
export function extractObservation(pose, floorY, stepY, width, height) {
  if(!pose || pose.length<33 || !Number.isFinite(floorY) || !Number.isFinite(stepY))return {feet:'unknown',visible:false};
  const conf=(i)=> (pose[i]?.visibility??0) >= 0.42;
  const shoeY=(ankle,heel,toe)=> {
    // Используются опорные точки обуви, а не голеностоп (высота которого другая).
    if(conf(heel)&&conf(toe))return (pose[heel].y+pose[toe].y)/2;
    if(conf(heel))return pose[heel].y;
    if(conf(toe))return pose[toe].y;
    return null;
  };
  const left=shoeY(27,29,31), right=shoeY(28,30,32);
  if(left===null || right===null || ![11,12,23,24,25,26,27,28].every(conf))return {feet:'unknown',visible:false};
  const gap=floorY-stepY;
  if(gap<0.055)return {feet:'unknown',visible:false};
  const tol=Math.min(.06,Math.max(.023, gap*.29));
  const level=(y)=> Math.abs(y-floorY)<=tol?'floor':Math.abs(y-stepY)<=tol?'top':'unknown';
  const levels=[level(left),level(right)];
  let feet='unknown';
  if(levels.every(l=>l==='floor'))feet='floor';
  else if(levels.every(l=>l==='top'))feet='top';
  else if(levels.includes('floor')&&levels.includes('top'))feet='mixed';
  const a=angleDegrees(pose[23],pose[25],pose[27],width,height);
  const b=angleDegrees(pose[24],pose[26],pose[28],width,height);
  const shoulders={x:(pose[11].x+pose[12].x)/2,y:(pose[11].y+pose[12].y)/2};
  const hips={x:(pose[23].x+pose[24].x)/2,y:(pose[23].y+pose[24].y)/2};
  const dx=(shoulders.x-hips.x)*width, dy=(shoulders.y-hips.y)*height;
  return {feet,visible:true,kneeMin:Math.min(a??0,b??0),torsoLean:Math.atan2(Math.abs(dx),Math.abs(dy))*180/Math.PI,levels,points:[left,right]};
}
