import {validateObservations} from './store.js';

export const DEFAULT_WATCH_CONFIG={feedUrl:'',intervalSeconds:60,staleMinutes:10,horizonHours:6,threshold:4.15,popups:true,enabled:false};
export function validateWatchConfig(value={}){
 const c={...DEFAULT_WATCH_CONFIG,...value};c.feedUrl=String(c.feedUrl??'').trim();
 if(c.feedUrl){let u;try{u=new URL(c.feedUrl);}catch{throw Error('数据接口地址无效');}if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('接口需使用 HTTPS；本机测试可用 localhost');}
 for(const [key,min,max] of [['intervalSeconds',15,3600],['staleMinutes',2,240],['horizonHours',1,12],['threshold',0,20]]){c[key]=Number(c[key]);if(!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw Error('监测参数超出允许范围：'+key);}
 c.enabled=Boolean(c.enabled);c.popups=Boolean(c.popups);return c;
}

export function forecastStation(station,rows,config=DEFAULT_WATCH_CONFIG,now=Date.now()){
 const c={...DEFAULT_WATCH_CONFIG,...config};const valid=rows.filter(r=>r.station_id===station.id&&Number.isFinite(Number(r.water_level))&&Number.isFinite(Date.parse(r.monitor_time))).sort((a,b)=>Date.parse(a.monitor_time)-Date.parse(b.monitor_time));
 const result={...station,latest:valid.at(-1)??null,sampleCount:valid.length,quality:'missing',ageMinutes:null,slope:null,forecast:[],peak:null,riskType:null,severity:null,leadMinutes:null,model:'滚动线性趋势基线（未率定）'};
 if(!valid.length)return result;const latest=valid.at(-1);const lastTime=Date.parse(latest.monitor_time);result.ageMinutes=(now-lastTime)/60000;
 if(result.ageMinutes< -2){result.quality='future';return result;}if(result.ageMinutes>c.staleMinutes){result.quality='stale';return result;}
 const recent=valid.filter(r=>lastTime-Date.parse(r.monitor_time)<=6*3600000).slice(-12);result.sampleCount=recent.length;result.quality='insufficient';
 if(Number(latest.water_level)>=c.threshold){result.riskType='observed';result.severity='high';result.leadMinutes=0;}
 if(recent.length<3||lastTime-Date.parse(recent[0].monitor_time)<5*60000)return result;
 const xs=recent.map(r=>(Date.parse(r.monitor_time)-lastTime)/3600000),ys=recent.map(r=>Number(r.water_level));const mx=xs.reduce((s,x)=>s+x,0)/xs.length,my=ys.reduce((s,y)=>s+y,0)/ys.length;const denominator=xs.reduce((s,x)=>s+(x-mx)**2,0);if(denominator<1e-10)return result;
 result.slope=xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0)/denominator;result.quality='ready';
 result.forecast=Array.from({length:Math.floor(c.horizonHours*4)+1},(_,i)=>{const lead=i*.25;return {hour:lead,level:Number(latest.water_level)+result.slope*(Math.max(0,result.ageMinutes)/60+lead),time:new Date(now+lead*3600000).toISOString()};});
 if(result.forecast.some(p=>p.level< -30||p.level>200)){result.quality='out_of_range';result.forecast=[];result.slope=null;return result;}
 result.peak=Math.max(...result.forecast.map(p=>p.level));
 if(!result.riskType&&result.peak>=c.threshold){const lead=Math.max(0,(c.threshold-Number(latest.water_level))/result.slope-Math.max(0,result.ageMinutes)/60);result.riskType='forecast';result.leadMinutes=lead*60;result.severity=lead<=1?'high':lead<=3?'medium':'watch';}
 return result;
}

export function assessNetwork(stations,rows,config=DEFAULT_WATCH_CONFIG,now=Date.now()){
 const ids=new Set(rows.map(r=>r.station_id));return stations.filter(s=>ids.has(s.id)).map(s=>forecastStation(s,rows,config,now));
}

const ranks={watch:1,medium:2,high:3};
export class HydroWatch{
 constructor({stations,config={},events=[],onConfig=()=>{},onEvents=()=>{},onNotice=()=>{},getHeaders=()=>({})}){this.stations=stations;this.config=validateWatchConfig(config);this.events=events.slice(-500);this.callbacks={onConfig,onEvents,onNotice};this.getHeaders=getHeaders;this.listeners=new Set();this.samples=[];this.mode='idle';this.error='';this.lastAttempt=null;this.lastSuccess=null;this.sourceName='尚未接入数据';this.timer=null;this.controller=null;this.generation=0;this.loading=false;this.demoStarted=0;}
 subscribe(callback){this.listeners.add(callback);callback(this.snapshot());return()=>this.listeners.delete(callback);}
 snapshot(){const assessment=assessNetwork(this.stations,this.samples,this.config);return {mode:this.mode,samples:this.samples,assessment,events:this.events,config:this.config,sourceName:this.sourceName,error:this.error,loading:this.loading,lastAttempt:this.lastAttempt,lastSuccess:this.lastSuccess,nextPoll:this.nextPoll??null};}
 emit(){const snapshot=this.snapshot();this.syncEvents(snapshot.assessment);snapshot.events=this.events;for(const callback of this.listeners)callback(snapshot);}
 syncEvents(assessment){let changed=false;const assessed=new Set(assessment.map(s=>s.id));for(const event of this.events){if(event.status!=='resolved'&&!event.recovered&&(event.mode!==this.mode||!assessed.has(event.stationId))&&!event.dataStale){event.dataStale=true;changed=true;}}for(const station of assessment){const key=this.mode+':'+station.id;const existing=[...this.events].reverse().find(e=>e.key===key&&e.status!=='resolved');const stale=['stale','future','missing'].includes(station.quality);
  if(station.riskType){const escalated=existing&&(ranks[station.severity]>ranks[existing.severity]||(station.riskType==='observed'&&existing.type==='forecast'));if(!existing||existing.recovered){const event={id:'RISK-'+(crypto.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>n.toString(16).padStart(2,'0')).join('')).slice(0,12),key,stationId:station.id,stationName:station.name,type:station.riskType,severity:station.severity,level:Number(station.latest.water_level),peak:station.peak,leadMinutes:station.leadMinutes,threshold:this.config.threshold,observedAt:station.latest.monitor_time,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),mode:this.mode,status:'new',recovered:false,dataStale:false,note:''};this.events.push(event);changed=true;if(this.config.popups)this.callbacks.onNotice(event);}else{Object.assign(existing,{level:Number(station.latest.water_level),peak:station.peak,leadMinutes:station.leadMinutes,observedAt:station.latest.monitor_time,updatedAt:new Date().toISOString(),dataStale:false});if(escalated){existing.type=station.riskType;existing.severity=station.severity;existing.status='new';if(this.config.popups)this.callbacks.onNotice(existing);}changed=true;}}
  else if(existing){if(stale){if(!existing.dataStale){existing.dataStale=true;changed=true;}}else if(station.quality==='ready'&&Number(station.latest.water_level)<this.config.threshold-.02&&station.peak<this.config.threshold-.02&&!existing.recovered){existing.recovered=true;existing.dataStale=false;existing.updatedAt=new Date().toISOString();changed=true;}}
 }
 if(changed){this.events=this.events.slice(-500);this.callbacks.onEvents(this.events);}}
 async configure(value){this.cancel();this.config=validateWatchConfig({...this.config,...value});await this.callbacks.onConfig(this.config);this.error='';this.mode=this.config.enabled&&this.config.feedUrl?'live':'idle';this.sourceName=this.mode==='live'?'已配置水情接口':'尚未接入数据';this.samples=[];this.emit();if(this.mode==='live')await this.refresh();}
 start(){this.checkFreshness();if(this.config.enabled&&this.config.feedUrl){this.mode='live';this.sourceName='已配置水情接口';this.refresh();}else this.emit();}
 checkFreshness(){clearTimeout(this.freshnessTimer);this.freshnessTimer=setTimeout(()=>{this.emit();this.checkFreshness();},30000);}
 cancel(){this.generation++;clearTimeout(this.timer);this.controller?.abort();this.loading=false;this.nextPoll=null;}
 schedule(seconds){clearTimeout(this.timer);this.nextPoll=new Date(Date.now()+seconds*1000).toISOString();this.timer=setTimeout(()=>this.mode==='demo'?this.demoTick():this.refresh(),seconds*1000);}
 async refresh(){if(this.mode==='demo'){this.demoTick();return;}if(!this.config.feedUrl){this.mode='idle';this.error='尚未配置实时数据源';this.emit();return;}if(this.loading)return;const generation=this.generation;this.mode='live';this.loading=true;this.lastAttempt=new Date().toISOString();this.emit();this.controller=new AbortController();const timeout=setTimeout(()=>this.controller?.abort(),12000);
  try{const response=await fetch(this.config.feedUrl,{headers:{'Accept':'application/json',...this.getHeaders(this.config.feedUrl)},cache:'no-store',signal:this.controller.signal});if(!response.ok)throw Error('接口返回 HTTP '+response.status);const size=Number(response.headers.get('content-length')??0);if(size>20*1024*1024)throw Error('接口响应大于 20 MB');const payload=await response.json();if(generation!==this.generation)return;const records=validateObservations(Array.isArray(payload)?payload:payload.observations,this.stations);const history=new Map([...this.samples,...records].filter(r=>Date.parse(r.monitor_time)>Date.now()-6*3600000).map(r=>[r.station_id+':'+r.monitor_time,r]));this.samples=[...history.values()].sort((a,b)=>Date.parse(a.monitor_time)-Date.parse(b.monitor_time)).slice(-20000);this.sourceName=typeof payload.source==='string'?payload.source.slice(0,100):'已配置水情接口';this.lastSuccess=new Date().toISOString();this.error='';}
  catch(error){if(generation!==this.generation)return;this.error=error.name==='AbortError'?'接口连接超时，请核对服务与跨域配置':error.message;}
  finally{clearTimeout(timeout);if(generation===this.generation){this.loading=false;this.schedule(this.config.intervalSeconds);this.emit();}}
 }
 useImported(rows){this.cancel();this.samples=rows;this.mode='imported';this.sourceName='浏览器导入资料（不会自动产生新观测）';this.error='';this.emit();}
 startDemo(){this.cancel();this.mode='demo';this.error='';this.sourceName='联动演示 · 合成数据';this.demoStarted=Date.now();this.demoTick();}
 demoTick(){const now=Date.now(),elapsed=(now-this.demoStarted)/3600000;this.samples=this.stations.slice(0,3).flatMap((s,i)=>Array.from({length:13},(_,j)=>({station_id:s.id,monitor_time:new Date(now-(12-j)*5*60000).toISOString(),water_level:i===0?this.config.threshold-.16+j*.012+elapsed*.12:i===1?this.config.threshold+.035+j*.002:this.config.threshold-.5+Math.sin(j*.4)*.015,datum:'吴淞高程',source:'演示合成'})));this.lastAttempt=this.lastSuccess=new Date(now).toISOString();this.schedule(10);this.emit();}
 stop(){this.cancel();this.samples=[];this.mode='idle';this.error='';this.sourceName='尚未接入数据';this.emit();}
 updateEvent(id,status,note=''){const event=this.events.find(e=>e.id===id);if(!event)throw Error('预警记录不存在');if(event.status==='resolved')throw Error('该预警已归档，不能再次修改');if(!['confirmed','processing','resolved'].includes(status))throw Error('处置状态无效');if(status==='resolved'&&!event.recovered)throw Error('风险尚未恢复，请先标记为处理中并复核数据');event.status=status;event.note=String(note).slice(0,1000);event.updatedAt=new Date().toISOString();this.callbacks.onEvents(this.events);this.emit();}
 destroy(){this.cancel();clearTimeout(this.freshnessTimer);this.listeners.clear();}
}
