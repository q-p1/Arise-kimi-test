'use strict';

const AP810_BUILD='AP-810';
const AP810_META_ENDPOINT='https://arise-snowy-beta.vercel.app/api/track-meta';
let ap810SourceGeneration=0;

function ap810Delay(ms){return new Promise(r=>setTimeout(r,ms))}
function ap810Canonical(v){let t=clean(v),prev='';const re=/\s*(?:[\[(]\s*)?(?:(?:official|original)\s+)?(?:(?:music|lyric)\s+)?(?:video|audio|visuali[sz]er|lyrics?|mv|hd|4k|topic)(?:\s*[\])])?\s*$/i;while(t&&t!==prev){prev=t;t=t.replace(re,'').trim()}return t||clean(v)}

function ap810U32(b,p){return((b[p]<<24)>>>0)|(b[p+1]<<16)|(b[p+2]<<8)|b[p+3]}
function ap810SyncSafe(a,b,c,d){return((a&127)<<21)|((b&127)<<14)|((c&127)<<7)|(d&127)}
function ap810Decode(b,e=3){try{if(e===0)return clean(new TextDecoder('windows-1252').decode(b));if(e===3)return clean(new TextDecoder('utf-8').decode(b));if(e===2){const s=new Uint8Array(b.length);for(let i=0;i+1<b.length;i+=2){s[i]=b[i+1];s[i+1]=b[i]}return clean(new TextDecoder('utf-16le').decode(s))}return clean(new TextDecoder('utf-16').decode(b))}catch{return clean(new TextDecoder().decode(b))}}
function ap810NullEnd(b,s,e){const step=(e===1||e===2)?2:1;for(let i=s;i+step-1<b.length;i+=step){if(step===1&&b[i]===0)return i;if(step===2&&b[i]===0&&b[i+1]===0)return i}return b.length}
function ap810DataURL(b,m='image/jpeg'){let x='';for(let i=0;i<b.length;i+=0x8000)x+=String.fromCharCode(...b.subarray(i,i+0x8000));return`data:${m};base64,${btoa(x)}`}

async function ap810ID3(file){
  const h=new Uint8Array(await file.slice(0,10).arrayBuffer());
  if(h.length<10||String.fromCharCode(...h.slice(0,3))!=='ID3')return{};
  const ver=h[3],sz=ap810SyncSafe(h[6],h[7],h[8],h[9]);
  const b=new Uint8Array(await file.slice(0,Math.min(file.size,10+sz)).arrayBuffer()),out={};
  let p=10;
  while(p+6<b.length){
    let id='',s=0,hd=10;
    if(ver===2){id=String.fromCharCode(...b.slice(p,p+3));s=(b[p+3]<<16)|(b[p+4]<<8)|b[p+5];hd=6}
    else{id=String.fromCharCode(...b.slice(p,p+4));s=ver===4?ap810SyncSafe(b[p+4],b[p+5],b[p+6],b[p+7]):((b[p+4]<<24)>>>0)|(b[p+5]<<16)|(b[p+6]<<8)|b[p+7]}
    if(!id.trim()||s<=0||p+hd+s>b.length)break;
    const body=b.slice(p+hd,p+hd+s);
    if(['TIT2','TT2'].includes(id)&&body.length>1)out.title=ap810Decode(body.slice(1),body[0]);
    if(['TPE1','TP1'].includes(id)&&body.length>1)out.artist=ap810Decode(body.slice(1),body[0]);
    if(['TALB','TAL'].includes(id)&&body.length>1)out.album=ap810Decode(body.slice(1),body[0]);
    if((id==='APIC'||id==='PIC')&&body.length>6&&!out.artworkData){
      const enc=body[0];let q=1,mime='image/jpeg';
      if(id==='PIC'){mime=String.fromCharCode(...body.slice(1,4)).toLowerCase()==='png'?'image/png':'image/jpeg';q=4}
      else{const end=body.indexOf(0,q);if(end>q)mime=ap810Decode(body.slice(q,end),3)||mime;q=end>=0?end+1:q}
      if(q<body.length)q++;
      const end=ap810NullEnd(body,q,enc);q=Math.min(body.length,end+((enc===1||enc===2)?2:1));
      const pic=body.slice(q);if(pic.length>20)out.artworkData=ap810DataURL(pic,mime);
    }
    p+=hd+s;
  }
  return out;
}

async function ap810MP4(file){
  if(file.size>160*1024*1024)return{};
  const b=new Uint8Array(await file.arrayBuffer()),out={},containers=new Set(['moov','udta','meta','ilst']);
  const type=p=>String.fromCharCode(b[p+4],b[p+5],b[p+6],b[p+7]);
  function walk(start,end,depth=0){
    if(depth>8)return;let p=start;
    while(p+8<=end){
      const z=ap810U32(b,p),t=type(p);if(z<8||p+z>end)break;const bs=p+8,be=p+z;
      if(['©nam','©ART','aART','©alb','covr'].includes(t)){
        let q=bs;
        while(q+16<=be){const cs=ap810U32(b,q),ct=type(q);if(cs<16||q+cs>be)break;if(ct==='data'){const v=b.slice(q+16,q+cs);if(t==='©nam')out.title=ap810Decode(v);if(t==='©ART'||t==='aART')out.artist=ap810Decode(v);if(t==='©alb')out.album=ap810Decode(v);if(t==='covr'&&!out.artworkData&&v.length>20)out.artworkData=ap810DataURL(v,v[0]===0x89&&v[1]===0x50?'image/png':'image/jpeg');break}q+=cs}
      }else if(containers.has(t))walk(bs+(t==='meta'?4:0),be,depth+1);
      p+=z;
    }
  }
  walk(0,b.length);return out;
}

async function ap810Embedded(blob,filename=''){
  try{
    const h=new Uint8Array(await blob.slice(0,12).arrayBuffer()),ext=(filename||'').split('.').pop().toLowerCase();
    if(String.fromCharCode(...h.slice(0,3))==='ID3')return await ap810ID3(blob);
    if(['m4a','mp4','m4b'].includes(ext)||String.fromCharCode(...h.slice(4,8))==='ftyp')return await ap810MP4(blob);
  }catch(e){console.debug('AP-810 metadata parse skipped',e)}
  return{};
}

function ap810WaitReady(gen,timeout=3200){
  if(gen!==ap810SourceGeneration)return Promise.resolve(false);
  if(audio.readyState>=2)return Promise.resolve(true);
  return new Promise(resolve=>{
    let done=false;
    const finish=ok=>{if(done)return;done=true;clearTimeout(timer);['loadeddata','canplay','canplaythrough','error'].forEach(n=>audio.removeEventListener(n,handlers[n]));resolve(ok&&gen===ap810SourceGeneration)};
    const handlers={loadeddata:()=>finish(true),canplay:()=>finish(true),canplaythrough:()=>finish(true),error:()=>finish(false)};
    Object.entries(handlers).forEach(([n,f])=>audio.addEventListener(n,f,{once:true}));
    const timer=setTimeout(()=>finish(audio.readyState>=1),timeout);
  });
}

async function ap810TryPlay(gen){
  for(let i=0;i<4;i++){
    if(gen!==ap810SourceGeneration)return false;
    try{await audio.play();return true}catch(e){console.debug(`AP-810 play retry ${i+1}`,e?.name||e);await ap810WaitReady(gen,900);await ap810Delay(90+80*i)}
  }
  return false;
}

playCurrent=async function({at=0,autoplay=true}={}){
  const t=state.current,b=bytesToBlob(t);
  if(!t||!b){toast('This file is unavailable');return false}
  const gen=++ap810SourceGeneration,oldUrl=state.url,newUrl=URL.createObjectURL(b);
  state.url=newUrl;
  try{
    audio.preload='auto';audio.defaultPlaybackRate=1;audio.playbackRate=1;audio.src=newUrl;
    syncMetadata();renderPlayer();saveSession(true);
    if(Number(at)>0){
      const seek=()=>{if(gen!==ap810SourceGeneration)return;const d=Number(audio.duration);if(Number.isFinite(d)&&d>0)audio.currentTime=Math.min(Number(at),Math.max(0,d-.05));syncPosition(true)};
      audio.addEventListener('loadedmetadata',seek,{once:true});
    }
    try{audio.load()}catch{}
    await ap810WaitReady(gen);
    if(gen!==ap810SourceGeneration){try{URL.revokeObjectURL(newUrl)}catch{}return false}
    const ok=autoplay?await ap810TryPlay(gen):true;
    if(oldUrl&&oldUrl!==newUrl)setTimeout(()=>{try{URL.revokeObjectURL(oldUrl)}catch{}},900);
    if(!ok){state.resumeAt=Number(at)||0;toast('Playback paused. Tap play to resume.');}
    return ok;
  }catch(e){
    console.error('AP-810 source transition failed',e);
    if(oldUrl&&oldUrl!==newUrl)try{URL.revokeObjectURL(oldUrl)}catch{}
    return false;
  }
};

nextTrack=async function(){
  if(state.transitioning)return;
  const n=nextItem();if(!n){audio.pause();return}
  state.transitioning=true;
  try{state.current=n;state.index=state.queue.findIndex(x=>x.id===n.id);state.resumeAt=0;await playCurrent({at:0,autoplay:true})}
  finally{state.transitioning=false}
};

previousTrack=async function(){
  if(state.transitioning)return;
  if(Number(audio.currentTime)>3.5){audio.currentTime=0;syncPosition(true);return}
  const p=prevItem();if(!p)return;
  state.transitioning=true;
  try{state.current=p;state.index=state.queue.findIndex(x=>x.id===p.id);state.resumeAt=0;await playCurrent({at:0,autoplay:true})}
  finally{state.transitioning=false}
};

syncMetadata=function(){
  if(!state.current||!('mediaSession'in navigator))return;
  try{
    const src=coverData(state.current),artwork=[{src,sizes:'600x600'}];
    navigator.mediaSession.metadata=new MediaMetadata({title:title(state.current),artist:artist(state.current),album:clean(state.current.album)||'Arise Player',artwork});
  }catch(e){console.debug('AP-810 media metadata skipped',e)}
};

async function ap810Catalog(t){
  if(!t)return false;
  try{
    const u=new URL(AP810_META_ENDPOINT),ttl=ap810Canonical(title(t));u.searchParams.set('title',ttl);
    if(artist(t)!=='Unknown Artist')u.searchParams.set('artist',artist(t));
    const d=Math.round((Number(t.duration)||0)*1000);if(d)u.searchParams.set('durationMs',String(d));
    const r=await fetch(u,{cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)return false;
    const j=await r.json();if(!j?.matched)return false;
    let changed=false;
    if(clean(j.title)&&clean(j.title)!==title(t)){t.title=clean(j.title);changed=true}
    if(clean(j.artist)&&clean(j.artist)!==artist(t)){t.artist=clean(j.artist);changed=true}
    if(clean(j.album)&&clean(j.album)!==clean(t.album)){t.album=clean(j.album);changed=true}
    if(j.artworkData&&!t.artworkData){t.artworkData=j.artworkData;changed=true}
    if(changed)await put(t);return changed;
  }catch(e){console.debug('AP-810 catalog lookup unavailable',e);return false}
}

async function ap810RepairTrack(t,{catalog=true}={}){
  const blob=bytesToBlob(t);if(!blob)return false;let changed=false;
  try{
    const tag=await ap810Embedded(blob,t.filename||'');
    if(clean(tag.title)&&(!clean(t.title)||clean(t.title)===parseName(t.filename).title)){t.title=clean(tag.title);changed=true}
    if(clean(tag.artist)&&(artist(t)==='Unknown Artist'||!clean(t.artist))){t.artist=clean(tag.artist);changed=true}
    if(clean(tag.album)&&!clean(t.album)){t.album=clean(tag.album);changed=true}
    if(tag.artworkData&&!t.artworkData){t.artworkData=tag.artworkData;changed=true}
    if(changed)await put(t);
  }catch(e){console.debug('AP-810 repair parse failed',e)}
  if(catalog&&(artist(t)==='Unknown Artist'||!t.artworkData))changed=(await ap810Catalog(t))||changed;
  return changed;
}

importFiles=async function(files,input){
  const list=Array.from(files||[]).filter(f=>f&&typeof f.arrayBuffer==='function'&&Number(f.size)>=0);if(!list.length)return;
  toast(`Importing ${list.length} track${list.length===1?'':'s'}…`);let n=0,newIds=[];
  for(const file of list){
    try{
      const detached=await detachFile(file),blob=new Blob([detached.audioBytes],{type:detached.mimeType});
      const [tag,d]=await Promise.all([ap810Embedded(blob,file.name||''),durationOf(blob)]),p=parseName(file.name||'');
      const t={id:uid(),title:clean(tag.title)||p.title,artist:clean(tag.artist)||p.artist,album:clean(tag.album)||'',filename:file.name||'audio',mimeType:detached.mimeType,audioBytes:detached.audioBytes,duration:d,addedAt:Date.now()+n,artworkData:tag.artworkData||''};
      await put(t);newIds.push(t.id);n++;
    }catch(e){console.error('AP-810 import failed',e)}
  }
  try{input.value=''}catch{}
  await refresh();renderAll();try{await navigator.storage?.persist?.()}catch{}
  toast(n===list.length?`${n} track${n===1?'':'s'} imported`:`Imported ${n} of ${list.length}`);
  setTimeout(async()=>{let changed=false;for(const id of newIds){const t=byId(id);if(t)changed=(await ap810RepairTrack(t,{catalog:true}))||changed}if(changed){await refresh();renderAll();syncMetadata()}},120);
};

const ap810RenderHomeBase=renderHome;
renderHome=function(){ap810RenderHomeBase();$$('#heroStats .pill').forEach(p=>{if(p.textContent.includes('AP-800'))p.innerHTML='<b>AP-810</b> build'})};

async function ap810RepairLibrary(){
  try{
    await refresh();let changed=false,count=0;
    for(const t of tracks){
      if(count>=40)break;
      if(artist(t)==='Unknown Artist'||!t.artworkData||!clean(t.album)){count++;changed=(await ap810RepairTrack(t,{catalog:true}))||changed}
    }
    if(changed){await refresh();renderAll();syncMetadata()}
  }catch(e){console.debug('AP-810 library repair skipped',e)}
}

try{const b=$('.buildCard b'),s=$('#buildState');if(b)b.textContent='Build AP-810';if(s)s.textContent='GitHub Pages edition • playback + metadata fix'}catch{}
window.addEventListener('load',()=>setTimeout(ap810RepairLibrary,700),{once:true});
setTimeout(()=>{try{mediaHandlers()}catch{}},0);
