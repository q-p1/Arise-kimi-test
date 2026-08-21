const CACHE='arise-player-ap812-20260821-2';
const SHELL=[
  './','./index.html','./app.css?v=812','./pre811.js?v=812','./app.js?v=812',
  './hotfix.js?v=812','./ap811.js?v=812','./ap812.js?v=812','./catalog812.js?v=812',
  './manifest.webmanifest?v=812','./brand-mark.svg'
];

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
  if(event.request.method!=='GET')return;
  const u=new URL(event.request.url);
  if(u.origin!==self.location.origin)return;

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
