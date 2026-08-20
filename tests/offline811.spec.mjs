import { test, expect } from '@playwright/test';

const BASE='http://127.0.0.1:4173/';
test.use({viewport:{width:390,height:844},serviceWorkers:'allow'});
test.setTimeout(45000);

async function activate(page){
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.buildCard b')).toHaveText('Build AP-811',{timeout:10000});
  const info=await page.evaluate(async()=>{
    const reg=await navigator.serviceWorker.register('./sw.js?v=811',{scope:'./'});
    let sw=reg.installing||reg.waiting||reg.active;
    if(sw&&sw.state!=='activated')await Promise.race([
      new Promise(resolve=>{const f=()=>{if(sw.state==='activated'){sw.removeEventListener('statechange',f);resolve()}};sw.addEventListener('statechange',f)}),
      new Promise(resolve=>setTimeout(resolve,10000))
    ]);
    const ready=await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(()=>resolve(null),10000))]);
    return{active:!!(ready?.active||reg.active),state:(ready?.active||reg.active)?.state||''};
  });
  expect(info.active).toBe(true);expect(info.state).toBe('activated');
}

test('AP-811 service worker precaches every file needed for an offline boot',async({page})=>{
  await activate(page);
  const snapshot=await page.evaluate(async()=>{
    const keys=await caches.keys(),name=keys.find(k=>k.startsWith('arise-player-ap811-'));
    if(!name)return{name:null,urls:[],html:''};
    const c=await caches.open(name),reqs=await c.keys(),index=await c.match('./index.html');
    return{name,urls:reqs.map(r=>new URL(r.url).pathname+new URL(r.url).search),html:index?await index.text():''};
  });
  expect(snapshot.name).toMatch(/^arise-player-ap811-/);
  for(const part of ['index.html','app.css?v=811','pre811.js?v=811','app.js?v=811','hotfix.js?v=811','ap811.js?v=811','manifest.webmanifest?v=811','brand-mark.svg'])expect(snapshot.urls.some(x=>x.includes(part))).toBe(true);
  expect(snapshot.html).toContain('Build AP-811');expect(snapshot.html).toContain('ap811.js?v=811');
});

test('a controlled AP-811 page is served while Chromium is actually offline',async({page,context,browserName})=>{
  test.skip(browserName!=='chromium','Playwright WebKit has a known internal navigation crash when toggled offline; WebKit cache integrity is covered separately.');
  await activate(page);
  await page.goto(`${BASE}?claim=811`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:12000});
  await context.setOffline(true);
  try{
    await page.goto(`${BASE}?offline=811`,{waitUntil:'domcontentloaded',timeout:15000});
    await expect(page.locator('.buildCard b')).toHaveText('Build AP-811',{timeout:10000});
    await expect(page.locator('#heroStats')).toContainText('AP-811');
  } finally { await context.setOffline(false); }
});

test('WebKit verifies AP-811 cached HTML and assets without triggering Playwright offline-mode crash',async({page,browserName})=>{
  test.skip(browserName!=='webkit');
  await activate(page);
  const ok=await page.evaluate(async()=>{
    const name=(await caches.keys()).find(k=>k.startsWith('arise-player-ap811-'));if(!name)return false;const c=await caches.open(name);const html=await (await c.match('./index.html'))?.text();const js=await (await c.match('./ap811.js?v=811',{ignoreSearch:true}))?.text();return!!(html?.includes('Build AP-811')&&html?.includes('ap811.js?v=811')&&js?.includes("AP811_BUILD='AP-811'"));
  });
  expect(ok).toBe(true);
});
