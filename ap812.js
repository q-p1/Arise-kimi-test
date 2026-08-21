'use strict';

const AP812_BUILD='AP-812';
const AP812_META_ENDPOINT='https://arise-snowy-beta.vercel.app/api/track-meta';
const AP812_IOS=/iP(?:hone|ad|od)/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
let ap812CatalogBudget=18;

function ap812Delay(ms){return new Promise(r=>setTimeout(r,ms))}
function ap812Norm(v){return clean(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function ap812Same(a,b){return ap812Norm(a)===ap812Norm(b)}
function ap812ReadableArtist(v){const x=clean(v);return x&&x!=='Unknown Artist'&&x!=='Unknown'&&x!=='Various Artists'}
function ap812StripNoise(v){
  let s=clean(v).replace(/\.[a-z0-9]{2,5}$/i,'').replace(/^\s*\d{1,3}\s*[._)-]+\s*/,'').replace(/_/g,' ');
  let prev='';
  const tail=/\s*(?:[-–—]\s*)?(?:\[|\()?\s*(?:(?:official|original)\s+)?(?:(?:music|lyric)\s+)?(?:video|audio|visuali[sz]er|lyrics?|mv|hd|hq|4k|topic|clean|explicit)(?:\s+version)?\s*(?:\]|\))?\s*$/i;
  while(s&&s!==prev){prev=s;s=s.replace(tail,'').trim()}
  return s;
}
function ap812FilenameGuess(name=''){
  const raw=ap812StripNoise(String(name).replace(/\.[^.]+$/,''));
  const p=raw.split(/\s+(?:-|–|—)\s+/).map(clean).filter(Boolean);
  if(p.length>=2){
    const artist=ap812StripNoise(p.shift());
    const title=ap812StripNoise(p.join(' - '));
    return{artist:artist||'Unknown Artist',title:title||raw};
  }
  const by=raw.match(/^(.+?)\s+by\s+(.+)$/i);
  if(by)return{title:ap812StripNoise(by[1]),artist:ap812StripNoise(by[2])||'Unknown Artist'};
  return{artist:'Unknown Artist',title:raw||'Untitled track'};
}
function ap812TitleCandidates(v){
  const a=[];const push=x=>{x=ap812StripNoise(x);if(x&&!a.some(y=>ap812Same(y,x)))a.push(x)};
  push(v);
  push(String(v||'').replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i,''));
  push(String(v||'').replace(/\s*[([][^\])]*(?:remaster(?:ed)?|live|radio edit|edit|version)[^\])]*[\])]\s*$/i,''));
  return a;
}

// -------- Safari-first playback engine --------
// When a track ends, play() for the next source must happen in the SAME
// ended-event task. Waiting for canplay first can lose the playback entitlement
// on iOS Safari and make automatic transitions require a fresh user gesture.
playCurrent=async function({at=0,autoplay=true}={}){
  const t=state.current,b=bytesToBlob(t);
  if(!t||!b){toast('This file is unavailable');return false}

  const gen=++ap810SourceGeneration;
  const oldUrl=state.url;
  const newUrl=URL.createObjectURL(b);
  state.url=newUrl;

  let playPromise=null;
  try{
    audio.preload='auto';
    audio.defaultPlaybackRate=1;audio.playbackRate=1;
    audio.autoplay=!!autoplay;
    audio.src=newUrl;

    if(Number(at)>0){
      const seek=()=>{
        if(gen!==ap810SourceGeneration)return;
        const d=Number(audio.duration);
        if(Number.isFinite(d)&&d>0)audio.currentTime=Math.min(Number(at),Math.max(0,d-.08));
        syncPosition(true);
      };
      audio.addEventListener('loadedmetadata',seek,{once:true});
    }

    // Deliberately before every await: preserve Safari's active media session.
    if(autoplay){
      try{playPromise=audio.play()}catch(e){playPromise=Promise.reject(e)}
    }

    syncMetadata();renderPlayer();saveSession(true);

    let ok=true;
    if(autoplay){
      try{await playPromise}
      catch(first){
        ok=false;
        console.debug('AP-812 immediate play retry path',first?.name||first);
        // NotAllowedError is policy, not buffering. Delayed retries cannot invent
        // a user gesture, so only retry readiness/decoder failures.
        if(first?.name!=='NotAllowedError'&&gen===ap810SourceGeneration){
          await ap810WaitReady(gen,2600);
          if(gen===ap810SourceGeneration){
            try{await audio.play();ok=true}catch(second){console.debug('AP-812 ready retry failed',second?.name||second)}
          }
        }
      }
    }else{
      await ap810WaitReady(gen,2600);
    }

    if(oldUrl&&oldUrl!==newUrl){
      const wait=ok?1200:5000;
      setTimeout(()=>{if(state.url!==oldUrl)try{URL.revokeObjectURL(oldUrl)}catch{}},wait);
    }
    if(ok){state.resumeAt=0;return true}
    state.resumeAt=Number(at)||Number(audio.currentTime)||0;
    if(!document.hidden)toast('Playback paused. Tap play to resume.');
    return false;
  }catch(e){
    console.error('AP-812 source transition failed',e);
    if(state.url===newUrl)state.url=oldUrl||null;
    try{URL.revokeObjectURL(newUrl)}catch{}
    return false;
  }
};

resilientPlay=async function(){
  if(!state.current)return false;
  // Resume the SAME element/source first. Rebuilding the Blob URL after a pause
  // needlessly creates a new autoplay decision on Safari.
  if(audio.src){
    let p;
    try{p=audio.play()}catch(e){p=Promise.reject(e)}
    try{await p;state.resumeAt=0;return true}
    catch(e){
      console.debug('AP-812 direct resume failed',e?.name||e);
      if(e?.name==='NotAllowedError')return false;
    }
  }
  const s=read(K.session,{at:0});
  const at=Number(state.resumeAt)||Number(s?.at)||0;
  return playCurrent({at,autoplay:true});
};

nextTrack=async function(){
  if(state.transitioning)return false;
  const n=nextItem();if(!n){audio.pause();return false}
  state.transitioning=true;
  try{state.current=n;state.index=state.queue.findIndex(x=>x.id===n.id);state.resumeAt=0;return await playCurrent({at:0,autoplay:true})}
  finally{state.transitioning=false}
};

previousTrack=async function(){
  if(state.transitioning)return false;
  if(Number(audio.currentTime)>3.5){audio.currentTime=0;syncPosition(true);return true}
  const p=prevItem();if(!p)return false;
  state.transitioning=true;
  try{state.current=p;state.index=state.queue.findIndex(x=>x.id===p.id);state.resumeAt=0;return await playCurrent({at:0,autoplay:true})}
  finally{state.transitioning=false}
};

function ap812Ended(e){
  if(e.target!==audio)return;
  // app.js owns an older async ended listener. Stop it so exactly one engine
  // swaps sources, instead of racing two transition paths.
  e.stopImmediatePropagation();
  if(state.transitioning)return;

  if(state.repeat==='one'){
    try{audio.currentTime=0}catch{}
    let p;try{p=audio.play()}catch(err){p=Promise.reject(err)}
    Promise.resolve(p).catch(err=>console.debug('AP-812 repeat-one resume failed',err?.name||err));
    return;
  }

  const n=nextItem();
  if(!n){state.resumeAt=0;saveSession(true);renderPlayer();return}

  state.transitioning=true;
  state.current=n;state.index=state.queue.findIndex(x=>x.id===n.id);state.resumeAt=0;
  // Calling an async function executes synchronously until its first await.
  // AP-812 playCurrent calls audio.play() before that first await.
  Promise.resolve(playCurrent({at:0,autoplay:true}))
    .catch(err=>console.debug('AP-812 ended handoff failed',err))
    .finally(()=>{state.transitioning=false});
}
audio.addEventListener('ended',ap812Ended,true);
audio.addEventListener('pause',()=>{if(state.current&&Number.isFinite(Number(audio.currentTime)))state.resumeAt=Number(audio.currentTime)||0},true);

mediaHandlers=function(){
  if(!('mediaSession' in navigator))return;
  const set=(n,f)=>{try{navigator.mediaSession.setActionHandler(n,f)}catch{}};

  // On iOS, native play/pause control of the same <audio> element survives a
  // backgrounded/suspended page more reliably than a custom JavaScript callback.
  if(AP812_IOS){set('play',null);set('pause',null)}
  else{
    set('play',()=>{void resilientPlay()});
    set('pause',()=>{audio.pause();saveSession(true)});
  }
  set('previoustrack',()=>{void previousTrack()});
  set('nexttrack',()=>{void nextTrack()});
  set('seekbackward',d=>{const by=Number(d?.seekOffset)||10;if(Number.isFinite(audio.duration))audio.currentTime=Math.max(0,Number(audio.currentTime)-by)});
  set('seekforward',d=>{const by=Number(d?.seekOffset)||10;if(Number.isFinite(audio.duration))audio.currentTime=Math.min(audio.duration,Number(audio.currentTime)+by)});
  set('seekto',d=>{if(Number.isFinite(d?.seekTime)&&Number.isFinite(audio.duration)){audio.currentTime=Math.max(0,Math.min(audio.duration,d.seekTime));syncPosition(true)}});
};

// -------- Better embedded metadata support --------
function ap812U32LE(b,p){return(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))>>>0}
function ap812U32BE(b,p){return(((b[p]<<24)>>>0)|(b[p+1]<<16)|(b[p+2]<<8)|b[p+3])>>>0}
function ap812Text(b){try{return clean(new TextDecoder('utf-8').decode(b))}catch{return''}}
function ap812Merge(dst,src){for(const k of ['title','artist','album','artworkData'])if(src?.[k]&&!dst[k])dst[k]=src[k];return dst}
function ap812B64Bytes(s){try{const raw=atob(String(s||'').replace(/\s+/g,'')),b=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);return b}catch{return new Uint8Array()}}

function ap812Vorbis(body,start=0){
  const out={};let p=start;
  if(p+4>body.length)return out;
  const vendor=ap812U32LE(body,p);p+=4+vendor;if(p+4>body.length)return out;
  const count=Math.min(ap812U32LE(body,p),500);p+=4;
  let cover='',coverMime='image/jpeg';
  for(let i=0;i<count&&p+4<=body.length;i++){
    const len=ap812U32LE(body,p);p+=4;if(len>8*1024*1024||p+len>body.length)break;
    const s=ap812Text(body.slice(p,p+len));p+=len;
    const eq=s.indexOf('=');if(eq<1)continue;
    const key=s.slice(0,eq).trim().toUpperCase(),val=clean(s.slice(eq+1));
    if(!val)continue;
    if(key==='TITLE'&&!out.title)out.title=val;
    if((key==='ARTIST'||key==='ALBUMARTIST'||key==='ALBUM ARTIST')&&!out.artist)out.artist=val;
    if(key==='ALBUM'&&!out.album)out.album=val;
    if(key==='METADATA_BLOCK_PICTURE'&&!out.artworkData){const pic=ap812Picture(ap812B64Bytes(val));if(pic)out.artworkData=pic}
    if(key==='COVERART'&&!cover)cover=val;
    if(key==='COVERARTMIME')coverMime=val;
  }
  if(!out.artworkData&&cover){const b=ap812B64Bytes(cover);if(b.length>20)out.artworkData=ap810DataURL(b,coverMime)}
  return out;
}
function ap812Picture(b){
  try{
    let p=0;if(b.length<32)return'';
    p+=4;const ml=ap812U32BE(b,p);p+=4;if(ml>512||p+ml>b.length)return'';const mime=ap812Text(b.slice(p,p+ml))||'image/jpeg';p+=ml;
    const dl=ap812U32BE(b,p);p+=4+dl;if(p+20>b.length)return'';
    p+=16;const len=ap812U32BE(b,p);p+=4;if(len<20||p+len>b.length)return'';
    return ap810DataURL(b.slice(p,p+len),mime);
  }catch{return''}
}

async function ap812FLAC(blob){
  const out={};
  try{
    const sig=new Uint8Array(await blob.slice(0,4).arrayBuffer());if(ap812Text(sig)!=='fLaC')return out;
    let p=4,blocks=0,last=false;
    while(!last&&p+4<=blob.size&&blocks++<64){
      const h=new Uint8Array(await blob.slice(p,p+4).arrayBuffer());if(h.length<4)break;
      last=!!(h[0]&0x80);const type=h[0]&0x7f,len=(h[1]<<16)|(h[2]<<8)|h[3];p+=4;
      if(len<0||len>20*1024*1024||p+len>blob.size)break;
      if(type===4||type===6){
        const body=new Uint8Array(await blob.slice(p,p+len).arrayBuffer());
        if(type===4)ap812Merge(out,ap812Vorbis(body));
        if(type===6&&!out.artworkData)out.artworkData=ap812Picture(body);
      }
      p+=len;
      if(out.title&&out.artist&&out.album&&out.artworkData)break;
    }
  }catch(e){console.debug('AP-812 FLAC tags skipped',e)}
  return out;
}

async function ap812Ogg(blob){
  const out={};
  try{
    const bytes=new Uint8Array(await blob.slice(0,Math.min(blob.size,4*1024*1024)).arrayBuffer());
    let p=0,packet=[],packets=[];
    while(p+27<=bytes.length&&packets.length<8){
      if(String.fromCharCode(...bytes.slice(p,p+4))!=='OggS')break;
      const segs=bytes[p+26],table=p+27,data=table+segs;if(data>bytes.length)break;
      let q=data;
      for(let i=0;i<segs;i++){
        const n=bytes[table+i];if(q+n>bytes.length){q=bytes.length;break}
        packet.push(bytes.slice(q,q+n));q+=n;
        if(n<255){const len=packet.reduce((s,x)=>s+x.length,0),full=new Uint8Array(len);let z=0;for(const x of packet){full.set(x,z);z+=x.length}packets.push(full);packet=[];if(packets.length>=8)break}
      }
      p=q;
    }
    for(const pk of packets){
      const head=String.fromCharCode(...pk.slice(0,8));
      if(head==='OpusTags')ap812Merge(out,ap812Vorbis(pk,8));
      else if(pk[0]===3&&String.fromCharCode(...pk.slice(1,7))==='vorbis')ap812Merge(out,ap812Vorbis(pk,7));
    }
  }catch(e){console.debug('AP-812 Ogg tags skipped',e)}
  return out;
}

async function ap812RIFF(blob){
  const out={};
  try{
    const b=new Uint8Array(await blob.slice(0,Math.min(blob.size,3*1024*1024)).arrayBuffer());
    if(b.length<12||String.fromCharCode(...b.slice(0,4))!=='RIFF'||String.fromCharCode(...b.slice(8,12))!=='WAVE')return out;
    let p=12;
    while(p+8<=b.length){
      const id=String.fromCharCode(...b.slice(p,p+4)),len=ap812U32LE(b,p+4),start=p+8,end=Math.min(b.length,start+len);
      if(id==='LIST'&&end-start>=4&&String.fromCharCode(...b.slice(start,start+4))==='INFO'){
        let q=start+4;
        while(q+8<=end){const k=String.fromCharCode(...b.slice(q,q+4)),z=ap812U32LE(b,q+4),v=ap812Text(b.slice(q+8,Math.min(end,q+8+z))).replace(/\0+$/,'');if(k==='INAM'&&v)out.title=v;if(k==='IART'&&v)out.artist=v;if((k==='IPRD'||k==='IALB')&&v)out.album=v;q+=8+z+(z&1)}
      }
      p=start+len+(len&1);
    }
  }catch(e){console.debug('AP-812 RIFF tags skipped',e)}
  return out;
}

async function ap812ID3v1(blob){
  try{
    if(blob.size<128)return{};const b=new Uint8Array(await blob.slice(blob.size-128).arrayBuffer());if(String.fromCharCode(...b.slice(0,3))!=='TAG')return{};
    const txt=(a,z)=>clean(new TextDecoder('windows-1252').decode(b.slice(a,z)).replace(/\0+$/,''));
    return{title:txt(3,33),artist:txt(33,63),album:txt(63,93)};
  }catch{return{}}
}

async function ap812Embedded(blob,filename=''){
  const out={};const ext=(filename.split('.').pop()||'').toLowerCase();
  try{ap812Merge(out,await ap810Embedded(blob,filename))}catch{}
  if(['flac','fla'].includes(ext))ap812Merge(out,await ap812FLAC(blob));
  else if(['ogg','oga','opus'].includes(ext))ap812Merge(out,await ap812Ogg(blob));
  else if(['wav','wave'].includes(ext))ap812Merge(out,await ap812RIFF(blob));
  if(['mp3','mpeg','mp2'].includes(ext)&&(!out.title||!out.artist||!out.album))ap812Merge(out,await ap812ID3v1(blob));
  return out;
}

// -------- Smarter catalog recognition --------
async function ap812MetaEndpointCandidate(c,t){
  try{
    const u=new URL(AP812_META_ENDPOINT);u.searchParams.set('title',c.title);if(ap812ReadableArtist(c.artist))u.searchParams.set('artist',c.artist);
    const d=Math.round((Number(t.duration)||0)*1000);if(d)u.searchParams.set('durationMs',String(d));
    const r=await fetch(u,{cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)return null;const j=await r.json();return j?.matched?j:null;
  }catch{return null}
}
function ap812Similarity(a,b){
  const A=new Set(ap812Norm(a).split(' ').filter(Boolean)),B=new Set(ap812Norm(b).split(' ').filter(Boolean));if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.max(A.size,B.size)
}
async function ap812ArtworkData(url){
  try{const r=await fetch(url,{cache:'force-cache'});if(!r.ok)return'';const b=await r.blob();if(!b.type.startsWith('image/')||b.size>4*1024*1024)return'';return ap810DataURL(new Uint8Array(await b.arrayBuffer()),b.type)}catch{return''}
}
async function ap812AppleCandidate(c,t){
  if(ap812CatalogBudget<=0)return null;ap812CatalogBudget--;
  try{
    const term=[ap812ReadableArtist(c.artist)?c.artist:'',c.title].filter(Boolean).join(' ');if(!term)return null;
    const u=new URL('https://itunes.apple.com/search');u.searchParams.set('term',term);u.searchParams.set('entity','song');u.searchParams.set('limit','8');u.searchParams.set('country','US');
    const r=await fetch(u,{cache:'no-store'});if(!r.ok)return null;const j=await r.json();let best=null,bestScore=0;
    for(const x of j?.results||[]){
      const ts=ap812Similarity(c.title,x.trackName),as=ap812ReadableArtist(c.artist)?ap812Similarity(c.artist,x.artistName):0.45;
      const d=Number(t.duration)||0,xd=Number(x.trackTimeMillis)/1000,ds=d&&xd?Math.max(0,1-Math.abs(d-xd)/Math.max(8,d*.18)):0.5;
      const score=ts*.58+as*.34+ds*.08;if(score>bestScore){bestScore=score;best=x}
    }
    if(!best||bestScore<0.62)return null;
    let artwork='';if(best.artworkUrl100){const url=best.artworkUrl100.replace(/100x100(?:bb)?/,'600x600bb');artwork=await ap812ArtworkData(url)}
    return{matched:true,title:best.trackName,artist:best.artistName,album:best.collectionName||'',artworkData:artwork,_score:bestScore};
  }catch(e){console.debug('AP-812 Apple fallback unavailable',e);return null}
}
function ap812CatalogCandidates(t){
  const out=[],seen=new Set();
  const push=(ttl,art)=>{for(const x of ap812TitleCandidates(ttl)){const a=ap812ReadableArtist(art)?ap812StripNoise(art):'';const key=`${ap812Norm(x)}|${ap812Norm(a)}`;if(x&&!seen.has(key)){seen.add(key);out.push({title:x,artist:a})}}};
  push(title(t),artist(t));
  const f=ap812FilenameGuess(t.filename||'');push(f.title,f.artist);
  push(title(t),'');
  return out.slice(0,6);
}

ap810Catalog=async function(t){
  if(!t)return false;
  const candidates=ap812CatalogCandidates(t);let j=null;
  for(const c of candidates){j=await ap812MetaEndpointCandidate(c,t);if(j)break}
  if(!j){for(const c of candidates.slice(0,3)){j=await ap812AppleCandidate(c,t);if(j)break}}
  if(!j)return false;

  let changed=false;
  if(clean(j.title)&&!ap812Same(j.title,title(t))){t.title=clean(j.title);changed=true}
  if(clean(j.artist)&&!ap812Same(j.artist,artist(t))){t.artist=clean(j.artist);changed=true}
  if(clean(j.album)&&!ap812Same(j.album,clean(t.album))){t.album=clean(j.album);changed=true}
  if(j.artworkData&&j.artworkData!==t.artworkData){t.artworkData=j.artworkData;changed=true}
  if(changed){t.metadataSource=t.metadataSource==='embedded'?'embedded':'catalog';await put(t)}
  return changed;
};

ap810RepairTrack=async function(t,{catalog=true}={}){
  if(!t)return false;const blob=bytesToBlob(t);if(!blob)return false;let changed=false,embedded={};
  try{embedded=await ap812Embedded(blob,t.filename||'')}catch(e){console.debug('AP-812 embedded parse failed',e)}
  const guessed=ap812FilenameGuess(t.filename||'');
  if(clean(embedded.title)&&!ap812Same(embedded.title,title(t))){t.title=clean(embedded.title);changed=true}
  if(clean(embedded.artist)&&!ap812Same(embedded.artist,artist(t))){t.artist=clean(embedded.artist);changed=true}
  if(clean(embedded.album)&&!ap812Same(embedded.album,clean(t.album))){t.album=clean(embedded.album);changed=true}
  if(embedded.artworkData&&embedded.artworkData!==t.artworkData){t.artworkData=embedded.artworkData;changed=true}
  if(Object.keys(embedded).some(k=>embedded[k]))t.metadataSource='embedded';

  // Upgrade crude AP-800 filename parsing even when the file has no tags.
  if(!clean(embedded.title)&&guessed.title&&(!clean(t.title)||ap812Same(t.title,parseName(t.filename||'').title))&&!ap812Same(guessed.title,title(t))){t.title=guessed.title;changed=true}
  if(!clean(embedded.artist)&&ap812ReadableArtist(guessed.artist)&&(artist(t)==='Unknown Artist'||ap812Same(t.artist,parseName(t.filename||'').artist))&&!ap812Same(guessed.artist,artist(t))){t.artist=guessed.artist;changed=true}
  if(changed)await put(t);

  if(catalog&&(!embedded.artist||!embedded.artworkData||!embedded.title))changed=(await ap810Catalog(t))||changed;
  return changed;
};

importFiles=async function(files,input){
  const list=Array.from(files||[]).filter(f=>f&&typeof f.arrayBuffer==='function'&&Number(f.size)>=0);if(!list.length)return;
  toast(`Importing ${list.length} track${list.length===1?'':'s'}…`);let n=0,newIds=[];
  for(const file of list){
    try{
      const detached=await detachFile(file),blob=new Blob([detached.audioBytes],{type:detached.mimeType});
      const [tag,d]=await Promise.all([ap812Embedded(blob,file.name||''),durationOf(blob)]),p=ap812FilenameGuess(file.name||'');
      const t={id:uid(),title:clean(tag.title)||p.title,artist:clean(tag.artist)||p.artist,album:clean(tag.album)||'',filename:file.name||'audio',mimeType:detached.mimeType,audioBytes:detached.audioBytes,duration:d,addedAt:Date.now()+n,artworkData:tag.artworkData||'',metadataSource:Object.keys(tag).some(k=>tag[k])?'embedded':'filename'};
      await put(t);newIds.push(t.id);n++;
    }catch(e){console.error('AP-812 import failed',e)}
  }
  try{input.value=''}catch{}
  await refresh();renderAll();try{await navigator.storage?.persist?.()}catch{}
  toast(n===list.length?`${n} track${n===1?'':'s'} imported`:`Imported ${n} of ${list.length}`);
  // Recognition happens only after the file is safely stored, so network
  // slowness never blocks importing local music.
  setTimeout(async()=>{
    let changed=false;
    for(const id of newIds){const t=byId(id);if(t){changed=(await ap810RepairTrack(t,{catalog:true}))||changed;await ap812Delay(90)}}
    if(changed){await refresh();renderAll();syncMetadata()}
  },80);
};

async function ap812RepairLibrary(){
  try{
    await refresh();let changed=false,count=0;
    for(const t of tracks){
      if(count>=50)break;
      const unresolved=!ap812ReadableArtist(artist(t))||!t.artworkData||!clean(t.album)||t.metadataSource==='filename';
      if(unresolved){count++;changed=(await ap810RepairTrack(t,{catalog:true}))||changed;await ap812Delay(70)}
    }
    if(changed){await refresh();renderAll();syncMetadata()}
  }catch(e){console.debug('AP-812 library repair skipped',e)}
}

// -------- Build/PWA markers --------
const ap812RenderHomeBase=renderHome;
renderHome=function(){
  ap812RenderHomeBase();
  document.querySelectorAll('#heroStats .pill').forEach(p=>{if(/AP-8\d\d/.test(p.textContent))p.innerHTML='<b>AP-812</b> build'});
};
const ap812RenderMoreBase=renderMore;
renderMore=async function(){
  await ap812RenderMoreBase();const b=document.querySelector('.buildCard b'),s=document.querySelector('#buildState');
  if(b)b.textContent='Build AP-812';if(s)s.textContent=`GitHub Pages edition • ${location.host} • Safari playback + metadata`;
};
registerSW=async function(){
  if(!('serviceWorker' in navigator))return;
  try{const r=await navigator.serviceWorker.register('./sw.js?v=812',{scope:'./'});r.update().catch(()=>{})}catch(e){console.debug('AP-812 sw unavailable',e)}
};

try{const b=document.querySelector('.buildCard b'),s=document.querySelector('#buildState');if(b)b.textContent='Build AP-812';if(s)s.textContent='GitHub Pages edition • AP-812 Safari playback + metadata'}catch{}
setTimeout(()=>{try{mediaHandlers()}catch{}},0);
window.addEventListener('load',()=>setTimeout(ap812RepairLibrary,500),{once:true});
