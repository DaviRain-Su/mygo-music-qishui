'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { Features, featureContext } = require('../helper/features.cjs');
const { parseRequest, encodeResponse, publicError } = require('../helper/protocol.cjs');
const track = {id:'t1',name:'Song',duration:123000,album:{id:'a1',name:'Album'}};
const playlist = {id:'p1',title:'Liked',type:1,owner:{id:'u1'},count_tracks:1};
function transport(log) {
 return async (path,q,b,signal) => {
  log.push({path,q,b,signal}); assert.ok(signal instanceof AbortSignal);
  switch(path.replace('/luna/pc/','')) {
   case 'search/track': return {result_groups:[{id:'tracks',data:[{entity:{track}}],has_more:false}]};
   case 'search/album': return {result_groups:[{id:'albums',data:[{entity:{album:{id:'a1',name:'Album'}}}],has_more:false}]};
   case 'search/artist': return {result_groups:[{id:'artists',data:[{entity:{artist:{id:'ar1',name:'Artist'}}}],has_more:false}]};
   case 'search/playlist': return {result_groups:[{id:'playlists',data:[{entity:{playlist}}],has_more:false}]};
   case 'user/playlist': return {playlists:[playlist],total_num:1};
   case 'playlist/detail': return {playlist,media:[{entity:{track}}],has_more:false};
   case 'me/collection/mixed': return {mixed_collections:[{item_type:'album',album:{id:'a1',name:'Album'}}],total_num:1};
   case 'me/recently-played-media': return b ? {} : {media:[{entity:{track}}],has_more:false};
   case 'feed/mode': return {feed_mode_block:[],feed_mode_bar:{feed_mode:[]}};
   case 'feed/song-tab': return {media:[{entity:{track}}],has_more:false};
   case 'discover': return {blocks:[{inner_block:[{resources:[{entity:{ranked_track:{track}}}]}]}]};
   case 'track_v2': return {lyric:{content:'[00:01.00]Song'}};
   case 'comments': return {comments:[{id:'c1',content:'Hello',time_created:2}],count:'1',has_more:false};
   case 'comments/create': return {comment:{id:'c2',content:b.text}};
   case 'me/playlist': return {playlist:{id:'new1'}};
   default: if (/^\/luna\/pc\/me\/(collection\/(media|album|playlist)|playlist\/media\/append)$/.test(path)) return {};
    throw Error('Unexpected transport path '+path);
  }
 };
}
async function bridge(t, api) {
 const service = new Features({api,account:async()=>({id:'u1',name:'User'})});
 const storage = new Map([['cookie','sessionid=synthetic'],['account',{id:'u1',name:'User'}],['authBackend','sdk-v1']]);
 const requests=[],timers=[],readers=[],lines=[];let closed=false;
 const proc={write(line){const r=parseRequest(line);requests.push(r);Promise.resolve().then(async()=>{
  try {const result=r.op==='hello'?{protocol:1,version:'0.4.1'}:r.op==='catalog'?await service.dispatch(r.params):null;emit({id:r.id,ok:true,result});}
  catch(e){emit({id:r.id,ok:false,error:publicError(e)});}
 });},readLine(){return lines.length?Promise.resolve(lines.shift()):closed?Promise.resolve(null):new Promise(r=>readers.push(r));},kill(){closed=true;for(const r of readers.splice(0))r(null);}};
 function emit(v){const line=encodeResponse(v);readers.length?readers.shift()(line):lines.push(line);}
 const context=vm.createContext({URL,console,setTimeout:(f,ms)=>{timers.push(ms);return setTimeout(f,ms);},clearTimeout,host:{dir:'/plugin',dataDir:'/data',spawn:()=>proc,storage:{get:k=>storage.get(k),set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)}}});
 const mod=new vm.SourceTextModule(fs.readFileSync(require.resolve('../index.js'),'utf8'),{context});await mod.link(()=>{});await mod.evaluate();
 t.after(()=>{service.reset();proc.kill();});return {p:mod.namespace,requests,timers,service};
}
test('all feature exports traverse JSONL and real modules with only API transport fixtures',async t=>{
 const log=[];const {p,requests,timers}=await bridge(t,transport(log));
 assert.equal((await p.home()).sections[0].tracks[0].duration,123000);
 for(const page of ['discover','charts','history','library'])assert.ok((await p.browse({page})).sections.length);
 for(const kind of ['tracks','albums','artists','playlists'])assert.equal((await p.search({query:'test',kind,offset:0}))[kind].length,1);
 assert.equal((await p.playlists())[0].mine,true);assert.equal((await p.playlist({id:'p1'})).tracks[0].id,'t1');
 assert.equal((await p.liked({offset:0})).tracks.length,1);assert.equal((await p.isLiked({ids:['t1','absent']})).absent,false);
 assert.equal((await p.savedAlbums({offset:0})).albums[0].id,'a1');assert.equal((await p.recent())[0].id,'t1');
 assert.equal((await p.stations())[0].id,'default');assert.equal((await p.stationNext({id:'fresh'}))[0].id,'t1');
 assert.equal((await p.lyrics({id:'t1'})).lrc,'[00:01.00]Song');assert.equal((await p.comments({trackId:'t1',offset:0})).comments[0].time,2000);
 assert.equal((await p.postComment({trackId:'t1',text:'Test'})).id,'c2');
 for(const name of ['like','savePlaylist','saveAlbum'])await p[name]({id:'t1',on:true});
 assert.equal((await p.createPlaylist({name:'New'})).mine,true);
 assert.equal((await p.addToPlaylist({id:'p1',trackIds:['t1','t2']})).confirmed,2);await p.played({id:'t1'});
 assert.equal(requests.filter(r=>r.op==='catalog').length,26);assert.ok(timers.includes(28000));
 for(const name of ['suggest','album','artist','followArtist','deletePlaylist','renamePlaylist','removeFromPlaylist','movePlaylistTrack','likeComment','shows','remotePlay'])assert.equal(p[name],undefined);
 assert.deepEqual(log.filter(x=>x.path.endsWith('/append')).map(x=>x.b.media[0].id),['t1','t2']);
});
test('fixed dispatch rejects malicious/internal names before account or transport',async()=>{
 const s=new Features({api:()=>assert.fail(),account:()=>assert.fail()});
 for(const method of ['constructor','__proto__','toString','clear','invalidate','collection','reset','dispatch'])await assert.rejects(s.dispatch({method,args:{}}),{code:'protocol'});
});
test('partial mutations cross public error boundary safely without retry',async t=>{
 let n=0;const {p}=await bridge(t,async()=>{if(++n===2)throw Error('https://secret.invalid?cookie=secret');return {};});
 await assert.rejects(p.addToPlaylist({id:'p1',trackIds:['t1','t2','t3']}),e=>e.code==='qishui-mutation-unknown'&&e.confirmed===1&&!e.message.includes('secret'));
 assert.equal(n,2);
});
test('reset cancels reads and in-flight writes; late responses cannot fill new caches',async()=>{
 for(const method of ['comments','search','addToPlaylist']){
  let release, signal;const s=new Features({account:async()=>({id:'u1'}),api:(_p,_q,_b,s)=>{signal=s;return new Promise(r=>release=r);}});
  const pending=s.dispatch({method,args:method==='comments'?{trackId:'t1'}:method==='search'?{query:'x'}:{playlistId:'p1',ids:['t1','t2']}});
  await new Promise(setImmediate);s.reset();
  await assert.rejects(pending,e=>e.code===(method==='addToPlaylist'?'mutation-unknown':'account'));
  assert.equal(signal.aborted,true);release({comments:[],count:'0',has_more:false});await new Promise(setImmediate);
  assert.equal(s.community.sessions.size,0);
 }
});
test('one 25s deadline includes account resolution and all page requests',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let accountResolve;let apiCalls=0;
 const s=new Features({account:()=>new Promise(r=>accountResolve=r),api:async()=>{apiCalls++;return new Promise(()=>{});}});
 const pending=s.dispatch({method:'comments',args:{trackId:'t1'}});
 await new Promise(setImmediate);t.mock.timers.tick(24000);accountResolve({id:'u1'});await new Promise(setImmediate);
 t.mock.timers.tick(1000);await assert.rejects(pending,{code:'timeout'});assert.equal(apiCalls,1);
});
test('account changes discard Community cursor caches',async()=>{
 let uid='u1';let calls=0;const s=new Features({account:async()=>({id:uid}),api:async()=>{calls++;return {comments:[],count:'0',has_more:false};}});
 await s.dispatch({method:'comments',args:{trackId:'t1'}});uid='u2';await s.dispatch({method:'comments',args:{trackId:'t1'}});assert.equal(calls,2);
});
test('multiple pages share the account signal and remaining deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const signals=[];let accountSignal;let page=0;
 const s=new Features({account:async signal=>{accountSignal=signal;assert.equal(featureContext.getStore().signal,signal);return {id:'u1'};},api:async(_p,q,_b,signal)=>{
  signals.push(signal);if(++page===1){t.mock.timers.tick(24000);return {comments:[{id:'c1',content:'one'}],count:'2',has_more:true,cursor:'opaque'};}
  assert.equal(q.cursor,'opaque');return new Promise(()=>{});
 }});
 const pending=s.dispatch({method:'comments',args:{trackId:'t1',offset:1}});await new Promise(setImmediate);
 t.mock.timers.tick(1000);await assert.rejects(pending,{code:'timeout'});assert.equal(signals.length,2);assert.ok(signals.every(s=>s===accountSignal&&s.aborted));
});
test('hanging account and queued Catalog reads are cancelled at their shared deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let reads=0;
 const s=new Features({account:async()=>({id:'u1'}),api:()=>{reads++;return new Promise(()=>{});}});
 const a=s.dispatch({method:'search',args:{query:'one'}}),b=s.dispatch({method:'search',args:{query:'two'}});
 await new Promise(setImmediate);t.mock.timers.tick(25000);
 await assert.rejects(a,{code:'timeout'});await assert.rejects(b,{code:'timeout'});assert.equal(reads,1);
 const h=new Features({account:()=>new Promise(()=>{}),api:()=>assert.fail()});const p=h.dispatch({method:'home'});
 t.mock.timers.tick(25000);await assert.rejects(p,{code:'timeout'});
});
test('deadline on second append retains one confirmed write and stops the batch',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let n=0;
 const s=new Features({account:async()=>({id:'u1'}),api:async()=>++n===1?{}:new Promise(()=>{})});
 const p=s.dispatch({method:'addToPlaylist',args:{playlistId:'p1',ids:['t1','t2','t3']}});
 await new Promise(setImmediate);t.mock.timers.tick(25000);await assert.rejects(p,e=>e.code==='mutation-unknown'&&e.confirmed===1);assert.equal(n,2);
});
test('mutation invalidation refreshes real Catalog liked set',async()=>{
 const calls=[];const s=new Features({account:async()=>({id:'u1'}),api:transport(calls)});
 await s.dispatch({method:'isLiked',args:{ids:['t1']}});await s.dispatch({method:'isLiked',args:{ids:['t1']}});
 assert.equal(calls.filter(c=>c.path.endsWith('/detail')).length,1);
 await s.dispatch({method:'like',args:{id:'t1',on:true}});await s.dispatch({method:'isLiked',args:{ids:['t1']}});
 assert.equal(calls.filter(c=>c.path.endsWith('/detail')).length,2);
});
test('public errors use fixed messages and bounded counts',()=>{
 for(const code of ['input','limit','pagination','mutation-unknown','cache','response']){
  const e=publicError({code,message:'cookie=secret',confirmed:1});assert.equal(e.code,code);assert.ok(!e.message.includes('secret'));
 }
 for(const confirmed of [-1,101,Infinity,'1'])assert.equal(publicError({code:'mutation-unknown',confirmed}).confirmed,undefined);
});
// Load the actual Runtime class without starting Electron, opening storage, or loading SDK assets.
function runtimeClass(fetch) {
 const {createRequire}=require('node:module');const file=require.resolve('../helper/runtime.cjs');const local=createRequire(file);const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:name=>name==='electron'?{protocol:{registerSchemesAsPrivileged(){}}}:local(name),fetch,URL,AbortSignal,AbortController,setTimeout,clearTimeout,process,Buffer});
 return module.exports.Runtime;
}
test('Runtime API inherits feature signal for account and all transport requests',async()=>{
 const signals=[];const Runtime=runtimeClass(async(_url,options)=>{signals.push(options.signal);return {status:200,text:async()=>JSON.stringify(signals.length===1?{id:'u1',nickname:'User'}:{comments:[],count:'0',has_more:false})};});
 const runtime=Object.create(Runtime.prototype);
 runtime.base=async()=>{};runtime.identity={deviceId:'synthetic-device',installId:'synthetic-install'};
 runtime.cookieHeader=async()=>'';runtime.loadNative=()=>({generateHttpSignatureHeaders:()=> 'x-helios\r\nsynthetic-signature'});
 runtime.features=new Features({account:()=>runtime.featureAccount(),api:(...args)=>runtime.api(...args)});
 await runtime.catalog({method:'comments',args:{trackId:'t1'}});
 assert.equal(signals.length,2);assert.ok(signals[0] instanceof AbortSignal);assert.equal(signals[0],signals[1]);
});
test('Runtime cancel resets features and rejects in-flight reads before late transport',async()=>{
 const Runtime=runtimeClass(()=>assert.fail());const runtime=Object.create(Runtime.prototype);
 let release;runtime.features=new Features({account:async()=>({id:'u1'}),api:()=>new Promise(r=>release=r)});
 const pending=runtime.catalog({method:'comments',args:{trackId:'t1'}});await new Promise(setImmediate);
 runtime.cancel();await assert.rejects(pending,{code:'account'});release({comments:[],count:'0',has_more:false});
 await new Promise(setImmediate);assert.equal(runtime.features.community.sessions.size,0);
});
test('Playback 25s deadline kills a real blocked ffmpeg process and removes partial files',async t=>{
 const fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
 const {createRequire}=require('node:module');const file=require.resolve('../helper/playback.cjs'),local=createRequire(file),module={exports:{}};
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'qishui-deadline-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));
 let child,spawned;const started=new Promise(r=>spawned=r);
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:name=>name==='node:child_process'?{spawn:(...args)=>{child=cp.spawn(...args);child.once('spawn',spawned);return child;}}:local(name),process,Buffer,URL,fetch,AbortController,setTimeout:(...a)=>setTimeout(...a),clearTimeout:(...a)=>clearTimeout(...a)});
 const {Playback,transcode}=module.exports;
 const fifo=path.join(root,'blocked-input');cp.execFileSync('mkfifo',[fifo]);
 const fixture={track:{duration:180000,label_info:{quality_map:{medium:{play_detail:{need_vip:false,need_purchase:false}}}}},track_player:{video_model:JSON.stringify({video_duration:180,video_list:[{main_url:'https://v3-luna.douyinvod.com/synthetic',video_meta:{quality:'medium',vtype:'m4a',codec_type:'aac'},encrypt_info:{encrypt:false}}]})}};
 t.mock.timers.enable({apis:['setTimeout']});
 const playback=new Playback({dataDir:root,api:async p=>p.endsWith('/me')?{my_info:{}}:fixture,fetcher:async()=>new Response('synthetic'),encoder:(_input,output,rate,signal)=>transcode(fifo,output,rate,signal)});
 t.after(()=>playback.close());t.after(()=>child?.kill('SIGKILL'));
 const pending=playback.prepare({id:'t1'});
 await started;t.mock.timers.tick(25000);await assert.rejects(pending,{code:'timeout'});
 assert.equal(child.signalCode,'SIGKILL');assert.equal(playback.cache.size,0);
 assert.deepEqual(await fsp.readdir(await playback.directory),[]);
});
for(const action of ['signIn','signOut'])test(`Runtime ${action} clears Community and cancels pending Catalog reads`,async()=>{
 const Runtime=runtimeClass(()=>assert.fail());const runtime=Object.create(Runtime.prototype);
 runtime.features=new Features({account:async()=>({id:'u1'}),api:()=>new Promise(()=>{})});
 runtime.emit=()=>{};runtime.ready=async()=>{throw Error('synthetic SDK unavailable');};
 runtime.base=async()=>{throw Error('synthetic storage unavailable');};
 const pending=runtime.catalog({method:'search',args:{query:'test'}});await new Promise(setImmediate);
 runtime.features.community.sessions.set('t1',{});
 await assert.rejects(runtime[action]());await assert.rejects(pending,{code:'account'});
 assert.equal(runtime.features.community.sessions.size,0);
});
test('signOut refuses new feature reads while session cleanup is awaiting',async()=>{
 const Runtime=runtimeClass(()=>assert.fail());const runtime=Object.create(Runtime.prototype);
 runtime.features=new Features({account:async()=>({id:'u1'}),api:()=>assert.fail()});
 let release;runtime.base=()=>new Promise(r=>release=r);runtime.playback={close:async()=>{}};runtime.ses={clearStorageData:async()=>{}};
 const cleanup=runtime.signOut();
 assert.throws(()=>runtime.catalog({method:'home'}),{code:'busy'});
 release();await cleanup;assert.equal(runtime.resetting,false);
});
