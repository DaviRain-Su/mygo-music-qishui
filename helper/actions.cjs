'use strict';
const MESSAGES = Object.freeze({input:'Invalid community/action input.',response:'Unrecognized community response.',limit:'Community data exceeds the processing limit.',pagination:'Comment pagination could not be completed.',api:'The service rejected this action.', 'mutation-unknown':'The action may have completed. Its result is unknown; check the current state before trying again.', 'cache':'The action completed, but cached state could not be invalidated.'});
function error(code, confirmed) { const e=new Error(MESSAGES[code]);e.code=code;if(confirmed!==undefined)e.confirmed=confirmed;return e; }
function object(v) {return v!==null && typeof v==='object' && !Array.isArray(v);}
function id(v) {if(typeof v!=='string'|| !/^[A-Za-z0-9_-]{1,256}$/.test(v))throw error('input');return v;}
function text(v,max) {if(typeof v!=='string'||!v.trim()||v.length>max)throw error('input');return v;}
// API status is checked by Runtime.api. Never include upstream error messages.
async function mutate(api,path,body,invalidate,scope,validate=v=>v,confirmed) {
  let result, failure;
  try {const value=await api(path,{},body);if(!object(value))throw error('mutation-unknown');result=validate(value);}
  catch(e) {failure=error(e?.code==='api'?'api':'mutation-unknown',confirmed);}
  try {await invalidate(scope);} catch {if(!failure)failure=error('cache',confirmed);}
  if(failure)throw failure;return result;
}
class Actions {
  constructor({api,invalidate,account}={}) {if(typeof api!=='function'||typeof invalidate!=='function')throw error('input');this.api=api;this.invalidate=invalidate;/* account intentionally never read */}
  async like({id: value,on}={}) {id(value);if(typeof on!=='boolean')throw error('input');await mutate(this.api,'/luna/pc/me/collection/media'+(on?'':'/delete'),{media:[{type:'track',id:value}],scene:''},this.invalidate,'liked');return {ok:true};}
  async savePlaylist({id: value,on}={}) {return this.collection('playlist',value,on,'playlists');}
  async saveAlbum({id: value,on}={}) {return this.collection('album',value,on,'savedAlbums');}
  async collection(kind,value,on,scope) {if(!['playlist','album'].includes(kind))throw error('input');id(value);if(typeof on!=='boolean')throw error('input');await mutate(this.api,'/luna/pc/me/collection/'+kind+(on?'':'/delete'),{[kind+'_ids']:[value]},this.invalidate,scope);return {ok:true};}
  async createPlaylist({name}={}) {text(name,200);return mutate(this.api,'/luna/pc/me/playlist',{name},this.invalidate,'playlists',v=>{const p=v.playlist||v.data?.playlist;if(!object(p))throw error('mutation-unknown');id(p.id);return {id:p.id,name};});}
  async renamePlaylist({id:value,name}={}) {
    id(value);const next=text(name,200);
    await mutate(this.api,'/luna/pc/me/playlist/update',{playlist_id:value,name:next},this.invalidate,'playlists',v=>{
      if(!object(v)||(v.playlist_id!==undefined&&v.playlist_id!==value))throw error('mutation-unknown');
      return v;
    });
    return {ok:true};
  }
  async deletePlaylist({id:value}={}) {
    id(value);
    await mutate(this.api,'/luna/pc/me/playlist/delete',{playlist_ids:[value]},this.invalidate,'playlists');
    return {ok:true};
  }
  async addToPlaylist({playlistId,ids}={}) {
    id(playlistId);if(!Array.isArray(ids)||!ids.length||ids.length>100)throw error('input');
    const batch=Array.from({length:ids.length},(_,i)=>id(ids[i]));
    let confirmed=0;
    for(const value of batch) {await mutate(this.api,'/luna/pc/me/playlist/media/append',{playlist_id:playlistId,media:[{id:value,type:'track'}]},this.invalidate,'playlists',v=>v,confirmed);confirmed++;}
    return {confirmed};
  }
  async removeFromPlaylist({playlistId,ids}={}) {
    id(playlistId);if(!Array.isArray(ids)||!ids.length||ids.length>100)throw error('input');
    const batch=Array.from({length:ids.length},(_,i)=>id(ids[i]));
    let confirmed=0;
    for(const value of batch) {await mutate(this.api,'/luna/pc/me/playlist/media/delete',{playlist_id:playlistId,media:[{id:value,type:'track'}]},this.invalidate,'playlists',v=>v,confirmed);confirmed++;}
    return {confirmed};
  }
  async played({id:value}={}) {id(value);await mutate(this.api,'/luna/pc/me/recently-played-media',{media:[{type:'track',id:value}]},this.invalidate,'recent');return {ok:true};}
}
module.exports={Actions,mutate,error,object,id,text};
