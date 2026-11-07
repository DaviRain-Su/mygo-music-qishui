'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { Catalog } = require('./catalog.cjs');
const { Community } = require('./community.cjs');
const { Actions } = require('./actions.cjs');
const { fault } = require('./protocol.cjs');
const featureContext = new AsyncLocalStorage();
const WRITES = new Set(['postComment','like','savePlaylist','saveAlbum','createPlaylist','renamePlaylist','deletePlaylist','addToPlaylist','removeFromPlaylist','played']);
// Explicit closures, never dispatch through a client-supplied property name.
const METHODS = new Map([
 ['home',(s,a)=>s.catalog.home(a)], ['browse',(s,a)=>s.catalog.browse(a)],
 ['search',(s,a)=>s.catalog.search(a)], ['playlists',(s,a)=>s.catalog.playlists(a)],
 ['playlist',(s,a)=>s.catalog.playlist(a)], ['liked',(s,a)=>s.catalog.liked(a)],
 ['isLiked',(s,a)=>s.catalog.isLiked(a)], ['savedAlbums',(s,a)=>s.catalog.savedAlbums(a)],
 ['recent',(s,a)=>s.catalog.recent(a)], ['stations',(s,a)=>s.catalog.stations(a)],
 ['stationNext',(s,a)=>s.catalog.stationNext(a)], ['lyrics',(s,a)=>s.community.lyrics(a)],
 ['comments',(s,a)=>s.community.comments(a)],
 ['postComment',async(s,a)=>{
   const comment=await s.community.postComment(a);
   const account=featureContext.getStore()?.account;
   if(comment&&typeof comment==='object'){
    if(!comment.author&&typeof account?.name==='string')comment.author=account.name;
    if(!comment.avatarUrl&&typeof account?.imageUrl==='string'&&/^https:\/\//.test(account.imageUrl))comment.avatarUrl=account.imageUrl;
   }
   return comment;
 }],
 ['like',(s,a)=>s.actions.like(a)], ['savePlaylist',(s,a)=>s.actions.savePlaylist(a)],
 ['saveAlbum',(s,a)=>s.actions.saveAlbum(a)], ['createPlaylist',async(s,a)=>({...await s.actions.createPlaylist(a),mine:true})],
 ['renamePlaylist',(s,a)=>s.actions.renamePlaylist(a)], ['deletePlaylist',(s,a)=>s.actions.deletePlaylist(a)],
 ['addToPlaylist',(s,a)=>s.actions.addToPlaylist(a)], ['removeFromPlaylist',(s,a)=>s.actions.removeFromPlaylist(a)],
 ['played',(s,a)=>s.actions.played(a)],
]);
function check(ctx) { if (ctx.signal.aborted) throw ctx.signal.reason; }
// Check before starting work and after settlement, even if the transport ignores abort.
async function bounded(ctx, run) {
 check(ctx);let listener;
 try {
  const result = await Promise.race([Promise.resolve().then(()=>{check(ctx);return run();}),new Promise((_,reject)=>{
   listener=()=>reject(ctx.signal.reason);ctx.signal.addEventListener('abort',listener,{once:true});
  })]);check(ctx);return result;
 } finally {ctx.signal.removeEventListener('abort',listener);}
}
class Features {
 constructor({api,account}) {
  this.api=api;this.account=account;this.active=new Set();this.accountId=null;this.install();
 }
 install() {
  const api=(path,query,body)=>{
   const ctx=featureContext.getStore();
   return bounded(ctx,()=>{if(ctx.write)ctx.attempted=true;return this.api(path,query,body,ctx.signal);});
  };
  const catalog=new Catalog({api,account:async()=>{const ctx=featureContext.getStore();check(ctx);return ctx.account;}});
  this.catalog=catalog;this.community=new Community({api});
  this.actions=new Actions({api,invalidate:()=>catalog.invalidate()});
 }
 reset(except) {
  for(const ctx of this.active)if(ctx!==except)ctx.controller.abort(fault('account'));
  this.catalog.clear();this.community.clear();this.accountId=null;this.install();
 }
 async dispatch({method,args={}}={}) {
  if(!METHODS.has(method)||!args||typeof args!=='object'||Array.isArray(args))throw fault('protocol');
  const controller=new AbortController();const ctx={controller,signal:controller.signal,write:WRITES.has(method),attempted:false};
  this.active.add(ctx);
  const timer=setTimeout(()=>controller.abort(fault('timeout')),25000);
  return featureContext.run(ctx,async()=>{
   let modules;
   try {
    const account=await bounded(ctx,()=>this.account(ctx.signal));
    if(!account||typeof account.id!=='string'||!account.id)throw fault('account');
    if(this.accountId!==null&&this.accountId!==account.id)this.reset(ctx);
    this.accountId=account.id;ctx.account=account;
    modules={catalog:this.catalog,community:this.community,actions:this.actions};
    // Reads may wait in Catalog's queue. Mutations settle through their wrapped API
    // so Actions can preserve the count of confirmed preceding appends on abort.
    const result=ctx.write?await METHODS.get(method)(modules,args):await bounded(ctx,()=>METHODS.get(method)(modules,args));
    check(ctx);return result;
   } catch(error) {
    if(ctx.signal.aborted){
     modules?.catalog.clear();modules?.community.clear();
     if(ctx.write&&ctx.attempted)throw fault('mutation-unknown',{confirmed:error.confirmed});
     throw ctx.signal.reason;
    }
    throw error;
   } finally {clearTimeout(timer);this.active.delete(ctx);}
  });
 }
}
module.exports={Features,featureContext};
