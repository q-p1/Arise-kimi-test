const CACHE='arise-player-ap813-20260821-1';
const SHELL=[
  './','./index.html','./app.css?v=813','./pre811.js?v=813','./app.js?v=813',
  './hotfix.js?v=813','./ap811.js?v=813','./ap812.js?v=813','./catalog812.js?v=813','./ap813.js?v=813',
  './manifest.webmanifest?v=813','./brand-mark.svg'
];
const MEDIA_MARK='/__arise_media__/';
let mediaDBPromise=null;

function openMediaDB(){
  if(mediaDBPromise)return mediaDBPromise;
  mediaDBPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open('arise-player-v3');
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>{mediaDBPromise=null;reject(r.error)};
    r.onblocked=()=>{mediaDBPromise=null;reject(new Error('IndexedDB blocked'))};
  });
  return mediaDBPromise;
}
async function mediaRecord(id){
  const db=await openMediaDB();
  return new Promise((resolve,reject)=>{
    if(!db.objectStoreNames.contains('tracks'))return resolve(null);
    const tx=db.transaction('tracks','readonly'),r=tx.objectStore('tracks').get(id);
    r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);
  });
}
function recordBlob(t){
  if(!t)return null;const type=String(t.mimeType||'application/octet-stream');const raw=t.audioBytes;
  if(raw instanceof ArrayBuffer)return new Blob([raw],{type});
  if(ArrayBuffer.isView(raw))return new Blob([raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)],{type});
  if(t.blob instanceof Blob)return t.blob;
  return null;
}
function parseRange(value,size){
  const m=/^bytes=(\d*)-(\d*)$/i.exec(String(value||'').trim());if(!m)return null;
  let start=m[1]?Number(m[1]):null,end=m[2]?Number(m[2]):null;
  if(start==null&&end!=null){const n=Math.min(size,end);start=Math.max(0,size-n);end=size-1}
  else{start=start==null?0:start;end=end==null?size-1:Math.min(size-1,end)}
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||start>=size)return{invalid:true};
  return{start,end};
}
async function serveMedia(request,url){
  try{
    const at=url.pathname.lastIndexOf(MEDIA_MARK),encoded=url.pathname.slice(at+MEDIA_MARK.length),id=decodeURIComponent(encoded);
    if(!id)return new Response('Missing track',{status:400});
    const rec=await mediaRecord(id),blob=recordBlob(rec);if(!blob)return new Response('Track not found',{status:404});
    const size=blob.size,type=blob.type||String(rec.mimeType||'application/octet-stream');
    const common={'Content-Type':type,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    const range=parseRange(request.headers.get('range'),size);
    if(range?.invalid)return new Response(null,{status:416,headers:{...common,'Content-Range':`bytes */${size}`}});
    if(range){
      const part=blob.slice(range.start,range.end+1,type),headers={...common,'Content-Range':`bytes ${range.start}-${range.end}/${size}`,'Content-Length':String(part.size)};
      return new Response(request.method==='HEAD'?null:part,{status:206,headers});
    }
    const headers={...common,'Content-Length':String(size)};
    return new Response(request.method==='HEAD'?null:blob,{status:200,headers});
  }catch(e){console.error('AP-813 media bridge failed',e);return new Response('Media unavailable',{status:500})}
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k.startsWith('arise-player-')&&k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);
  if(u.origin!==self.location.origin)return;
  if(u.pathname.includes(MEDIA_MARK)&&(event.request.method==='GET'||event.request.method==='HEAD')){
    event.respondWith(serveMedia(event.request,u));return;
  }
  if(event.request.method!=='GET')return;

  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const r=await fetch(event.request,{cache:'no-store'});
        if(r.ok)caches.open(CACHE).then(c=>c.put('./index.html',r.clone()));
        return r;
      }catch{
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const hit=await caches.match(event.request,{ignoreSearch:true});
    if(hit)return hit;
    const r=await fetch(event.request);
    if(r.ok)caches.open(CACHE).then(c=>c.put(event.request,r.clone()));
    return r;
  })());
});
