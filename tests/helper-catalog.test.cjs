'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Catalog, mapTrack, mapAlbum, mapArtist, mapPlaylist} = require('../helper/catalog.cjs');
const track = id => ({id, name:'Song', duration:123456, album:{id:'a',name:'Album',url_cover:{urls:['https://img.test/a']}},artists:[{id:'r',name:'Artist'}]});
const media = id => ({entity:{track:track(id)}});
const account = async()=>({id:'me',name:'Me'});
const make = api => new Catalog({api,account});
const group = (kind,items,more=false,cursor='ignored')=>({result_groups:[{id:kind,data:items,has_more:more,next_cursor:cursor}]});
test('DTOs preserve nested entities, covers and milliseconds without synthetic IDs',()=>{
 assert.equal(mapTrack(media('t')).duration,123456); assert.equal(mapTrack(media('t')).album.imageUrl,'https://img.test/a');
 assert.equal(mapAlbum({entity:{album:track('t').album}}).id,'a'); assert.equal(mapArtist({entity:{artist:{id:'r',name:'R'}}}).name,'R');
 assert.equal(mapPlaylist({id:'p',title:'P',owner:{id:'other'}},'me').mine,false);
 assert.throws(()=>mapTrack({name:'bad'}));
});
for(const [kind,singular] of Object.entries({tracks:'track',albums:'album',artists:'artist',playlists:'playlist'})) test(`search ${kind} exact route and terminal precedence`,async()=>{
 const c=make(async(path,q)=>{assert.equal(path,`/luna/pc/search/${singular}`); assert.equal(q.cursor,'');return group(kind,[{entity:{[singular]: singular==='track'?track('x'):{id:'x',name:'X',title:'X'}}}]);});
 const out=await c.search({query:'q',kind,offset:0});assert.equal(out[kind][0].id,'x');assert.equal(out.more,false);
});
test('opaque cursors, duplicate deduplication and unknown offset backfill',async()=>{
 const seen=[]; const c=make(async(p,q)=>{seen.push(q.cursor);return q.cursor===''?group('tracks',[media('1'),media('1')],true,'opaque'):group('tracks',[media('2')]);});
 assert.equal((await c.search({query:'q',kind:'tracks',offset:1})).tracks[0].id,'2'); assert.deepEqual(seen,['','opaque']);
});
for(const bad of [group('tracks',[],true,'x'),group('tracks',[media('1')],true,''),{}]) test('malformed pagination fails',async()=>{await assert.rejects(make(async()=>bad).search({query:'q',kind:'tracks',offset:0}));});
test('cycles and backfill bound fail without fake empty pages',async()=>{
 let n=0; const c=make(async()=>group('tracks',[media(String(++n))],true,'same'));
 await assert.rejects(c.search({query:'q',kind:'tracks',offset:2}),{code:'pagination'});
 n=0;const d=make(async()=>group('tracks',[media(String(++n))],true,String(n)));
 await assert.rejects(d.search({query:'q',kind:'tracks',offset:9}),{code:'pagination'});assert.equal(n,8);
});
test('input boundaries reject before API',async()=>{
 const c=make(async()=>{throw Error('unexpected API');});
 for(const args of [{query:'x',kind:'tracks',offset:-1},{query:'x',kind:'tracks',offset:1.2},{query:'x',kind:'shows'},{query:'x'.repeat(513),kind:'tracks'}]) await assert.rejects(c.search(args),{code:'protocol'});
 await assert.rejects(c.playlist({id:'https://evil'}),{code:'protocol'});await assert.rejects(c.browse({page:'https://evil'}),{code:'protocol'});await assert.rejects(c.isLiked({ids:Array(501).fill('x')}),{code:'protocol'});
});
const own=[{id:'liked',title:'我喜欢',type:1,owner:{id:'me'}},{id:'p',title:'Mine',owner:{id:'me'}}];
function libraryApi(path){if(path.endsWith('/user/playlist'))return {playlists:own,total_num:2};if(path.endsWith('/collection/mixed'))return {mixed_collections:[{item_type:'album',album:{id:'a',name:'A'}},{item_type:'playlist',playlist:{id:'p',title:'Saved'}}],total_num:2};return {playlist:own[0],media:[media('t')],has_more:false};}
test('owned playlists win, collections classified, complete likes and invalidation',async()=>{
 let calls=0;const c=make(async p=>{calls++;return libraryApi(p);});
 assert.equal((await c.playlists()).find(p=>p.id==='p').mine,true);
 assert.deepEqual((await c.savedAlbums({offset:0})).albums.map(x=>x.id),['a']);
 assert.deepEqual(await c.isLiked({ids:['t','missing']}),{t:true,missing:false});const before=calls;await c.isLiked({ids:['t']});assert.equal(calls,before);
 c.invalidate('like');await c.isLiked({ids:['t']});assert.ok(calls>before);c.clear();
 assert.equal((await c.liked({offset:0})).tracks.length,1);
});
test('missing liked playlist and explicit incomplete lists cannot establish negative membership',async()=>{
 await assert.rejects(make(async()=>({playlists:[]})).isLiked({ids:['x']}));
 await assert.rejects(make(async()=>({playlists:own,total_num:3,has_more:true})).playlists(),{code:'pagination'});
});
test('legacy valid GET list without metadata is one complete response; missing list fails',async()=>{
 const c=make(async p=>p.endsWith('/user/playlist')?{playlists:[]}:{mixed_collections:[]});assert.deepEqual(await c.playlists(),[]);
 await assert.rejects(make(async()=>({})).savedAlbums({offset:0}),{code:'response'});
});
test('playlist completeness, page and time caps',async()=>{
 let n=0;const c=make(async()=>({playlist:own[0],media:[media(String(++n))],has_more:true,next_cursor:String(n)}));
 await assert.rejects(c.playlist({id:'liked'}),{code:'pagination'});assert.equal(n,50);
 let time=0;const d=new Catalog({account,now:()=>time,api:async()=>{time=26000;return {playlist:own[0],media:[],has_more:false};}});
 await assert.rejects(d.playlist({id:'liked'}),{code:'pagination'});
});
test('account change clears cached likes and cursors',async()=>{
 let id='me'; const c=new Catalog({account:async()=>({id}),api:async p=>p.endsWith('/user/playlist')?{playlists:[{...own[0],owner:{id}}]}:{playlist:own[0],media:[media(id)],has_more:false}});
 assert.equal((await c.isLiked({ids:['me']})).me,true);id='other';assert.equal((await c.isLiked({ids:['me']})).me,false);
});
test('history maps tracks; discovery skips video and separates charts',async()=>{
 const c=make(async p=>p.endsWith('/recently-played-media')?{media:[media('h')],has_more:false}:{blocks:[{title:'D',inner_block:[{resources:[{entity:{playlist:{id:'p',title:'P'}}},{entity:{ranked_track:{track:track('r')}}},{entity:{video:{id:'v'}}}]}]}]});
 assert.equal((await c.recent())[0].id,'h');assert.equal((await c.browse({page:'charts'})).sections[0].tracks[0].id,'r');assert.equal((await c.browse({page:'discover'})).sections[0].playlists[0].id,'p');
});
test('discovery posts an empty body and charts filter mixed playlist/ranked_track blocks',async()=>{
 const calls=[];
 // Synthetic values following the supplied read-only schema: 10 playlist and 3 chart blocks.
 const blocks=[
  {type:'discover_feed_playlist',title:'Playlists',inner_block:Array.from({length:10},(_,i)=>({title:`Playlist ${i}`,resources:[{entity:{playlist:{id:`p${i}`,title:`P${i}`}}}]}))},
  {type:'discover_top_song_list',title:'Charts',inner_block:Array.from({length:3},(_,i)=>({title:`Chart ${i}`,resources:[{entity:{ranked_track:{track:track(`r${i}`)}}},{entity:{playlist:{id:`extra${i}`,title:'Related'}}},{entity:{track:track(`plain${i}`)}},{entity:{video:{id:`v${i}`}}}]}))},
 ];
 const c=make(async(path,query,body)=>{calls.push({path,query,body});assert.equal(path,'/luna/pc/discover');assert.deepEqual(query,{});assert.deepEqual(body,{});return {blocks};});
 const discovery=await c.browse({page:'discover'});
 assert.equal(discovery.sections.length,13);
 assert.deepEqual(discovery.sections.slice(0,10).flatMap(s=>s.playlists.map(p=>p.id)),Array.from({length:10},(_,i)=>`p${i}`));
 assert.deepEqual(discovery.sections.slice(10).map(s=>s.tracks.map(t=>t.id)),[['r0','plain0'],['r1','plain1'],['r2','plain2']]);
 assert.deepEqual(discovery.sections.slice(10).flatMap(s=>s.playlists.map(p=>p.id)),['extra0','extra1','extra2']);
 const charts=await c.browse({page:'charts'});
 assert.deepEqual(charts,{title:'榜单',sections:Array.from({length:3},(_,i)=>({title:`Chart ${i}`,tracks:[mapTrack(track(`r${i}`))],albums:[],artists:[],playlists:[]}))});
 assert.equal(calls.length,2);
});
test('feed sessions isolate modes and continue home, bounded repeated pages',async()=>{
 const bodies=[];const c=make(async(p,q,b)=>{if(p.endsWith('/mode'))return {feed_mode_block:[{feed_mode:[{text:'Scene',entity:{feed_scene_mode:{scene_mode_id:4}}}]}],feed_mode_bar:{feed_mode:[]}};bodies.push(b);return {media:[media('t')]};});
 assert.ok((await c.stations()).some(x=>x.id==='scene:4')); const home=await c.home();assert.equal(home.sections[0].morePage,'feed:default');
 await c.browse({page:'feed:default'});await c.stationNext({id:'fresh'});assert.equal(bodies[0].is_first_request,true);assert.equal(bodies[1].is_first_request,false);assert.equal(bodies.at(-1).is_first_request,true);assert.deepEqual(bodies.at(-1).feed_preference,{preference_mode:'fresh'});assert.equal(bodies.length,4);
 await assert.rejects(c.stationNext({id:'scene:999'}),{code:'protocol'});
});
test('existing PC feed wrapper and items contract preserves real track ID and cover URI',async()=>{
 const wrapped={id:'wrapper',type:'track',entity:{track_wrapper:{track:{base_info:{id:'real',name:'Wrapped',duration:123000},display_info:{cover_url:{urls:['https://images.test/'],uri:'cover-key'}},related_info:{artist_links:[{id:'r',name:'R'}],album_link:{id:'a',name:'A'}}}}}};
 const c=make(async()=>({items:[wrapped],has_more:false}));const t=(await c.home()).sections[0].tracks[0];assert.equal(t.id,'real');assert.equal(t.duration,123000);assert.equal(t.album.imageUrl,'https://images.test/cover-key');assert.equal(t.artists[0].id,'r');
});
test('search uses documented input method',async()=>{const c=make(async(p,q)=>{assert.equal(q.search_method,'input');return group('tracks',[]);});await c.search({query:'q'});});
test('track mapping refuses explicitly non-track media',()=>{assert.throws(()=>mapTrack({id:'v',type:'video',name:'Video'}),{code:'response'});});
test('clear rejects stale in-flight result and concurrent calls serialize cursors',async()=>{
 let release;const c=make(()=>new Promise(resolve=>{release=resolve;}));const pending=c.home();await new Promise(resolve=>setImmediate(resolve));c.clear();release({media:[media('x')]});await assert.rejects(pending,{code:'account'});
 let n=0;const d=make(async()=>({media:[media(String(++n))]}));const [a,b]=await Promise.all([d.home(),d.home()]);assert.notEqual(a.sections[0].tracks[0].id,b.sections[0].tracks[0].id);
});
test('feed buffers remain bounded and every public read rejects missing required lists',async()=>{
 let n=0;const c=make(async()=>({media:Array.from({length:100},()=>media(String(++n)))}));for(let i=0;i<12;i++)await c.stationNext({id:'default'});assert.equal(c.feeds.get('default').seen.size,1000);assert.equal(c.feeds.get('default').played.length,30);
 for(const invoke of [c=>c.home(),c=>c.recent(),c=>c.stations(),c=>c.stationNext({id:'default'}),c=>c.browse({page:'discover'}),c=>c.playlist({id:'x'}),c=>c.playlists(),c=>c.liked(),c=>c.isLiked({ids:['x']})])await assert.rejects(invoke(make(async()=>({}))),{code:'response'});
});
test('playlist rejects more after 5000 rows and accepts a terminal 5000-row page',async()=>{
 const rows=Array.from({length:5000},(_,i)=>media(String(i)));
 await assert.rejects(make(async()=>({playlist:own[0],media:rows,has_more:true,next_cursor:'n'})).playlist({id:'liked'}),{code:'pagination'});
 assert.equal((await make(async()=>({playlist:own[0],media:rows,has_more:false})).playlist({id:'liked'})).tracks.length,5000);
});
test('discovery bounds aggregate resources across nested blocks',async()=>{
 const c=make(async()=>({blocks:[{inner_block:[{resources:Array(3000).fill({entity:{video:{}}})},{resources:Array(3000).fill({entity:{video:{}}})}]}]}));
 await assert.rejects(c.browse({page:'discover'}),{code:'pagination'});
});
test('search namespace isolation, complete likes TTL, and browse library/history routing',async()=>{
 const calls=[];const c=make(async(p,q)=>{calls.push(q.cursor);return group('tracks',[media('x')],true,'next');});
 await c.search({query:'one'});await c.search({query:'two'});assert.deepEqual(calls,['','']);
 let time=0,n=0;const d=new Catalog({account,now:()=>time,api:async p=>{n++;return libraryApi(p);}});
 await d.isLiked({ids:['t']});const before=n;time=30001;await d.isLiked({ids:['t']});assert.ok(n>before);
 assert.equal((await d.browse({page:'library'})).sections[0].playlists.length,2);
 const e=make(async()=>({media:[],has_more:false}));assert.deepEqual((await e.browse({page:'history'})).sections[0].tracks,[]);
});
test('playlist terminal false wins; collection pagination cannot invent a cursor',async()=>{
 const c=make(async()=>({playlist:own[0],media:[],has_more:false,next_cursor:'stale',total_num:99}));assert.deepEqual((await c.playlist({id:'liked'})).tracks,[]);
 await assert.rejects(make(async()=>({mixed_collections:[],total_num:1,has_more:true})).savedAlbums(),{code:'pagination'});
 const d=make(async()=>({playlists:[{id:'x',title:'My Liked Songs',owner:{id:'me'}}]}));await assert.rejects(d.isLiked({ids:['x']}),{code:'pagination'});
});
test('large feed pages deduplicate within a page even when the seen ring evicts IDs',async()=>{
 const rows=Array.from({length:1200},(_,i)=>media(String(i)));const c=make(async()=>({media:[...rows,...rows],has_more:false}));
 const out=await c.stationNext({id:'default'});assert.equal(out.length,1200);assert.equal(new Set(out.map(x=>x.id)).size,out.length);
});

const wrappedMedia = value => ({type:'track',entity:{track_wrapper:{track:{base_info:{id:value,name:'Wrapped',duration:123000},display_info:{cover_url:'https://img.test/wrapped'},related_info:{album_link:{id:'a',name:'Album'},artist_links:[{id:'r',name:'Artist'}]}}}}});
test('observed playlist media_resources paginates wrappers for detail and complete likes',async()=>{
 for(const read of [c=>c.playlist({id:'liked'}),c=>c.liked(),c=>c.isLiked({ids:['first','last','absent']})]){
  const cursors=[];const c=make(async(path,q)=>{
   if(path.endsWith('/user/playlist'))return {playlists:own};
   assert.equal(path,'/luna/pc/playlist/detail');assert.equal(q.playlist_id,'liked');cursors.push(q.cursor);
   return {playlist:own[0],media_resources:[wrappedMedia(q.cursor?'last':'first')],has_more:!q.cursor,next_cursor:'opaque-detail'};
  });
  const out=await read(c);assert.deepEqual(cursors,['','opaque-detail']);
  if(out.tracks){assert.deepEqual(out.tracks.map(t=>t.id),['first','last']);assert.equal(out.tracks[0].duration,123000);assert.equal(out.tracks[0].album.imageUrl,'https://img.test/wrapped');}
  else assert.deepEqual(out,{first:true,last:true,absent:false});
 }
});
test('present invalid media_resources never falls back to legacy media',async()=>{
 await assert.rejects(make(async()=>({playlist:own[0],media_resources:null,media:[],has_more:false})).playlist({id:'liked'}),{code:'response'});
});
for(const reset of ['clear','invalidate'])test(`${reset} cancels account-pending and already queued reads before API access`,async()=>{
 let release,started;const entered=new Promise(resolve=>{started=resolve;});let accounts=0,calls=0;
 const c=new Catalog({account:()=>{accounts++;if(accounts===1){started();return new Promise(resolve=>{release=resolve;});}return account();},api:async()=>{calls++;return {media:[media('new')],has_more:false};}});
 const pending=c.home();await entered;const queued=c.home();
 const rejected=Promise.all([assert.rejects(pending,{code:'account'}),assert.rejects(queued,{code:'account'})]);
 c[reset]();release({id:'me'});await rejected;
 assert.equal(accounts,1);assert.equal(calls,0);assert.equal(c.accountId,null);assert.equal(c.feeds.size,0);
 assert.equal((await c.home()).sections[0].tracks[0].id,'new');assert.equal(calls,1);
});
for(const reset of ['clear','invalidate'])test(`${reset} cancels reads queued before execution starts`,async()=>{
 let calls=0;const c=new Catalog({account:async()=>{calls++;return {id:'me'};},api:async()=>({media:[]})});
 const pending=c.home();c[reset]();await assert.rejects(pending,{code:'account'});assert.equal(calls,0);
});
test('empty feed with explicit continuation errors without poisoning subsequent continuation',async()=>{
 const bodies=[];const c=make(async(p,q,b)=>{bodies.push(b);return bodies.length===1?{media:[],has_more:true}:{media:[media('next')],has_more:false};});
 await assert.rejects(c.home(),{code:'pagination'});assert.equal(bodies.length,1);assert.equal(c.feeds.get('default').done,false);
 const out=await c.browse({page:'feed:default'});assert.equal(out.sections[0].tracks[0].id,'next');assert.equal(out.sections[0].morePage,undefined);assert.equal(bodies[1].is_first_request,false);
});
test('station empty continuation is bounded; explicit terminal empty feed ends normally',async()=>{
 let calls=0;const c=make(async()=>{calls++;return {items:[],has_more:true};});
 await assert.rejects(c.stationNext({id:'fresh'}),{code:'pagination'});assert.equal(calls,1);
 const d=make(async()=>({items:[],has_more:false}));assert.deepEqual((await d.home()).sections,[{tracks:[]}]);
});

// Synthetic regression fixtures from catalog-002's sanitized structural evidence.
test('omitted terminal has_more ignores residual liked cursor and caches complete membership',async()=>{
 let details=0;const c=make(async path=>{
  if(path.endsWith('/user/playlist'))return {playlists:own,total_num:2};
  details++;assert.equal(details,1);return {playlist:own[0],media_resources:[wrappedMedia('last')],next_cursor:'residual'};
 });
 assert.deepEqual((await c.liked()).tracks.map(t=>t.id),['last']);
 assert.deepEqual(await c.isLiked({ids:['last','absent']}),{last:true,absent:false});assert.equal(details,1);
});
test('history terminal omission stops below total_num without an extra request',async()=>{
 const sizes=[95,85,80,70,87],cursors=[];
 const c=make(async(p,q)=>{const i=cursors.length;cursors.push(q.cursor);assert.ok(i<sizes.length);return {media:Array.from({length:sizes[i]},(_,j)=>media(`p${i}_${j}`)),total_num:500,...(i<4?{has_more:true,next_cursor:`page${i+1}`}:{})};});
 assert.equal((await c.recent()).length,417);assert.deepEqual(cursors,['','page1','page2','page3','page4']);
});
test('matched terminal playlist metadata permits omitted empty media for detail and likes',async()=>{
 for(const terminal of [{},{has_more:false}]){
  const c=make(async p=>p.endsWith('/user/playlist')?{playlists:own}:{playlist:own[0],next_cursor:'stale',...terminal});
  assert.deepEqual((await c.playlist({id:'liked'})).tracks,[]);assert.deepEqual((await c.liked()).tracks,[]);
  assert.deepEqual(await c.isLiked({ids:['absent']}),{absent:false});
 }
});
test('omitted playlist media requires matching valid metadata even with successful status',async()=>{
 for(const root of [{},{playlist:{id:'other'}},{playlist:{id:42}},{playlist:[]},{status_info:{status_code:0}},{playlist:own[0],has_more:true,next_cursor:'n'},{playlist:own[0],media_resources:null},{playlist:own[0],media:null}]){
  await assert.rejects(make(async()=>root).playlist({id:'liked'}),{code:'response'});
 }
});
test('known GET lists may omit empty terminal arrays only with explicit successful status',async()=>{
 for(const terminal of [{},{has_more:false}]){
  const c=make(async()=>({status_info:{status_code:0},total_num:99,next_cursor:'stale',...terminal}));
  assert.deepEqual(await c.playlists(),[]);assert.deepEqual((await c.savedAlbums()).albums,[]);assert.deepEqual(await c.recent(),[]);
 }
 for(const root of [{},{status_info:null},{status_info:[]},{status_info:{}},{status_info:{status_code:1}},{status_info:{status_code:'0'}},{status_info:{status_code:0},has_more:true,next_cursor:'n'},{status_info:{status_code:0},media:null}]){
  await assert.rejects(make(async()=>root).recent(),{code:'response'});
 }
});
test('search terminal omission ignores cursor and totals; missing data needs success and matching group',async()=>{
 const c=make(async()=>({result_groups:[{id:'tracks',data:[media('last')],next_cursor:'stale',total_num:99}]}));
 assert.equal((await c.search({query:'q'})).more,false);
 const d=make(async()=>({status_info:{status_code:0},result_groups:[{id:'tracks'}]}));
 assert.deepEqual(await d.search({query:'q'}),{tracks:[],more:false});
 for(const root of [{result_groups:[{id:'tracks'}]},{status_info:{status_code:0}},{status_info:{status_code:0},result_groups:[{id:'albums'}]},{status_info:{status_code:0},result_groups:[{id:'tracks',has_more:true,next_cursor:'n'}]}])await assert.rejects(make(async()=>root).search({query:'q'}),{code:'response'});
});
test('nonboolean has_more is rejected for populated and omitted terminal lists',async()=>{
 for(const has_more of [null,0,1,'false',{},[]]){
  for(const extra of [{media:[]},{}])await assert.rejects(make(async()=>({status_info:{status_code:0},has_more,...extra})).recent(),{code:'response'});
  await assert.rejects(make(async()=>({result_groups:[{id:'tracks',data:[],has_more}]})).search({query:'q'}),{code:'response'});
 }
});
test('explicit continuation still requires a list, cursor and noncyclic progress',async()=>{
 for(const root of [{media:[],has_more:true,next_cursor:'n'},{media:[media('x')],has_more:true},{media:[media('x')],has_more:true,next_cursor:'x'.repeat(4097)}])await assert.rejects(make(async()=>root).recent(),{code:'pagination'});
 let calls=0;const c=make(async()=>({media:[media(String(++calls))],has_more:true,next_cursor:'same'}));await assert.rejects(c.recent(),{code:'pagination'});assert.equal(calls,2);
});
