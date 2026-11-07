'use strict';
const {fault} = require('./protocol.cjs');
const ROOT = '/luna/pc/';
const KINDS = {tracks:'track',albums:'album',artists:'artist',playlists:'playlist'};
function pagination() { const e = new Error('汽水分页数据不完整或超过读取上限。'); e.code = 'pagination'; return e; }
function id(value) { if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw fault('protocol'); return value; }
function offset(value=0) { if (!Number.isSafeInteger(value) || value<0) throw fault('protocol'); return value; }
function list(value) { if (!Array.isArray(value) || value.length>5000) throw fault('response'); return value; }
function entity(raw,kind) { const v=raw?.entity?.[kind] ?? raw?.[kind] ?? raw; if (!v || typeof v!=='object' || Array.isArray(v) || typeof v.id!=='string' || !/^[\w-]{1,128}$/.test(v.id)) throw fault('response'); return v; }
function text(v) { return typeof v==='string' ? v.slice(0,4096) : ''; }
function image(v) {
 let url=typeof v==='string'?v:v?.urls?.find(x=>typeof x==='string' && /^https?:\/\//.test(x));
 if(typeof url!=='string'||!/^https?:\/\//.test(url))return undefined;
 if(typeof v?.uri==='string' && !url.includes(v.uri) && url.endsWith('/'))url+=v.uri;
 return url.slice(0,4096);
}
function mapArtist(raw) { const v=entity(raw,'artist');return {id:v.id,name:text(v.name),imageUrl:image(v.url_cover??v.medium_avatar_url)}; }
function mapAlbum(raw) { const v=entity(raw,'album');return {id:v.id,name:text(v.name),imageUrl:image(v.url_cover),artists:v.artists===undefined?[]:list(v.artists).map(mapArtist)}; }
function mapTrack(raw) {
 if(raw?.type && raw.type!=='track')throw fault('response');
 const container=raw?.entity??raw;
 const wrapper=container?.track_wrapper?.track;
 const v=wrapper??entity(raw,'track');
 const base=v.base_info??v;
 entity(base,'track');
 const duration=base.duration_ms??base.duration??0;
 if (!Number.isSafeInteger(duration)||duration<0) throw fault('response');
 const albumRaw=v.related_info?.album_link??v.album;
 const album=albumRaw?mapAlbum(albumRaw):{id:'',name:''};
 if (!album.imageUrl) album.imageUrl=image(v.display_info?.cover_url??v.display_info?.url_cover??v.url_cover);
 const artists=v.related_info?.artist_links??v.artists;
 return {id:base.id,name:text(base.name),artists:artists===undefined?[]:list(artists).map(mapArtist),album,duration};
}
function mapPlaylist(raw,accountId) { const v=entity(raw,'playlist');return {id:v.id,name:text(v.title||v.public_title||v.name),imageUrl:image(v.url_cover),description:text(v.description),owner:text(v.owner?.nickname),trackCount:Number.isSafeInteger(v.count_tracks)&&v.count_tracks>=0?v.count_tracks:0,mine:!!accountId&&v.owner?.id===accountId}; }
const MAPPERS={tracks:mapTrack,albums:mapAlbum,artists:mapArtist,playlists:mapPlaylist};
function unique(items) { return [...new Map(items.map(x=>[x.id,x])).values()]; }
function nextPage(root,count,totalRead,cursors) {
 if(root.has_more!==undefined && typeof root.has_more!=='boolean') throw fault('response');
 if(root.has_more===false) return null;
 let more=root.has_more===true;
 if(root.total_num!==undefined) { if(!Number.isSafeInteger(root.total_num)||root.total_num<0) throw fault('response');more ||= totalRead<root.total_num; }
 // Legacy GET snapshots without any pagination metadata are single responses.
 if(!more) { if(root.next_cursor && root.has_more===undefined && root.total_num===undefined) more=true; else return null; }
 if(!count || typeof root.next_cursor!=='string'||!root.next_cursor||root.next_cursor.length>4096||cursors.has(root.next_cursor)) throw pagination();
 return root.next_cursor;
}
class Catalog {
 constructor({api,account,now=Date.now}={}) {
  if(typeof api!=='function'||typeof account!=='function'||typeof now!=='function') throw fault('protocol');
  this.api=api;this.account=account;this.now=now;this.generation=0;this.queue=Promise.resolve();this.clear();
 }
 _reset() { this.accountId=null;this.searches=new Map();this.feeds=new Map();this.modes=null;this.likes=null; }
 clear() { this.generation++;this._reset(); }
 invalidate(scope) { if(scope!==undefined && (typeof scope!=='string'||scope.length>128)) throw fault('protocol');this.clear(); }
 async _run(fn) {
  // Capture at submission so resets also cancel operations still in the queue.
  const generation=this.generation;
  const operation=this.queue.then(async()=>{
   if(generation!==this.generation)throw fault('account');
   const a=await this.account();
   if(generation!==this.generation)throw fault('account');
   if(!a) {this.clear();throw fault('account');}id(a.id);
   // Serialized account changes reset caches without cancelling subsequent reads.
   if(this.accountId!==a.id){this._reset();this.accountId=a.id;}
   const ctx={generation:this.generation,start:this.now()};return fn(ctx);
  });this.queue=operation.catch(()=>{});return operation;
 }
 _check(ctx) { if(ctx.generation!==this.generation) throw fault('account');if(this.now()-ctx.start>=25000) throw pagination(); }
 async _api(ctx,path,query={},body) {
  this._check(ctx);let timer;
  try { const result=await Promise.race([this.api(ROOT+path,query,body),new Promise((_,reject)=>{timer=setTimeout(()=>reject(pagination()),Math.max(1,25000-(this.now()-ctx.start)));})]);
   this._check(ctx);if(!result||typeof result!=='object'||Array.isArray(result)) throw fault('response');return result;
  } finally {clearTimeout(timer);}
 }
 async _all(ctx,path,field,query={},mapper=x=>x,maxPages=50) {
  let cursor='';const cursors=new Set(['']);const out=[];let root;let rawCount=0;
  for(let page=0;page<maxPages;page++){
   root=await this._api(ctx,path,{...query,cursor,count:100});const key=Array.isArray(field)?field.find(k=>Object.hasOwn(root,k)):field;const raw=list(root[key]);rawCount+=raw.length;if(rawCount>5000)throw pagination();out.push(...raw.map(mapper));
   const next=nextPage(root,raw.length,rawCount,cursors);if(next===null)return {items:out,root};if(rawCount>=5000)throw pagination();cursors.add(next);cursor=next;
  }throw pagination();
 }
 search({query,kind='tracks',offset:at=0}={}) {
  return this._run(async ctx=>{
   offset(at);if(typeof query!=='string'||!query.trim()||query.length>512||!Object.hasOwn(KINDS,kind))throw fault('protocol');
   const key=JSON.stringify([query,kind]);let s=this.searches.get(key);
   if(!s){s={items:[],cursor:'',cursors:new Set(['']),done:false};this.searches.set(key,s);while(this.searches.size>16)this.searches.delete(this.searches.keys().next().value);}
   for(let n=0;n<8;n++){
    if(at<s.items.length||s.done) return {[kind]:s.items.slice(at,at+20),more:at+20<s.items.length||!s.done};
    const root=await this._api(ctx,'search/'+KINDS[kind],{q:query,cursor:s.cursor,search_method:'input'});
    const g=list(root.result_groups).find(x=>x.id===kind);if(!g)throw fault('response');const raw=list(g.data);const mapped=unique(raw.map(x=>MAPPERS[kind](x,this.accountId)));
    const fresh=mapped.filter(x=>!s.items.some(y=>y.id===x.id));const next=nextPage(g,raw.length,s.items.length+raw.length,s.cursors);
    if(next!==null&&!fresh.length)throw pagination();if(s.items.length+fresh.length>5000)throw pagination();
    s.items.push(...fresh);s.done=next===null;if(next!==null){s.cursor=next;s.cursors.add(next);}
   }
   if(at<s.items.length||s.done)return {[kind]:s.items.slice(at,at+20),more:at+20<s.items.length||!s.done};throw pagination();
  });
 }
 async _own(ctx) {return (await this._all(ctx,'user/playlist','playlists',{user_id:this.accountId})).items;}
 async _mixed(ctx) {return (await this._all(ctx,'me/collection/mixed','mixed_collections')).items;}
 async _playlists(ctx) {
  const own=await this._own(ctx), mixed=await this._mixed(ctx);const result=new Map();
  for(const item of mixed)if(item.item_type==='playlist'){const p=mapPlaylist(item.playlist,this.accountId);p.saved=true;result.set(p.id,p);}
  for(const item of own){const p=mapPlaylist(item,this.accountId);if(p.mine||!result.has(p.id))result.set(p.id,p);}return [...result.values()];
 }
 playlists() {return this._run(ctx=>this._playlists(ctx));}
 async _playlist(ctx,value) {
  const {items,root}=await this._all(ctx,'playlist/detail',['media_resources','media'],{playlist_id:value},mapTrack);
  const meta=root.playlist??root.playlist_info;if(!meta)throw fault('response');const p=mapPlaylist(meta,this.accountId);if(p.id!==value)throw fault('response');return {...p,tracks:unique(items)};
 }
 playlist({id:value}={}) {return this._run(ctx=>this._playlist(ctx,id(value)));}
 async _likes(ctx) {
  if(this.likes&&this.now()-this.likes.time<30000)return this.likes.tracks;
  const own=await this._own(ctx);const candidates=own.filter(p=>p.owner?.id===this.accountId);
  const p=candidates.find(x=>x.type===1)??candidates.find(x=>/^(我喜欢|Liked)$/i.test(x.title||x.public_title||''));
  if(!p)throw pagination();const tracks=(await this._playlist(ctx,id(p.id))).tracks;this.likes={time:this.now(),tracks};return tracks;
 }
 liked({offset:at=0}={}) {return this._run(async ctx=>{offset(at);const tracks=await this._likes(ctx);return {tracks:tracks.slice(at,at+100),more:at+100<tracks.length};});}
 isLiked({ids}={}) {return this._run(async ctx=>{if(!Array.isArray(ids)||ids.length>500)throw fault('protocol');ids.forEach(id);const set=new Set((await this._likes(ctx)).map(x=>x.id));return Object.fromEntries(ids.map(x=>[x,set.has(x)]));});}
 savedAlbums({offset:at=0}={}) {return this._run(async ctx=>{offset(at);const albums=unique((await this._mixed(ctx)).filter(x=>x.item_type==='album').map(x=>({...mapAlbum(x.album),saved:true})));return {albums:albums.slice(at,at+100),more:at+100<albums.length};});}
 async _recent(ctx) {return unique((await this._all(ctx,'me/recently-played-media','media',{media_type:'track',scene:''},mapTrack)).items);}
 recent() {return this._run(ctx=>this._recent(ctx));}
 async _stations(ctx) {
  const root=await this._api(ctx,'feed/mode',{},{});const modes=list(root.feed_mode_block).flatMap(x=>list(x.feed_mode));modes.push(...list(root.feed_mode_bar?.feed_mode));
  const result=[{id:'default',name:'推荐'},{id:'familiar',name:'熟悉'},{id:'fresh',name:'新鲜'}];
  for(const mode of modes){const v=mode.entity?.feed_scene_mode?.scene_mode_id;if(Number.isSafeInteger(v)&&v>0)result.push({id:'scene:'+v,name:text(mode.text),imageUrl:image(mode.url_info)});}
  this.modes=new Set(result.map(x=>x.id));return unique(result);
 }
 stations() {return this._run(ctx=>this._stations(ctx));}
 async _feed(ctx,value) {
  if(!['default','familiar','fresh'].includes(value)) {if(!/^scene:[1-9]\d{0,14}$/.test(value))throw fault('protocol');if(!this.modes)await this._stations(ctx);if(!this.modes.has(value))throw fault('protocol');}
  let s=this.feeds.get(value);if(!s){s={pages:0,played:[],seen:new Set(),done:false};this.feeds.set(value,s);while(this.feeds.size>16)this.feeds.delete(this.feeds.keys().next().value);}
  const tracks=[];
  for(let n=0;n<2&&!s.done&&!tracks.length;n++){
   const body={is_first_request:s.pages===0,played_media:s.played.slice(-30),is_did_first_request:false,feed_counts:{mix_session_count:1}};
   if(value==='familiar'||value==='fresh')body.feed_preference={preference_mode:value};else if(value.startsWith('scene:'))body.feed_preference={scene_mode_id:Number(value.slice(6))};
   const root=await this._api(ctx,'feed/song-tab',{},body);const raw=list(Object.hasOwn(root,'media')?root.media:root.items);if(root.has_more!==undefined&&typeof root.has_more!=='boolean')throw fault('response');
   const mapped=unique(raw.map(mapTrack));s.pages++;
   if(!raw.length&&root.has_more===true)throw pagination();
   s.done=root.has_more===false||raw.length===0;
   for(const t of mapped)if(!s.seen.has(t.id)){tracks.push(t);s.seen.add(t.id);s.played.push({id:t.id,type:'track'});while(s.seen.size>1000)s.seen.delete(s.seen.values().next().value);}
   s.played=s.played.slice(-30);
  }return {tracks,more:!s.done};
 }
 stationNext({id:value}={}) {return this._run(async ctx=>{if(typeof value!=='string')throw fault('protocol');return (await this._feed(ctx,value)).tracks;});}
 async _discover(ctx,charts) {
  // The new-discovery flag suppresses chart blocks; both routes need the mixed response.
  const root=await this._api(ctx,'discover',{},{});const sections=[];let visited=0;
  for(const block of list(root.blocks))for(const inner of list(block.inner_block)){
   this._check(ctx);if(++visited>5000)throw pagination();
   const section={title:text(inner.title||block.title),tracks:[],albums:[],artists:[],playlists:[]};
   for(const resource of list(inner.resources)){if(++visited>5000)throw pagination();const e=resource.entity??resource;
    if(e.ranked_track?.track)section.tracks.push(mapTrack(e.ranked_track.track));
    else if(!charts)for(const [plural,singular]of Object.entries(KINDS))if(e[singular])section[plural].push(MAPPERS[plural](e[singular],this.accountId));
   }if(Object.keys(KINDS).some(k=>section[k].length))sections.push(section);
  }return {title:charts?'榜单':'发现',sections};
 }
 async _browse(ctx,page) {
  if(page==='discover'||page==='charts')return this._discover(ctx,page==='charts');
  if(page==='history')return {title:'最近播放',sections:[{tracks:await this._recent(ctx)}]};
  if(page==='library')return {title:'我的歌单',sections:[{playlists:await this._playlists(ctx)}]};
  if(page==='home'||page==='feed:default'){const p=await this._feed(ctx,'default');return {title:'推荐',sections:[{tracks:p.tracks,...(p.more?{morePage:'feed:default'}:{})}]};}
  throw fault('protocol');
 }
 home() {return this._run(ctx=>this._browse(ctx,'home'));}
 browse({page}={}) {return this._run(ctx=>this._browse(ctx,page));}
}
module.exports={Catalog,mapTrack,mapAlbum,mapArtist,mapPlaylist};
