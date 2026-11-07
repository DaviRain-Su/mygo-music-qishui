'use strict';
const {mutate,error,object,id,text}=require('./actions.cjs');
const MAX_BYTES=1024*1024, MAX_LINES=10000, MAX_WORDS=20000;
function bounded(value) {if(typeof value!=='string')throw error('response');if(value.length>MAX_BYTES||Buffer.byteLength(value)>MAX_BYTES)throw error('limit');if(value.split('\n').length>MAX_LINES)throw error('limit');return value;}
function time(value) {if(!Number.isSafeInteger(value)||value<0)throw error('response');return value;}
// Excluding both bracket characters prevents overlapping suffix scans on malformed input.
function lrcTags(source) {
  const tags=[];
  for(const tag of source.matchAll(/\[([^\[\]]*)\]/g)) {
    if(!/^-?\d/.test(tag[1])||!tag[1].includes(':'))continue;
    const m=/^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(tag[1]);
    if(!m)throw error('response');
    tags.push({start:time(Number(m[1])*60000+Number(m[2])*1000+Number((m[3]||'').padEnd(3,'0'))),end:tag.index+tag[0].length});
  }
  return tags;
}
function alignTranslations(lines,translation) {
  // Match MyGo's nearest-time rule without a lines-by-translations nested scan.
  const sorted=[...lines].sort((a,b)=>a.start-b.start);
  const unique=sorted.filter((line,i)=>i===0||line.start!==sorted[i-1].start);
  const translations=[];
  for(const source of translation.split(/\r?\n/)) {
    const tags=lrcTags(source);if(!tags.length)continue;
    const value=source.slice(tags.at(-1).end).trim();if(!value)continue;
    for(const tag of tags)translations.push({start:tag.start,value});
  }
  // MyGo sorts parsed translations stably before assigning competing entries.
  translations.sort((a,b)=>a.start-b.start);
  for(const tag of translations) {
      let lo=0,hi=unique.length;
      while(lo<hi) {const mid=(lo+hi)>>>1;if(unique[mid].start<tag.start)lo=mid+1;else hi=mid;}
      let best,gap=1500;
      for(const candidate of [unique[lo-1],unique[lo]]) {
        if(candidate&&Math.abs(candidate.start-tag.start)<gap) {best=candidate;gap=Math.abs(candidate.start-tag.start);}
      }
      if(best&&best.translation===undefined)best.translation=tag.value;
  }
}
function parseLyrics(lyric) {
  if(lyric==null)return {};if(!object(lyric))throw error('response');
  const content=bounded(lyric.content??'');const translation=bounded(lyric.translations?.cn??'');
  const out={};if(content)out.lrc=content;if(translation)out.translation=translation;
  const lines=[];let wordCount=0;
  for(const source of content.split(/\r?\n/)) {
    if(/^\[[^\]]*,/.test(source)) {
      const header=/^\[(\d+),(\d+)\]/.exec(source);if(!header)throw error('response');
      const start=time(Number(header[1])),end=time(start+time(Number(header[2]))),body=source.slice(header[0].length),words=[];
      const token=/(?:<(\d+),(\d+),\d+>|\((\d+),(\d+),\d+\))([^<(]*)/g;let match,pos=0;
      while((match=token.exec(body))) {
        if(match.index!==pos)throw error('response');pos=token.lastIndex;
        if(++wordCount>MAX_WORDS)throw error('limit');
        const ws=time(match[1]!==undefined?start+Number(match[1]):Number(match[3])),we=time(ws+Number(match[2]??match[4]));
        if(ws<start||we>end||(words.length&&ws<words.at(-1).start))throw error('response');
        words.push({start:ws,end:we,text:match[5]});
      }
      if(!words.length||pos!==body.length)throw error('response');
      lines.push({start,end,text:words.map(w=>w.text).join(''),words});
    } else {
      // Preserve ordinary LRC, but reject invalid numeric timestamp syntax.
      lrcTags(source);
    }
  }
  if(lines.length) {alignTranslations(lines,translation);out.lines=lines;}
  return out;
}
function number(v) {if(typeof v==='string'&&!/^\d+$/.test(v))throw error('response');if(!['string','number'].includes(typeof v))throw error('response');return time(Number(v));}
function mapComment(raw) {
  if(!object(raw))throw error('response');try{id(raw.id);}catch{throw error('response');}
  if(typeof raw.content!=='string')throw error('response');bounded(raw.content);
  const out={id:raw.id,author:typeof raw.user?.nickname==='string'?raw.user.nickname:'',text:raw.content};
  const avatar=raw.user?.medium_avatar_url;
  // Retain the legacy string shape; observed object responses contain URL candidates.
  if(typeof avatar==='string')out.avatarUrl=avatar;
  else if(Array.isArray(avatar?.urls)) {
    const url=avatar.urls.find(value=>{
      if(typeof value!=='string')return false;
      try {return ['http:','https:'].includes(new URL(value).protocol);}catch{return false;}
    });
    if(url)out.avatarUrl=url;
  }
  if(raw.time_created!==undefined)out.time=time(number(raw.time_created)*1000);
  if(raw.count_digged!==undefined)out.likes=number(raw.count_digged);
  if(typeof raw.liked==='boolean')out.liked=raw.liked;
  return out;
}
class Community {
  constructor({api,now=Date.now}={}) {if(typeof api!=='function'||typeof now!=='function')throw error('input');this.api=api;this.now=now;this.clear();}
  clear() {this.sessions=new Map();}
  async lyrics({id:value}={}) {id(value);const v=await this.api('/luna/pc/track_v2',{}, {track_id:value,media_type:'track',queue_type:'favorite_track_playlist',scene_name:'library'});if(!object(v))throw error('response');return parseLyrics(v.lyric??v.data?.lyric);}
  async comments({trackId,offset=0}={}) {
    id(trackId);if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw error('input');
    let session=this.sessions.get(trackId);
    if(!session) {if(this.sessions.size>=32)this.sessions.delete(this.sessions.keys().next().value);session={pages:new Map(),cursor:'',next:0,seen:new Set(['']),ids:new Set(),done:false};this.sessions.set(trackId,session);}
    if(session.busy)throw error('pagination');session.busy=true;
    const started=this.now();
    try {
      for(let request=0;request<8;request++) {
        if(session.pages.has(offset))return structuredClone(session.pages.get(offset));
        if(session.done||offset<session.next||session.next>=10000||this.now()-started>25000)throw error('pagination');
        const v=await this.api('/luna/pc/comments',{group_id:trackId,group_type:0,cursor:session.cursor,count:20});
        if(this.now()-started>25000)throw error('pagination');
        if(!object(v)||(v.has_more!==undefined&&typeof v.has_more!=='boolean'))throw error('response');
        const more=v.has_more===true,total=number(v.count);
        // Runtime validates API success; count supplies required page metadata.
        // Protobuf may omit an empty terminal list, but never a more-page list.
        const raw=v.comments===undefined&&!more?[]:v.comments;
        if(!Array.isArray(raw))throw error('response');
        if(raw.length>100)throw error('limit');
        const comments=raw.map(mapComment),unique=new Set();
        for(const c of comments) {if(unique.has(c.id)||session.ids.has(c.id))throw error('pagination');unique.add(c.id);}
        if(more&&(!comments.length||typeof v.cursor!=='string'||!v.cursor||v.cursor.length>4096||session.seen.has(v.cursor)))throw error('pagination');
        const page={comments,total,more};session.pages.set(session.next,page);
        if(session.pages.size>50)session.pages.delete(session.pages.keys().next().value);
        for(const value of unique)session.ids.add(value);
        const at=session.next;session.next+=comments.length;session.done=!more;
        if(more){session.cursor=v.cursor;session.seen.add(v.cursor);}
        if(at===offset)return structuredClone(page);
      }
      throw error('pagination');
    } finally {session.busy=false;}
  }
  async postComment({trackId,text:value}={}) {
    id(trackId);text(value,5000);
    return mutate(this.api,'/luna/pc/comments/create',{group_id:trackId,text:value,group_type:0},()=>this.sessions.delete(trackId),'comments',v=>{
      const raw=v.comment||v.data?.comment||v.comments?.[0]||v.data||v;
      return mapComment(raw);
    });
  }
}
module.exports={Community,parseLyrics,mapComment};
