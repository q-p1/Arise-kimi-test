'use strict';

function ap812JSONP(url,timeout=3500){
  return new Promise(resolve=>{
    const cb=`__arise812_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const u=new URL(url);u.searchParams.set('callback',cb);
    const s=document.createElement('script');let done=false;
    const finish=v=>{if(done)return;done=true;clearTimeout(timer);try{s.remove()}catch{};try{delete window[cb]}catch{window[cb]=undefined};resolve(v||null)};
    window[cb]=v=>finish(v);s.async=true;s.src=u.href;s.onerror=()=>finish(null);
    const timer=setTimeout(()=>finish(null),timeout);document.head.appendChild(s);
  });
}

// Last-resort remote art is still preferable to a fake letter tile. Embedded
// artwork and the Arise metadata endpoint remain higher priority and offline.
ap812ArtworkData=async function(url){return clean(url)};

ap812AppleCandidate=async function(c,t){
  if(ap812CatalogBudget<=0)return null;ap812CatalogBudget--;
  try{
    const term=[ap812ReadableArtist(c.artist)?c.artist:'',c.title].filter(Boolean).join(' ');if(!term)return null;
    const u=new URL('https://itunes.apple.com/search');u.searchParams.set('term',term);u.searchParams.set('entity','song');u.searchParams.set('limit','8');u.searchParams.set('country','US');
    const j=await ap812JSONP(u.href);let best=null,bestScore=0;
    for(const x of j?.results||[]){
      const ts=ap812Similarity(c.title,x.trackName),as=ap812ReadableArtist(c.artist)?ap812Similarity(c.artist,x.artistName):0.45;
      const d=Number(t.duration)||0,xd=Number(x.trackTimeMillis)/1000,ds=d&&xd?Math.max(0,1-Math.abs(d-xd)/Math.max(8,d*.18)):0.5;
      const score=ts*.58+as*.34+ds*.08;if(score>bestScore){bestScore=score;best=x}
    }
    if(!best||bestScore<0.62)return null;
    const artwork=best.artworkUrl100?best.artworkUrl100.replace(/100x100(?:bb)?/,'600x600bb'):'';
    return{matched:true,title:best.trackName,artist:best.artistName,album:best.collectionName||'',artworkData:artwork,_score:bestScore};
  }catch(e){console.debug('AP-812 Apple JSONP fallback unavailable',e);return null}
};
