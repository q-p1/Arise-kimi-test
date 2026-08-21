import { test, expect } from '@playwright/test';

const BASE='http://127.0.0.1:4173/';
const META='https://arise-snowy-beta.vercel.app/api/track-meta';
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nK8AAAAASUVORK5CYII=';
test.use({viewport:{width:390,height:844},serviceWorkers:'block'});
test.setTimeout(50000);

function wavBuffer({seconds=3,sampleRate=8000,frequency=440}={}){const samples=Math.floor(seconds*sampleRate),dataBytes=samples*2,b=Buffer.alloc(44+dataBytes);b.write('RIFF',0);b.writeUInt32LE(36+dataBytes,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(dataBytes,40);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*i/sampleRate)*.18*32767),44+i*2);return b}
const wav=(name,o={})=>({name,mimeType:'audio/wav',buffer:wavBuffer(o)});

async function boot(page,{catalog=false}={}){
  await page.route(`${META}**`,r=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(catalog?{matched:true,title:'Catalog Song',artist:'Catalog Artist',album:'Catalog Album',artworkData:`data:image/png;base64,${PNG}`}:{matched:false})}));
  await page.route('https://itunes.apple.com/search**',r=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"resultCount":0,"results":[]}'}));
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.buildCard b')).toHaveText('Build AP-812',{timeout:10000});
  await expect(page.locator('#heroStats')).toContainText('AP-812',{timeout:10000});
}
async function importFiles(page,files){await page.locator('[data-tab="library"]').click();await page.locator('#importTop').setInputFiles(files);await expect(page.locator('#libraryList .track')).toHaveCount(files.length,{timeout:15000})}
async function titleSort(page){const b=page.locator('#sortBtn');while((await b.textContent())!=='Title')await b.click()}


test('AP-812 raw shell, manifest, cache version and script graph are internally consistent',async({page})=>{
  await boot(page);
  const x=await page.evaluate(async()=>{const [html,m,sw]=await Promise.all([fetch('./index.html',{cache:'no-store'}).then(r=>r.text()),fetch('./manifest.webmanifest?v=812',{cache:'no-store'}).then(r=>r.json()),fetch('./sw.js?v=812',{cache:'no-store'}).then(r=>r.text())]);return{html,start:m.start_url,sw}});
  expect(x.start).toBe('./?build=812');
  for(const asset of ['pre811.js?v=812','app.js?v=812','hotfix.js?v=812','ap811.js?v=812','ap812.js?v=812'])expect(x.html).toContain(asset);
  expect(x.html).toContain('Build AP-812');expect(x.sw).toContain('arise-player-ap812-');expect(x.sw).toContain("'./ap812.js?v=812'");
});

test('catalog repair supplies title, artist, album and a renderable real cover',async({page})=>{
  await boot(page,{catalog:true});await importFiles(page,[wav('mystery.wav')]);
  await expect(page.locator('#libraryList .trackCopy b')).toHaveText('Catalog Song',{timeout:10000});await expect(page.locator('#libraryList .trackCopy small')).toHaveText('Catalog Artist');
  const img=page.locator('#libraryList .trackArt img');await expect(img).toBeVisible();expect((await img.getAttribute('src'))?.startsWith('data:image/png;base64,')).toBe(true);
  expect(await img.evaluate(i=>i.naturalWidth)).toBeGreaterThan(0);
});

test('realistic ended event advances from Alpha to Beta and Beta remains playing',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Alpha.wav',{seconds:1.1,frequency:330}),wav('B - Beta.wav',{seconds:4,frequency:550})]);await titleSort(page);
  await page.locator('#libraryList .track').filter({hasText:'Alpha'}).click();await expect(page.locator('#miniTitle')).toHaveText('Alpha');
  await expect(page.locator('#miniTitle')).toHaveText('Beta',{timeout:9000});await expect(page.locator('#audio')).toHaveJSProperty('paused',false);await expect.poll(async()=>page.locator('#audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.1);
});

test('ended transitions remain stable across six consecutive automatic boundaries',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Alpha.wav',{seconds:.75,frequency:300}),wav('B - Beta.wav',{seconds:.75,frequency:400}),wav('C - Gamma.wav',{seconds:.75,frequency:500})]);await titleSort(page);
  await page.locator('#libraryList .track').filter({hasText:'Alpha'}).click();await page.locator('#mini').click({position:{x:80,y:20}});await page.locator('#repeat').click();
  const seen=[];let last='';const deadline=Date.now()+12000;while(seen.length<7&&Date.now()<deadline){const t=await page.locator('#nowTitle').textContent();if(t&&t!==last){seen.push(t);last=t}await page.waitForTimeout(80)}
  expect(seen.length).toBeGreaterThanOrEqual(7);for(let i=1;i<seen.length;i++)expect(seen[i]).not.toBe(seen[i-1]);await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
});

test('deleting a non-current queue item rebuilds the queue and cannot play the deleted song',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Alpha.wav',{seconds:5}),wav('B - Beta.wav',{seconds:5}),wav('C - Gamma.wav',{seconds:5})]);await titleSort(page);await page.locator('#libraryList .track').filter({hasText:'Alpha'}).click();await expect(page.locator('#queuePos')).toHaveText('1 of 3');
  await page.locator('#editBtn').click();page.once('dialog',d=>d.accept());await page.locator('#libraryList .track').filter({hasText:'Beta'}).locator('.deleteBtn').click();await expect(page.locator('#queuePos')).toHaveText('1 of 2');
  await page.locator('#mini').click({position:{x:80,y:20}});await page.locator('#next').click();await expect(page.locator('#nowTitle')).toHaveText('Gamma');await expect(page.locator('#upTitle')).not.toHaveText('Beta');
});

test('deleting current track closes Now Playing and immediately restores tab interaction',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Delete Me.wav',{seconds:5}),wav('B - Stay.wav',{seconds:5})]);await titleSort(page);await page.locator('#libraryList .track').filter({hasText:'Delete Me'}).click();await page.locator('#mini').click({position:{x:80,y:20}});await page.locator('#trackMenu').click();page.once('dialog',d=>d.accept());await page.locator('#sheet [data-act="delete"]').click();
  await expect(page.locator('#now')).toBeHidden();await expect(page.locator('#mini')).toBeHidden();await page.locator('[data-tab="home"]').click();await expect(page.locator('.view[data-view="home"]')).toHaveClass(/active/);await page.locator('[data-tab="library"]').click();await expect(page.locator('#libraryCount')).toContainText('1 track');
});

test('legacy filename guesses are replaced by authoritative embedded metadata',async({page})=>{
  await boot(page);
  const make=await page.evaluate(async()=>{
    function ss(n){return[(n>>21)&127,(n>>14)&127,(n>>7)&127,n&127]};function frame(id,arr){const h=new Uint8Array(10);[...id].forEach((c,i)=>h[i]=c.charCodeAt(0));new DataView(h.buffer).setUint32(4,arr.length);return new Uint8Array([...h,...arr])};const enc=new TextEncoder(),txt=s=>new Uint8Array([3,...enc.encode(s)]);const body=new Uint8Array([...frame('TIT2',txt('Real Title')),...frame('TPE1',txt('Real Artist')),...frame('TALB',txt('Real Album'))]);return[...new Uint8Array([73,68,51,3,0,0,...ss(body.length)]),...body,...new Uint8Array(64)]
  });
  await page.evaluate(async bytes=>{const r=indexedDB.open('arise-player-v3');await new Promise((res,rej)=>{r.onsuccess=res;r.onerror=()=>rej(r.error)});const rec={id:'legacy-ap800',title:'Wrong Title',artist:'Wrong Artist',album:'',filename:'Wrong Artist - Wrong Title.mp3',mimeType:'audio/mpeg',audioBytes:Uint8Array.from(bytes).buffer,duration:1,addedAt:Date.now(),artworkData:''};await new Promise((res,rej)=>{const tx=r.result.transaction('tracks','readwrite');tx.objectStore('tracks').put(rec);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})},make);
  await page.reload();await page.locator('[data-tab="library"]').click();await expect(page.locator('#libraryList .trackCopy b')).toHaveText('Real Title',{timeout:10000});await expect(page.locator('#libraryList .trackCopy small')).toHaveText('Real Artist');
});

test('version-2 IndexedDB does not brick startup',async({page})=>{
  await page.route('**/app.js*',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));await page.route('**/hotfix.js*',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));await page.route('**/ap811.js*',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));await page.route('**/ap812.js*',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));await page.goto(BASE);
  await page.evaluate(()=>new Promise((res,rej)=>{const r=indexedDB.open('arise-player-v3',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('tracks'))r.result.createObjectStore('tracks',{keyPath:'id'})};r.onsuccess=()=>{r.result.close();res()};r.onerror=()=>rej(r.error)}));
  await page.unroute('**/app.js*');await page.unroute('**/hotfix.js*');await page.unroute('**/ap811.js*');await page.unroute('**/ap812.js*');await page.route(`${META}**`,r=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"matched":false}'}));await page.route('https://itunes.apple.com/search**',r=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"resultCount":0,"results":[]}'}));await page.reload();await expect(page.locator('.buildCard b')).toHaveText('Build AP-812',{timeout:10000});await expect(page.locator('body')).not.toContainText('could not start');
});
