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

test('malformed bracket runs finish within a bounded subprocess deadline',()=>{
  const {spawnSync}=require('node:child_process');
  const result=spawnSync(process.execPath,['-e',`
    const {parseLyrics}=require('./helper/community.cjs');
    for(const content of ['[1'.repeat(200000), '[1'.repeat(200000)+':00]', '[1:'.repeat(150000)]) {
      parseLyrics({content});
    }
  `],{cwd:require('node:path').resolve(__dirname,'..'),timeout:2000,encoding:'utf8'});
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr);
});
test('enhanced translations reach structured lines using timestamp alignment',()=>{
  const content='[1000,500]<0,500,0>One\n[3000,500](3000,500,0)Two\n[6000,500]<0,500,0>Three';
  const translation='[00:03.10]二\n[00:01.00]一\n[00:20.00]unmatched';
  const parsed=parseLyrics({content,translations:{cn:translation}});
  assert.equal(parsed.translation,translation);
  assert.deepEqual(parsed.lines.map(l=>l.translation),['一','二',undefined]);
  assert.deepEqual(parseLyrics({content,translations:{cn:'[00:01.00][00:03.00]重复'}}).lines.map(l=>l.translation),['重复','重复',undefined]);
  assert.equal(parseLyrics({content,translations:{cn:'untimed'}}).lines[0].translation,undefined);
  assert.deepEqual(parseLyrics({content,translations:{cn:'[00:02.00]tie\n[00:04.50]too far'}}).lines.map(l=>l.translation),['tie',undefined,undefined]);
});
test('comments extract HTTP avatar URLs from object urls without treating uri as a URL',()=>{
  const {mapComment}=require('../helper/community.cjs');
  const mapped=avatar=>mapComment({...row('x'),user:{medium_avatar_url:avatar}});
  assert.equal(mapped({uri:'asset/key',urls:['invalid','javascript:alert(1)','https://example.test/avatar']}).avatarUrl,'https://example.test/avatar');
  assert.equal(mapped('https://example.test/legacy').avatarUrl,'https://example.test/legacy');
  for(const avatar of [{uri:'asset/key',urls:[]},{urls:[null,{}]},null]) assert.equal(mapped(avatar).avatarUrl,undefined);
});

test('omitted has_more terminates listed comments despite leftover cursor or total',async()=>{
  for(const cursor of [undefined,'leftover']) {
    let calls=0;
    const c=new Community({api:async()=>{calls++;return {comments:[row('last')],count:'99',cursor};}});
    const page=await c.comments({trackId:'t'});
    assert.equal(page.more,false);
    assert.equal(page.total,99);
    assert.equal(page.comments[0].id,'last');
    assert.deepEqual(await c.comments({trackId:'t'}),page);
    await assert.rejects(c.comments({trackId:'t',offset:1}),{code:'pagination'});
    assert.equal(calls,1);
  }
});
test('terminal protobuf empty comments require valid count metadata',async()=>{
  for(const has_more of [undefined,false]) {
    for(const metadata of [{count:'0'},{count:'9',status_info:{status_code:0}}]) {
      const c=new Community({api:async()=>({...metadata,has_more,cursor:'leftover'})});
      assert.deepEqual(await c.comments({trackId:'t'}),{comments:[],total:Number(metadata.count),more:false});
    }
  }
  for(const reply of [{},{status_info:{status_code:0}},{count:null},{count:'bad'},
    {count:'0',comments:null},{count:'0',comments:{}},{count:'0',has_more:true,cursor:'next'},
    ...[null,0,1,'false','true',{}].map(has_more=>({comments:[],count:'0',has_more}))]) {
    const c=new Community({api:async()=>reply});
    await assert.rejects(c.comments({trackId:'t'}),{code:'response'});
  }
});
test('omitted empty terminal page follows opaque cursor and cannot satisfy unknown offsets',async()=>{
  let calls=0;
  const c=new Community({api:async(_path,query)=>{
    calls++;
    if(calls===1)return {comments:[row('first')],count:'99',has_more:true,cursor:'opaque'};
    assert.equal(query.cursor,'opaque');
    return {count:'99',cursor:'opaque',status_info:{status_code:0}};
  }});
  assert.deepEqual(await c.comments({trackId:'t',offset:1}),{comments:[],total:99,more:false});
  await assert.rejects(c.comments({trackId:'t',offset:2}),{code:'pagination'});
  assert.equal(calls,2);
});
test('translation competitors are stably sorted by timestamp before nearest-line assignment',()=>{
  const content='[3000,500]<0,500,0>Line';
  for(const translation of [
    '[00:03.00]later\n[00:02.00]earlier\n[00:02.00]equal-time second',
    '[00:03.00][00:02.00]earlier\n[00:02.50]middle',
  ]) {
    const parsed=parseLyrics({content,translations:{cn:translation}});
    assert.equal(parsed.lines[0].translation,'earlier');
    assert.equal(parsed.translation,translation);
  }
  for(const [timestamp,expected] of [['00:01.500',undefined],['00:01.501','edge'],['00:04.499','edge'],['00:04.500',undefined]]) {
    assert.equal(parseLyrics({content,translations:{cn:`[${timestamp}]edge`}}).lines[0].translation,expected);
  }
  assert.equal(parseLyrics({content,translations:{cn:'[00:02.00]first\n[00:02.00]second'}}).lines[0].translation,'first');
});
