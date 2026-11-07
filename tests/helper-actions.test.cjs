'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Actions} = require('../helper/actions.cjs');

test('exact supported action payloads and invalidation', async () => {
  const calls = [], scopes = [];
  const a = new Actions({api: async (...args) => { calls.push(args); return {}; }, invalidate: s => scopes.push(s)});
  for (const on of [true, false]) {
    await a.like({id:'t',on}); await a.savePlaylist({id:'p',on}); await a.saveAlbum({id:'a',on});
  }
  await a.played({id:'t'});
  assert.deepEqual(calls, [
    ['/luna/pc/me/collection/media',{}, {media:[{type:'track',id:'t'}],scene:''}],
    ['/luna/pc/me/collection/playlist',{}, {playlist_ids:['p']}],
    ['/luna/pc/me/collection/album',{}, {album_ids:['a']}],
    ['/luna/pc/me/collection/media/delete',{}, {media:[{type:'track',id:'t'}],scene:''}],
    ['/luna/pc/me/collection/playlist/delete',{}, {playlist_ids:['p']}],
    ['/luna/pc/me/collection/album/delete',{}, {album_ids:['a']}],
    ['/luna/pc/me/recently-played-media',{}, {media:[{type:'track',id:'t'}]}],
  ]);
  assert.deepEqual(scopes,['liked','playlists','savedAlbums','liked','playlists','savedAlbums','recent']);
});
test('create requires real id; validates responses and never retries', async () => {
  for (const reply of [null, [], {}, {playlist:{id:''}}]) {
    let n=0, invalid=0;
    const a=new Actions({api:async()=>{n++;return reply;},invalidate:()=>invalid++});
    await assert.rejects(a.createPlaylist({name:'Example'}), {code:'mutation-unknown'});
    assert.equal(n,1); assert.equal(invalid,1);
  }
  const a=new Actions({api:async (...args)=>{assert.deepEqual(args,['/luna/pc/me/playlist',{}, {name:'Example'}]);return {playlist:{id:'p'}};},invalidate:()=>{}});
  assert.deepEqual(await a.createPlaylist({name:'Example'}),{id:'p',name:'Example'});
});
test('append partial success is bounded, sanitized and stops on uncertain result', async () => {
  let n=0, invalid=0;
  const a=new Actions({api:async (...args)=>{n++;assert.deepEqual(args,['/luna/pc/me/playlist/media/append',{}, {playlist_id:'p',media:[{id:['x','y'][n-1],type:'track'}]}]);if(n===2)throw new Error('Cookie secret URL');return {};},invalidate:()=>invalid++});
  await assert.rejects(a.addToPlaylist({playlistId:'p',ids:['x','y','z']}),e=> e.code==='mutation-unknown' && e.confirmed===1 && !/secret|Cookie|URL/.test(e.message));
  assert.equal(n,2); assert.equal(invalid,2);
});
test('invalid inputs cause zero requests; successful append reports confirmed count',async()=>{
  let n=0;const a=new Actions({api:async()=>{n++;return {};},invalidate:()=>{}});
  for (const args of [{id:'' ,on:true},{id:'https://bad',on:true},{id:'x',on:'false'}]) await assert.rejects(a.like(args),{code:'input'});
  await assert.rejects(a.addToPlaylist({playlistId:'p',ids:['ok','']}),{code:'input'});
  assert.equal(n,0);
  assert.deepEqual(await a.addToPlaylist({playlistId:'p',ids:['x','y']}),{confirmed:2});
});
test('rejected and malformed writes invalidate; invalidator cannot hide write outcome',async()=>{
  for(const reply of [null,[], 'ok']) {
    const a=new Actions({api:async()=>reply,invalidate:()=>{}});
    await assert.rejects(a.like({id:'t',on:true}),{code:'mutation-unknown'});
  }
  const a=new Actions({api:async()=>{throw Object.assign(new Error('private'),{code:'api'});},invalidate:()=>{throw Error('private cache');}});
  await assert.rejects(a.createPlaylist({name:'x'}), e=>e.code==='api' && !e.message.includes('private'));
});
test('network uncertainty is sanitized for every action and never retried',async()=>{
  for(const invoke of [a=>a.like({id:'t',on:true}),a=>a.savePlaylist({id:'p',on:false}),a=>a.saveAlbum({id:'a',on:true}),a=>a.played({id:'t'}),a=>a.createPlaylist({name:'x'})]) {
    let calls=0,invalid=0;const a=new Actions({api:async()=>{calls++;throw Object.assign(Error('private'),{code:'network'});},invalidate:async()=>{invalid++;}});
    await assert.rejects(invoke(a),e=>e.code==='mutation-unknown'&&!e.message.includes('private'));assert.equal(calls,1);assert.equal(invalid,1);
  }
});

test('append snapshots caller ids before awaiting the first request',async()=>{
  const ids=['first','second'];const sent=[];let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const a=new Actions({api:async(_path,_query,body)=>{sent.push(body.media[0].id);if(sent.length===1)await pending;return {};},invalidate:()=>{}});
  const result=a.addToPlaylist({playlistId:'p',ids});
  ids[1]='invalid/id';ids.push(...Array(101).fill('extra'));
  release();
  assert.deepEqual(await result,{confirmed:2});
  assert.deepEqual(sent,['first','second']);
});
test('append validates every snapshot entry and batch bounds before writes',async()=>{
  let calls=0;const a=new Actions({api:async()=>{calls++;return {};},invalidate:()=>{}});
  for(const ids of [[],Array(101).fill('x'),['valid',undefined],new Array(2)]) {
    await assert.rejects(a.addToPlaylist({playlistId:'p',ids}),{code:'input'});
  }
  assert.equal(calls,0);
});
