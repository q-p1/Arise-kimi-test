import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:4173/';
const ART='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nK8AAAAASUVORK5CYII=';
test.use({viewport:{width:390,height:844},serviceWorkers:'allow'});
test.setTimeout(60000);

function wavBuffer({seconds=3,sampleRate=8000,frequency=440}={}){
  const samples=Math.floor(seconds*sampleRate),dataBytes=samples*2,b=Buffer.alloc(44+dataBytes);
  b.write('RIFF',0);b.writeUInt32LE(36+dataBytes,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(dataBytes,40);
  for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*i/sampleRate)*.15*32767),44+i*2);return b;
}
const wav=(name,o={})=>({name,mimeType:'audio/wav',buffer:wavBuffer(o)});

async function bootControlled(page){
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.buildCard b')).toHaveText('Build AP-813',{timeout:10000});
  await page.evaluate(async()=>{
    await navigator.serviceWorker.register('./sw.js?v=813',{scope:'./'});
    await Promise.race([navigator.serviceWorker.ready,new Promise(r=>setTimeout(r,12000))]);
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:15000});
  await expect(page.locator('.buildCard b')).toHaveText('Build AP-813');
}
async function clearLibrary(page){
  await page.evaluate(async()=>{
    localStorage.clear();
    const db=await new Promise((res,rej)=>{const r=indexedDB.open('arise-player-v3');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
    if(db.objectStoreNames.contains('tracks'))await new Promise((res,rej)=>{const tx=db.transaction('tracks','readwrite');tx.objectStore('tracks').clear();tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:15000});
  await expect.poll(()=>page.evaluate(()=>ap813CanVirtual())).toBe(true);
}
async function importFiles(page,files){
  await page.locator('[data-tab="library"]').click();await page.locator('#importTop').setInputFiles(files);await expect(page.locator('#libraryList .track')).toHaveCount(files.length,{timeout:15000});
}

test.beforeEach(async({page})=>{await bootControlled(page);await clearLibrary(page)});

test('AP-813 plays IndexedDB audio through a same-origin range-capable virtual media URL',async({page})=>{
  await importFiles(page,[wav('Bridge Artist - Bridge Song.wav',{seconds:4})]);
  await page.locator('#libraryList .track').first().click();
  await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
  const src=await page.locator('#audio').evaluate(a=>a.src);expect(src).toContain('/__arise_media__/');expect(src.startsWith(BASE)).toBe(true);
  const probe=await page.evaluate(async src=>{const r=await fetch(src,{headers:{Range:'bytes=0-31'}}),b=new Uint8Array(await r.arrayBuffer());return{status:r.status,range:r.headers.get('content-range'),len:b.length,head:String.fromCharCode(...b.slice(0,4))}},src);
  expect(probe.status).toBe(206);expect(probe.range).toMatch(/^bytes 0-31\//);expect(probe.len).toBe(32);expect(probe.head).toBe('RIFF');
});

test('pause then resume keeps the exact virtual source and continues time',async({page})=>{
  await importFiles(page,[wav('Resume Artist - Resume Song.wav',{seconds:6})]);await page.locator('#libraryList .track').first().click();
  await expect.poll(()=>page.locator('#audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.08);const before=await page.locator('#audio').evaluate(a=>({src:a.src,t:a.currentTime}));
  await page.locator('#audio').evaluate(a=>a.pause());await page.waitForTimeout(30);await page.evaluate(()=>resilientPlay());await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
  const after=await page.locator('#audio').evaluate(a=>({src:a.src,t:a.currentTime}));expect(after.src).toBe(before.src);expect(after.src).toContain('/__arise_media__/');await page.waitForTimeout(180);expect(await page.locator('#audio').evaluate(a=>a.currentTime)).toBeGreaterThan(after.t);
});

test('virtual source transitions to a second track and remains playable',async({page})=>{
  await importFiles(page,[wav('A - Alpha.wav',{seconds:2,frequency:330}),wav('B - Beta.wav',{seconds:5,frequency:550})]);
  const sort=page.locator('#sortBtn');while((await sort.textContent())!=='Title')await sort.click();
  await page.locator('#libraryList .track').filter({hasText:'Alpha'}).click();const first=await page.locator('#audio').evaluate(a=>a.src);await page.evaluate(()=>ap813Advance('qa'));
  await expect(page.locator('#miniTitle')).toHaveText('Beta');await expect(page.locator('#audio')).toHaveJSProperty('paused',false);const second=await page.locator('#audio').evaluate(a=>a.src);expect(second).not.toBe(first);expect(second).toContain('/__arise_media__/');
});

test('Identify song presents the chosen match, applies metadata and cover, and persists',async({page})=>{
  await importFiles(page,[wav('mystery.wav',{seconds:180})]);
  await page.evaluate(art=>{
    ap813Candidates=async()=>[
      {score:.99,x:{trackName:'The Correct Song',artistName:'The Correct Artist',collectionName:'The Correct Album',trackTimeMillis:180000,artworkUrl100:art}},
      {score:.51,x:{trackName:'Other Song',artistName:'Other Artist',collectionName:'Other Album',trackTimeMillis:210000,artworkUrl100:art}}
    ];
  },ART);
  await page.locator('.menuBtn').first().click();await page.locator('[data-ap813-identify]').click();
  const match=page.locator('[data-ap813-candidate]').filter({hasText:'The Correct Song'}).first();await expect(match).toBeVisible({timeout:5000});await match.click();
  await expect(page.locator('#libraryList .trackCopy b')).toHaveText('The Correct Song');await expect(page.locator('#libraryList .trackCopy small')).toHaveText('The Correct Artist');
  const src=await page.locator('#libraryList .trackArt img').getAttribute('src');expect(src).toBe(ART);
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-tab="library"]').click();await expect(page.locator('#libraryList .trackCopy b')).toHaveText('The Correct Song');await expect(page.locator('#libraryList .trackCopy small')).toHaveText('The Correct Artist');
  expect(await page.locator('#libraryList .trackArt img').getAttribute('src')).toBe(ART);
});

test('manual metadata editing is available when recognition is wrong',async({page})=>{
  await importFiles(page,[wav('unknown.wav')]);await page.locator('.menuBtn').first().click();await page.locator('[data-ap813-edit]').click();
  await page.locator('#ap813Title').fill('Manual Title');await page.locator('#ap813Artist').fill('Manual Artist');await page.locator('#ap813Album').fill('Manual Album');await page.locator('#formBody .confirm').click();
  await expect(page.locator('#libraryList .trackCopy b')).toHaveText('Manual Title');await expect(page.locator('#libraryList .trackCopy small')).toHaveText('Manual Artist');
});
