'use strict';

const AP813_BUILD='AP-813';
const AP813_MEDIA_SEGMENT='__arise_media__';
const AP813_IOS=/iP(?:hone|ad|od)/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const AP813_STANDALONE=window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
let ap813PreEndBusy=false;

function ap813VirtualURL(t){
  return new URL(`./${AP813_MEDIA_SEGMENT}/${encodeURIComponent(t.id)}`,location.href).href;
}
function ap813CanVirtual(){return !!navigator.serviceWorker?.controller}
function ap813IsBlob(u){return String(u||'').startsWith('blob:')}
function ap813Revoke(u){if(ap813IsBlob(u))try{URL.revokeObjectURL(u)}catch{}}
function ap813Source(t){
  if(ap813CanVirtual())return{url:ap813VirtualURL(t),virtual:true};
  const b=bytesToBlob(t);return b?{url:URL.createObjectURL(b),virtual:false}:null;
}

release=function(){
  const old=state.url;
  try{audio.pause();audio.removeAttribute('src');audio.load()}catch{}
  state.url=null;ap813PreEndBusy=false;ap813Revoke(old);
};

playCurrent=async function({at=0,autoplay=true}={}){
  const t=state.current,source=t&&ap813Source(t);
  if(!t||!source){toast('This file is unavailable');return false}
  const gen=++ap810SourceGeneration,oldUrl=state.url,newUrl=source.url;
  state.url=newUrl;
  let playPromise=null;
  try{
    audio.preload='auto';audio.defaultPlaybackRate=1;audio.playbackRate=1;
    audio.loop=state.repeat==='one';audio.autoplay=!!autoplay;audio.src=newUrl;
    if(Number(at)>0){
      const seek=()=>{if(gen!==ap810SourceGeneration)return;const d=Number(audio.duration);if(Number.isFinite(d)&&d>0)audio.currentTime=Math.min(Number(at),Math.max(0,d-.08));syncPosition(true)};
      audio.addEventListener('loadedmetadata',seek,{once:true});
    }
    if(autoplay){try{playPromise=audio.play()}catch(e){playPromise=Promise.reject(e)}}
    syncMetadata();renderPlayer();saveSession(true);
    let ok=true;
    if(autoplay){
      try{await playPromise}
      catch(first){
        ok=false;console.debug('AP-813 immediate play failed',first?.name||first);
        if(first?.name!=='NotAllowedError'&&gen===ap810SourceGeneration){
          await ap810WaitReady(gen,2400);
          if(gen===ap810SourceGeneration)try{await audio.play();ok=true}catch(second){console.debug('AP-813 ready retry failed',second?.name||second)}
        }
      }
    }else await ap810WaitReady(gen,2400);
    if(oldUrl&&oldUrl!==newUrl)setTimeout(()=>ap813Revoke(oldUrl),source.virtual?0:(ok?1400:5000));
    if(ok){state.resumeAt=0;return true}
    state.resumeAt=Number(at)||Number(audio.currentTime)||0;
    return false;
  }catch(e){
    console.error('AP-813 source transition failed',e);if(state.url===newUrl)state.url=oldUrl||null;ap813Revoke(newUrl);return false;
  }
};

resilientPlay=async function(){
  if(!state.current)return false;
  if(audio.src){
    try{await audio.play();state.resumeAt=0;return true}catch(e){console.debug('AP-813 direct resume failed',e?.name||e);if(e?.name==='NotAllowedError')return false}
  }
  const s=read(K.session,{at:0}),at=Number(state.resumeAt)||Number(s?.at)||0;
  return playCurrent({at,autoplay:true});
};

function ap813Advance(reason='ended'){
  if(state.transitioning)return false;
  if(state.repeat==='one'){
    audio.loop=true;try{audio.currentTime=0}catch{};try{void audio.play()}catch{};return true;
  }
  const n=nextItem();if(!n)return false;
  state.transitioning=true;ap813PreEndBusy=true;
  state.current=n;state.index=state.queue.findIndex(x=>x.id===n.id);state.resumeAt=0;
  Promise.resolve(playCurrent({at:0,autoplay:true}))
    .catch(e=>console.debug(`AP-813 ${reason} handoff failed`,e))
    .finally(()=>{state.transitioning=false;setTimeout(()=>{ap813PreEndBusy=false},180)});
  return true;
}

// AP-812's normal ended handler is kept as a foreground fallback only through
// this replacement. In a backgrounded iOS web app we transition just BEFORE
// ended, while WebKit still considers the media session actively playing.
try{audio.removeEventListener('ended',ap812Ended,true)}catch{}
function ap813Ended(e){if(e.target!==audio)return;e.stopImmediatePropagation();if(!ap813Advance('ended')){state.resumeAt=0;saveSession(true);renderPlayer()}}
audio.addEventListener('ended',ap813Ended,true);

function ap813BeforeEnd(){
  if(!AP813_IOS||!AP813_STANDALONE||!document.hidden||ap813PreEndBusy||state.transitioning||state.repeat==='one'||audio.paused)return;
  const d=Number(audio.duration),p=Number(audio.currentTime);if(!Number.isFinite(d)||d<=0||!Number.isFinite(p))return;
  const remaining=d-p;
  // 0.42s is intentionally tiny but large enough for timeupdate to catch on
  // local media. It trades a few fade-out frames for not losing the whole queue.
  if(remaining>0&&remaining<=0.42&&nextItem())ap813Advance('pre-end');
}
audio.addEventListener('timeupdate',ap813BeforeEnd,true);

const ap813RepeatButton=document.querySelector('#repeat');
ap813RepeatButton?.addEventListener('click',()=>queueMicrotask(()=>{audio.loop=state.repeat==='one'}),true);

mediaHandlers=function(){
  if(!('mediaSession'in navigator))return;const set=(n,f)=>{try{navigator.mediaSession.setActionHandler(n,f)}catch{}};
  // Native ownership is the only path that can resume an already loaded source
  // after iOS suspends page JavaScript. The virtual URL keeps that source usable.
  if(AP813_IOS){set('play',null);set('pause',null)}else{set('play',()=>{void resilientPlay()});set('pause',()=>{audio.pause();saveSession(true)})}
  set('previoustrack',()=>{void previousTrack()});set('nexttrack',()=>{void nextTrack()});
  set('seekbackward',null);set('seekforward',null);
  set('seekto',d=>{if(Number.isFinite(d?.seekTime)&&Number.isFinite(audio.duration)){audio.currentTime=Math.max(0,Math.min(audio.duration,d.seekTime));syncPosition(true)}});
};
setTimeout(()=>{try{mediaHandlers()}catch{}},0);

// ---------- Human-verifiable metadata fallback ----------
function ap813CandidateScore(t,x){
  const g=ap812FilenameGuess(t.filename||''),ttl=Math.max(ap812Similarity(title(t),x.trackName),ap812Similarity(g.title,x.trackName));
  const ar=ap812ReadableArtist(artist(t))?Math.max(ap812Similarity(artist(t),x.artistName),ap812Similarity(g.artist,x.artistName)):ap812Similarity(g.artist,x.artistName);
  const d=Number(t.duration)||0,xd=Number(x.trackTimeMillis)/1000,ds=d&&xd?Math.max(0,1-Math.abs(d-xd)/Math.max(10,d*.2)):.45;
  return ttl*.60+ar*.30+ds*.10;
}
async function ap813Candidates(t){
  const g=ap812FilenameGuess(t.filename||''),term=[ap812ReadableArtist(artist(t))?artist(t):g.artist,title(t)||g.title].filter(x=>ap812ReadableArtist(x)||x!==g.artist).join(' ')||g.title;
  if(!term)return[];
  const u=new URL('https://itunes.apple.com/search');u.searchParams.set('term',term);u.searchParams.set('entity','song');u.searchParams.set('limit','24');u.searchParams.set('country','US');
  const j=await ap812JSONP(u.href,4500),seen=new Set();
  return (j?.results||[]).map(x=>({x,score:ap813CandidateScore(t,x)})).filter(o=>o.x?.trackName&&o.x?.artistName).sort((a,b)=>b.score-a.score).filter(o=>{const k=`${ap812Norm(o.x.trackName)}|${ap812Norm(o.x.artistName)}`;if(seen.has(k))return false;seen.add(k);return true}).slice(0,8);
}
function ap813Artwork(x){return clean(x?.artworkUrl100).replace(/100x100(?:bb)?/,'600x600bb')}
async function ap813ApplyCandidate(t,x){
  t.title=clean(x.trackName)||title(t);t.artist=clean(x.artistName)||artist(t);t.album=clean(x.collectionName)||'';const art=ap813Artwork(x);if(art)t.artworkData=art;t.metadataSource='chosen';await put(t);await refresh();renderAll();if(state.current?.id===t.id){state.current=byId(t.id)||t;syncMetadata();renderPlayer()}toast('Song identified');
}
function ap813Edit(t){
  closeSheet();const d=$('#formDialog'),f=$('#formBody');
  f.innerHTML=`<div class="formWrap"><h3>Edit song details</h3><input id="ap813Title" class="field" placeholder="Song title" maxlength="180" value="${esc(title(t))}"><input id="ap813Artist" class="field" placeholder="Artist" maxlength="180" value="${esc(artist(t)==='Unknown Artist'?'':artist(t))}"><input id="ap813Album" class="field" placeholder="Album" maxlength="180" value="${esc(clean(t.album))}"><div class="dialogActions"><button value="cancel">Cancel</button><button value="save" class="confirm">Save</button></div></div>`;
  f.onsubmit=async e=>{e.preventDefault();if(e.submitter?.value==='cancel'){d.close();return}const ttl=clean($('#ap813Title').value),art=clean($('#ap813Artist').value),alb=clean($('#ap813Album').value);if(ttl)t.title=ttl;t.artist=art||'Unknown Artist';t.album=alb;t.metadataSource='manual';await put(t);await refresh();d.close();renderAll();if(state.current?.id===t.id){state.current=byId(t.id)||t;syncMetadata();renderPlayer()}toast('Details saved')};
  try{d.showModal()}catch{d.setAttribute('open','')}
}
async function ap813Identify(t){
  closeSheet();openSheet('<div class="sheetTitle"><h3>Identify song</h3><p>Finding likely matches…</p></div>');
  const c=await ap813Candidates(t);
  if(!c.length){openSheet(`<div class="sheetTitle"><h3>No confident matches</h3><p>${esc(t.filename||title(t))}</p></div><button class="sheetOption" data-ap813-edit="1"><span>Edit details manually</span><span>✎</span></button>`);$('#sheet')._track=t;return}
  $('#sheet')._ap813Candidates=c;$('#sheet')._track=t;
  openSheet(`<div class="sheetTitle"><h3>Choose the correct song</h3><p>${esc(t.filename||title(t))}</p></div>${c.map((o,i)=>`<button class="sheetOption" data-ap813-candidate="${i}"><span><b>${esc(o.x.trackName)}</b><small style="display:block;opacity:.65;margin-top:3px">${esc(o.x.artistName)}${o.x.collectionName?` • ${esc(o.x.collectionName)}`:''}</small></span><span>›</span></button>`).join('')}<button class="sheetOption" data-ap813-edit="1"><span>None of these — edit manually</span><span>✎</span></button>`);
}

const ap813OpenTrackMenuBase=openTrackMenu;
openTrackMenu=function(t,pl=null){ap813OpenTrackMenuBase(t,pl);const body=$('#sheetBody'),danger=body?.querySelector('.danger');if(!body)return;const identify=document.createElement('button');identify.className='sheetOption';identify.dataset.ap813Identify='1';identify.innerHTML='<span>Identify song</span><span>⌕</span>';const edit=document.createElement('button');edit.className='sheetOption';edit.dataset.ap813Edit='1';edit.innerHTML='<span>Edit song details</span><span>✎</span>';body.insertBefore(identify,danger);body.insertBefore(edit,danger)};

document.addEventListener('click',e=>{
  const id=e.target.closest?.('[data-ap813-identify]');if(id){e.preventDefault();e.stopImmediatePropagation();const t=$('#sheet')._track;if(t)void ap813Identify(t);return}
  const ed=e.target.closest?.('[data-ap813-edit]');if(ed){e.preventDefault();e.stopImmediatePropagation();const t=$('#sheet')._track;if(t)ap813Edit(t);return}
  const c=e.target.closest?.('[data-ap813-candidate]');if(c){e.preventDefault();e.stopImmediatePropagation();const t=$('#sheet')._track,o=$('#sheet')._ap813Candidates?.[Number(c.dataset.ap813Candidate)];if(t&&o?.x){closeSheet();void ap813ApplyCandidate(t,o.x)}return}
},true);

const ap813RenderHomeBase=renderHome;
renderHome=function(){ap813RenderHomeBase();$$('#heroStats .pill').forEach(p=>{if(/AP-8(?:00|10|11|12)/.test(p.textContent))p.innerHTML='<b>AP-813</b> build'})};
const ap813RenderMoreBase=renderMore;
renderMore=async function(){await ap813RenderMoreBase();const b=$('.buildCard b'),s=$('#buildState');if(b)b.textContent='Build AP-813';if(s)s.textContent=`GitHub Pages • virtual-media iOS workaround${ap813CanVirtual()?' • media bridge active':' • bridge activates after reopen'}`};
try{const b=$('.buildCard b'),s=$('#buildState');if(b)b.textContent='Build AP-813';if(s)s.textContent='GitHub Pages • virtual-media iOS workaround'}catch{}
