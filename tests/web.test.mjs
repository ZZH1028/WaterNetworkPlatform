import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {csvParse,validateObservations,demoSeries,escapeHTML} from '../web/store.js';
import {KnowledgeIndex,localAnswer} from '../web/knowledge.js';
import {forecastStation,HydroWatch,validateWatchConfig} from '../web/hydrology.js';
const catalog=JSON.parse(await readFile(new URL('../knowledge/catalog.json',import.meta.url),'utf8'));
const stations=[{id:'1'}];
const valid={station_id:'1',monitor_time:'2026-10-21T08:00:00+08:00',water_level:3.8,datum:'吴淞高程'};
test('CSV correctly reads quoted comma and escaped quote',()=>{assert.deepEqual(csvParse('id,name\n1,"a,b"\n2,"a""b"'),[{id:'1',name:'a,b'},{id:'2',name:'a"b'}]);});
test('monitor import rejects unknown stations, duplicate records and incompatible datum',()=>{assert.throws(()=>validateObservations([{...valid,station_id:'2'}],stations));assert.throws(()=>validateObservations([valid,valid],stations));assert.throws(()=>validateObservations([{...valid,datum:'WGS84'}],stations));assert.throws(()=>validateObservations([{...valid,monitor_time:'2026-10-21 08:00'}],stations));assert.equal(validateObservations([valid],stations)[0].monitor_time,'2026-10-21T00:00:00.000Z');});
test('tidal boundary question retrieves dedicated hydrodynamic guidance',()=>{const index=new KnowledgeIndex(catalog);assert.equal(index.search('感潮河网下游水位过程边界怎么设置')[0].id,'K003');});
test('unknown topic returns explicit lack of evidence',()=>{const index=new KnowledgeIndex(catalog);assert.equal(localAnswer('zxqv123456',index).hits.length,0);});
test('user document becomes retrievable with unverified provenance',()=>{const imported={id:'U1-1',title:'测试盐度取水规程',keywords:'盐度 电导率',content:'盐度监测超过项目给定值时，应复核取水窗口。',category:'用户导入',origin:'用户导入 / 未核验'};const idx=new KnowledgeIndex(catalog,[imported]);assert.ok(idx.search('测试盐度取水规程').some(d=>d.id==='U1-1'));assert.equal(escapeHTML('<script>'),'&lt;script&gt;');});
test('simulation exports stable hourly values and stronger pump lowers end level',()=>{const a=demoSeries(0,{pump:0}),b=demoSeries(0,{pump:1});assert.equal(a.length,25);assert.equal(a[0].hour,0);assert.equal(a.at(-1).hour,24);assert.ok(b.at(-1).level<a.at(-1).level);assert.deepEqual(a,demoSeries(0,{pump:0}));});

const watchStation={id:'1',name:'测试水文站'};
function readings(levels,now=Date.now()){return levels.map((level,i)=>({...valid,water_level:level,monitor_time:new Date(now-(levels.length-1-i)*5*60000).toISOString()}));}
test('rolling forecast identifies crossing time and rejects stale or future data',()=>{
 const now=Date.parse('2026-10-21T00:00:00Z'),rows=readings([3.8,3.85,3.9],now);
 const forecast=forecastStation(watchStation,rows,{threshold:4.2,horizonHours:6},now);
 assert.equal(forecast.quality,'ready');assert.equal(forecast.riskType,'forecast');assert.ok(Math.abs(forecast.leadMinutes-30)<1e-6);assert.equal(forecast.severity,'high');
 const stale=forecastStation(watchStation,rows,{threshold:3.5},now+11*60000);assert.equal(stale.quality,'stale');assert.equal(stale.forecast.length,0);assert.equal(stale.riskType,null);
 const future=forecastStation(watchStation,readings([5,5.1,5.2],now+3*60000),{},now);assert.equal(future.quality,'future');assert.equal(future.riskType,null);
});
test('fresh observed exceedance alerts without inventing a forecast from one sample',()=>{
 const now=Date.now();const result=forecastStation(watchStation,readings([4.4],now),{threshold:4.2},now);
 assert.equal(result.quality,'insufficient');assert.equal(result.riskType,'observed');assert.equal(result.forecast.length,0);
 for(const levels of [[3.8,3.8,3.8],[3.9,3.8,3.7]]){const result=forecastStation(watchStation,readings(levels,now),{threshold:4.2},now);assert.equal(result.riskType,null);}
});
test('events deduplicate, escalate, retain stale risk, and require recovery before archive',()=>{
 const notices=[];const watch=new HydroWatch({stations:[watchStation],onNotice:e=>notices.push(structuredClone(e)),config:{threshold:4.2}});
 try{
  watch.useImported(readings([3.7,3.72,3.74]));assert.equal(watch.events.length,1);assert.equal(notices.length,1);assert.equal(watch.events[0].type,'forecast');
  watch.emit();assert.equal(watch.events.length,1);assert.equal(notices.length,1);const id=watch.events[0].id;watch.updateEvent(id,'confirmed');
  watch.useImported(readings([4.21,4.22,4.23]));assert.equal(watch.events.length,1);assert.equal(watch.events[0].type,'observed');assert.equal(watch.events[0].status,'new');assert.equal(notices.length,2);
  assert.throws(()=>watch.updateEvent(id,'resolved'),/尚未恢复/);
  watch.useImported(readings([3.8,3.8,3.8],Date.now()-11*60000));assert.equal(watch.events[0].recovered,false);assert.equal(watch.events[0].dataStale,true);
  watch.useImported(readings([3.8,3.8,3.8]));assert.equal(watch.events[0].recovered,true);watch.updateEvent(id,'resolved');assert.equal(watch.events[0].status,'resolved');assert.throws(()=>watch.updateEvent(id,'processing'),/已归档/);
 }finally{watch.destroy();}
});
test('consecutive feed polls accumulate history and failed poll preserves last valid observations',async()=>{
 const watch=new HydroWatch({stations:[watchStation],config:{feedUrl:'https://example.test/water',enabled:true}});const previousFetch=globalThis.fetch;let i=0;const now=Date.now();
 globalThis.fetch=async()=>{const time=now-(2-i)*5*60000;if(i++===3)throw Error('connection unavailable');return new Response(JSON.stringify({observations:[{...valid,water_level:3.8+i*.02,monitor_time:new Date(time).toISOString()}]}),{headers:{'Content-Type':'application/json'}});};
 try{for(let p=0;p<3;p++)await watch.refresh();assert.equal(watch.samples.length,3);assert.equal(watch.snapshot().assessment[0].quality,'ready');await watch.refresh();assert.equal(watch.samples.length,3);assert.match(watch.error,/unavailable/);}finally{globalThis.fetch=previousFetch;watch.destroy();}
});
test('demo stays marked synthetic, leaves imported array intact, and settings enforce safe ranges',()=>{
 const imported=readings([3.2,3.2,3.2]),before=structuredClone(imported),watch=new HydroWatch({stations:[watchStation]});try{watch.useImported(imported);watch.startDemo();assert.equal(watch.mode,'demo');assert.ok(watch.events.every(e=>e.mode==='demo'));assert.deepEqual(imported,before);watch.stop();assert.equal(watch.samples.length,0);assert.equal(watch.mode,'idle');}finally{watch.destroy();}
 assert.throws(()=>validateWatchConfig({feedUrl:'http://remote.test/water'}),/HTTPS/);assert.throws(()=>validateWatchConfig({intervalSeconds:1}));assert.throws(()=>validateWatchConfig({threshold:NaN}));assert.equal(validateWatchConfig({horizonHours:3}).horizonHours,3);
});
