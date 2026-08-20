'use strict';

const AP811_BUILD='AP-811';

function ap811CloseNow(){
  const now=document.querySelector('#now');
  if(now)now.hidden=true;
  document.body.style.removeProperty('overflow');
}

// Make every icon-only control understandable to VoiceOver as well as humans.
const AP811_LABELS={
  brandHome:'Arise Player home',openSettings:'More',newPlaylist:'New playlist',
  mini:'Open Now Playing',closeNow:'Close Now Playing',trackMenu:'Track options',
  heart:'Favorite',shuffle:'Shuffle',prev:'Previous track',play:'Play or pause',
  next:'Next track',repeat:'Repeat',favoritesBtn:'Play favorites',sleepBtn:'Sleep timer',
  clearHistory:'Clear listening history',storageBtn:'Protect offline storage'
};
for(const [id,label] of Object.entries(AP811_LABELS)){
  const el=document.getElementById(id);if(el&&!el.getAttribute('aria-label'))el.setAttribute('aria-label',label);
}

// Keep the public build marker truthful even though AP-811 layers on top of the
// stable AP-800 base and AP-810 playback/metadata engine.
const ap811RenderHomeBase=renderHome;
renderHome=function(){
  ap811RenderHomeBase();
  document.querySelectorAll('#heroStats .pill').forEach(p=>{
    if(/AP-8(?:00|10)/.test(p.textContent))p.innerHTML='<b>AP-811</b> build';
  });
};
const ap811RenderMoreBase=renderMore;
renderMore=async function(){
  await ap811RenderMoreBase();
  const b=document.querySelector('.buildCard b'),s=document.querySelector('#buildState');
  if(b)b.textContent='Build AP-811';
  if(s)s.textContent=`GitHub Pages edition • ${location.host} • heavy-QA build`;
};

// The base build asks IndexedDB for v1 explicitly. pre811.js safely rewrites
// that request. This override makes every later SW registration use AP-811 too.
registerSW=async function(){
  if(!('serviceWorker' in navigator))return;
  try{const r=await navigator.serviceWorker.register('./sw.js?v=811',{scope:'./'});r.update().catch(()=>{})}
  catch(e){console.debug('AP-811 sw unavailable',e)}
};

// AP-800 generated artist/title from the filename. If real embedded tags are
// available, embedded metadata is authoritative and should replace those old
// guesses instead of being blocked merely because the guess is non-empty.
const ap811RepairBase=ap810RepairTrack;
ap810RepairTrack=async function(t,{catalog=true}={}){
  if(!t)return false;
  let changed=false;
  try{
    const blob=bytesToBlob(t);
    if(blob){
      const tag=await ap810Embedded(blob,t.filename||'');
      const guessed=parseName(t.filename||'');
      if(clean(tag.title)&&(!clean(t.title)||clean(t.title)===clean(guessed.title))&&clean(t.title)!==clean(tag.title)){
        t.title=clean(tag.title);changed=true;
      }
      if(clean(tag.artist)&&(!clean(t.artist)||artist(t)==='Unknown Artist'||clean(t.artist)===clean(guessed.artist))&&clean(t.artist)!==clean(tag.artist)){
        t.artist=clean(tag.artist);changed=true;
      }
      if(clean(tag.album)&&clean(t.album)!==clean(tag.album)){t.album=clean(tag.album);changed=true}
      if(tag.artworkData&&!t.artworkData){t.artworkData=tag.artworkData;changed=true}
      if(changed)await put(t);
    }
  }catch(e){console.debug('AP-811 embedded migration skipped',e)}
  const more=await ap811RepairBase(t,{catalog});
  return changed||more;
};

// Deletion must mutate every structure that can still point at the removed
// track. Previously the IndexedDB/library updated while the active queue kept a
// stale object, so the UI could say “1 of 3” after only two songs remained.
deleteTrack=async function(t){
  closeSheet();
  if(!confirm(`Delete “${title(t)}” from Arise Player?\n\nThis removes the local audio file.`))return;
  const wasCurrent=state.current?.id===t.id;
  await del(t.id);

  let pls=playlists();
  pls.forEach(p=>p.tracks=(p.tracks||[]).filter(id=>id!==t.id));
  savePlaylists(pls);
  write(K.favorites,favorites().filter(id=>id!==t.id));
  write(K.recent,recent().filter(id=>id!==t.id));

  state.queue=state.queue.filter(x=>x&&x.id!==t.id);
  if(wasCurrent){
    release();
    state.current=null;state.index=-1;state.resumeAt=0;state.transitioning=false;
    localStorage.removeItem(K.session);
    ap811CloseNow();
  }else if(state.current){
    state.index=state.queue.findIndex(x=>x.id===state.current.id);
    if(state.index<0){state.queue=[];state.current=null;state.index=-1;localStorage.removeItem(K.session)}
    else saveSession(true);
  }

  await refresh();
  renderAll();
  toast('Song deleted');
};

// If a modal/sheet is closed after its track disappeared, never leave stale
// pointers that can act on a deleted object later.
const ap811CloseSheetBase=closeSheet;
closeSheet=function(){
  ap811CloseSheetBase();
  const d=document.querySelector('#sheet');if(d){d._track=null;d._pl=null}
};

try{
  const b=document.querySelector('.buildCard b'),s=document.querySelector('#buildState');
  if(b)b.textContent='Build AP-811';
  if(s)s.textContent='GitHub Pages edition • AP-811 heavy-QA build';
}catch{}

// Re-run library repair with the stricter migration rules. The AP-810 load
// repair may also run; the operations are idempotent.
window.addEventListener('load',()=>setTimeout(async()=>{
  try{await ap810RepairLibrary();renderHome();await renderMore()}catch(e){console.debug('AP-811 repair pass skipped',e)}
},900),{once:true});
