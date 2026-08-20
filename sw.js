const CACHE='arise-player-ap810-20260820-1';
const SHELL=['./','./index.html','./app.css?v=800','./app.js?v=800','./hotfix.js?v=810','./manifest.webmanifest','./brand-mark.svg'];

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

async function injectAP810(response){
  if(!response)return response;
  let html=await response.text();
  if(!html.includes('hotfix.js?v=810')){
    const tag='<script src="./hotfix.js?v=810" defer></script>';
    const app=html.match(/<script\s+src=["']\.\/app\.js[^>]*><\/script>/i)?.[0];
    html=app?html.replace(app,`${app}\n  ${tag}`):html.replace('</body>',`  ${tag}\n</body>`);
  }
  html=html.replace(/Build AP-800/g,'Build AP-810').replace(/GitHub Pages edition/g,'GitHub Pages edition • AP-810');
  const headers=new Headers(response.headers);
  headers.set('content-type','text/html; charset=utf-8');
  headers.delete('content-length');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const u=new URL(event.request.url);
  if(u.origin!==self.location.origin)return;

  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const r=await fetch(event.request,{cache:'no-store'});
        if(r.ok)caches.open(CACHE).then(c=>c.put('./index.html',r.clone()));
        return injectAP810(r);
      }catch{
        const cached=await caches.match('./index.html');
        return cached?injectAP810(cached):Response.error();
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request,{ignoreSearch:true}).then(hit=>
      hit||fetch(event.request).then(r=>{
        if(r.ok)caches.open(CACHE).then(c=>c.put(event.request,r.clone()));
        return r;
      })
    )
  );
});
