'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Community,parseLyrics}=require('../helper/community.cjs');
test('LRC, translation, plain text, absent lyrics and bounded parsing',()=>{
  assert.deepEqual(parseLyrics({content:'[00:01.20]Hello',translations:{cn:'[00:01.20]你好'}}),{lrc:'[00:01.20]Hello',translation:'[00:01.20]你好'});
  assert.deepEqual(parseLyrics(null),{});
  assert.deepEqual(parseLyrics({content:'plain <b>text</b>'}),{lrc:'plain <b>text</b>'});
  for(const content of ['x'.repeat(1048577),'x\n'.repeat(10001)]) assert.throws(()=>parseLyrics({content}),{code:'limit'});
});
test('enhanced relative and absolute words use milliseconds',()=>{
  for(const content of ['[1000,500]<0,200,0>Hi<200,300,0> there','[1000,500](1000,200,0)Hi(1200,300,0) there']) {
    assert.deepEqual(parseLyrics({content}).lines,[{start:1000,end:1500,text:'Hi there',words:[{start:1000,end:1200,text:'Hi'},{start:1200,end:1500,text:' there'}]}]);
  }
  for(const content of ['[-1,2]<0,1,0>x','[1,2]<0,-1,0>x','[1,2]<0,9,0>x','[999999999999999999,2]x','[00:99.00]x']) assert.throws(()=>parseLyrics({content}),{code:'response'});
});
test('lyrics use only established track metadata request',async()=>{
  const c=new Community({api:async(...args)=>{assert.deepEqual(args,['/luna/pc/track_v2',{}, {track_id:'t',media_type:'track',queue_type:'favorite_track_playlist',scene_name:'library'}]);return {lyric:{content:'hello'}};}});
  assert.deepEqual(await c.lyrics({id:'t'}),{lrc:'hello'});
});
const row=(id)=>({id,content:'Hello',count_digged:2,time_created:123,user:{nickname:'Reader',medium_avatar_url:'avatar'}});
test('comments map DTO, opaque cursors, explicit end, independent tracks and clear',async()=>{
  const calls=[];const c=new Community({api:async(p,q)=>{calls.push([p,q]);return q.cursor===''?{comments:[row('c1')],count:'2',cursor:'opaque',has_more:true}:{comments:[{...row('c2'),liked:false}],count:'2',cursor:'still-present',has_more:false};}});
  assert.deepEqual(await c.comments({trackId:'t',offset:0}),{comments:[{id:'c1',author:'Reader',avatarUrl:'avatar',text:'Hello',time:123000,likes:2}],total:2,more:true});
  assert.equal((await c.comments({trackId:'t',offset:1})).more,false);
  assert.equal(calls[1][1].cursor,'opaque');
  assert.deepEqual(calls[0],['/luna/pc/comments',{group_id:'t',group_type:0,cursor:'',count:20}]);
  await c.comments({trackId:'other',offset:0}); c.clear(); await c.comments({trackId:'t',offset:0});
  assert.equal(calls.length,4);
});
test('missing fields and invalid pagination fail instead of fake empty page',async()=>{
  for(const reply of [{},{comments:[]},{comments:[{}],count:'1',has_more:false},{comments:[],count:'1',cursor:'next',has_more:true},{comments:[row('x')],count:'2',has_more:true}]) {
    const c=new Community({api:async()=>reply}); await assert.rejects(c.comments({trackId:'t',offset:0}));
  }
  let n=0;const c=new Community({api:async()=>{n++;return {comments:[row(String(n))],count:'99',cursor:'same',has_more:true};}});
  await assert.rejects(c.comments({trackId:'t',offset:3}),{code:'pagination'});assert.equal(n,2);
  let m=0; const bounded=new Community({api:async()=>({comments:[row(String(++m))],count:'99',cursor:String(m),has_more:true})});
  await assert.rejects(bounded.comments({trackId:'t',offset:20}),{code:'pagination'});assert.equal(m,8);
});
test('post requires id, exact payload, sanitizes uncertain writes and clears pagination',async()=>{
  for(const reply of [{},null,{comment:{id:''}}]) {
    let n=0;const c=new Community({api:async(...args)=>{n++;assert.deepEqual(args,['/luna/pc/comments/create',{}, {group_id:'t',text:'hello',group_type:0}]);return reply;}});
    await assert.rejects(c.postComment({trackId:'t',text:'hello'}),{code:'mutation-unknown'});assert.equal(n,1);
  }
  const c=new Community({api:async()=>({comment:row('new')})});assert.equal((await c.postComment({trackId:'t',text:'hello'})).id,'new');
  const bad=new Community({api:async()=>{throw Error('Cookie private');}});await assert.rejects(bad.postComment({trackId:'t',text:'hello'}),e=>e.code==='mutation-unknown'&&!e.message.includes('private'));
});
test('word/UTF8 bounds and invalid timing are enforced',()=>{
  assert.throws(()=>parseLyrics({content:'[0,30000]'+ '<0,1,0>x'.repeat(20001)}),{code:'limit'});
  assert.throws(()=>parseLyrics({content:'你'.repeat(400000)}),{code:'limit'});
  assert.throws(()=>parseLyrics({content:'[100,100](90,10,0)x'}),{code:'response'});
});
test('comments reject duplicate ids, obey elapsed budget and validate offset',async()=>{
  const c=new Community({api:async()=>({comments:[row('x'),row('x')],count:'2',has_more:false})});
  await assert.rejects(c.comments({trackId:'t'}),{code:'pagination'});
  await assert.rejects(c.comments({trackId:'t',offset:-1}),{code:'input'});
  let clock=0;const timed=new Community({now:()=>clock,api:async()=>{clock=26000;return {comments:[],count:'0',has_more:false};}});
  await assert.rejects(timed.comments({trackId:'t'}),{code:'pagination'});
});
test('post invalidates cached pages on success and uncertainty',async()=>{
  for(const fail of [true,false]) {
    let reads=0;const c=new Community({api:async(path)=>{
      if(path.endsWith('/create')) {if(fail)throw Error('timeout');return {comment:row('new')};}
      reads++;return {comments:[row('c')],count:'1',has_more:false};
    }});
    await c.comments({trackId:'t'});
    if(fail)await assert.rejects(c.postComment({trackId:'t',text:'x'}),{code:'mutation-unknown'});else await c.postComment({trackId:'t',text:'x'});
    await c.comments({trackId:'t'});assert.equal(reads,2);
  }
});
