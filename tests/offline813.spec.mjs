import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:4173/';
test.use({viewport:{width:390,height:844},serviceWorkers:'allow'});
test.setTimeout(50000);

async function activate(page){
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.buildCard b')).toHaveText('Build AP-813',{timeout:10000});
  await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js?v=813',{scope:'./'});await Promise.race([navigator.serviceWorker.ready,new Promise(r=>setTimeout(r,12000))])});
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:15000});
}

test('AP-813 service worker precaches the complete shell including virtual-media engine',async({page})=>{
  await activate(page);
  const x=await page.evaluate(async()=>{const name=(await caches.keys()).find(k=>k.startsWith('arise-player-ap813-'));if(!name)return{name:null,urls:[]};const c=await caches.open(name),reqs=await c.keys();return{name,urls:reqs.map(r=>new URL(r.url).pathname+new URL(r.url).search)}});
  expect(x.name).toMatch(/^arise-player-ap813-/);for(const part of ['index.html','app.css?v=813','app.js?v=813','ap812.js?v=813','catalog812.js?v=813','ap813.js?v=813','manifest.webmanifest?v=813'])expect(x.urls.some(u=>u.includes(part))).toBe(true);
});

test('Chromium can boot AP-813 while actually offline',async({page,context,browserName})=>{
  test.skip(browserName!=='chromium','Playwright WebKit offline navigation is unreliable; cache integrity is tested separately.');
  await activate(page);
  await page.goto(`${BASE}?claim=813`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:12000});
  await context.setOffline(true);
  try{
    await page.goto(`${BASE}?offline=813`,{waitUntil:'domcontentloaded',timeout:15000});
    await expect(page.locator('.buildCard b')).toHaveText('Build AP-813',{timeout:10000});
  }finally{await context.setOffline(false)}
});

test('WebKit sees AP-813 cached HTML and media bridge without toggling offline mode',async({page,browserName})=>{
  test.skip(browserName!=='webkit');await activate(page);const ok=await page.evaluate(async()=>{const name=(await caches.keys()).find(k=>k.startsWith('arise-player-ap813-'));if(!name)return false;const c=await caches.open(name),html=await (await c.match('./index.html'))?.text(),js=await (await c.match('./ap813.js?v=813',{ignoreSearch:true}))?.text(),sw=await fetch('./sw.js?v=813',{cache:'no-store'}).then(r=>r.text());return!!(html?.includes('Build AP-813')&&html?.includes('ap813.js?v=813')&&js?.includes("AP813_BUILD='AP-813'")&&sw.includes('__arise_media__')&&sw.includes('Accept-Ranges'))});expect(ok).toBe(true);
});
