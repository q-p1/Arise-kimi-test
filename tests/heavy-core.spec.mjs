import { test, expect } from '@playwright/test';

const BASE='http://127.0.0.1:4173/';
const META='https://arise-snowy-beta.vercel.app/api/track-meta';

test.use({viewport:{width:390,height:844},serviceWorkers:'block'});
test.setTimeout(45000);

function wavBuffer({seconds=2,sampleRate=8000,frequency=440}={}){
  const samples=Math.floor(seconds*sampleRate),dataBytes=samples*2,b=Buffer.alloc(44+dataBytes);
  b.write('RIFF',0);b.writeUInt32LE(36+dataBytes,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(dataBytes,40);
  for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*i/sampleRate)*.18*32767),44+i*2);
  return b;
}
function syncSafe(n){return Buffer.from([(n>>21)&127,(n>>14)&127,(n>>7)&127,n&127])}
function id3Frame(id,payload){const h=Buffer.alloc(10);h.write(id,0);h.writeUInt32BE(payload.length,4);return Buffer.concat([h,payload])}
function taggedMp3({title='Embedded Title',artist='Embedded Artist',album='Embedded Album'}={}){
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nK8AAAAASUVORK5CYII=','base64');
  const text=s=>Buffer.concat([Buffer.from([3]),Buffer.from(s)]);
  const apic=Buffer.concat([Buffer.from([3]),Buffer.from('image/png\0'),Buffer.from([3]),Buffer.from([0]),png]);
  const body=Buffer.concat([id3Frame('TIT2',text(title)),id3Frame('TPE1',text(artist)),id3Frame('TALB',text(album)),id3Frame('APIC',apic)]);
  return Buffer.concat([Buffer.from('ID3'),Buffer.from([3,0,0]),syncSafe(body.length),body,Buffer.alloc(128)]);
}
function mp4Box(type,payload){
  const t=Buffer.from(type,'latin1'),b=Buffer.alloc(8);b.writeUInt32BE(8+payload.length,0);t.copy(b,4,0,4);return Buffer.concat([b,payload]);
}
function taggedM4a(){
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nK8AAAAASUVORK5CYII=','base64');
  const data=v=>mp4Box('data',Buffer.concat([Buffer.alloc(8),Buffer.isBuffer(v)?v:Buffer.from(v)]));
  const item=(t,v)=>mp4Box(t,data(v));
  const ilst=mp4Box('ilst',Buffer.concat([item('©nam','M4A Title'),item('©ART','M4A Artist'),item('©alb','M4A Album'),item('covr',png)]));
  const meta=mp4Box('meta',Buffer.concat([Buffer.alloc(4),ilst]));
  return Buffer.concat([mp4Box('ftyp',Buffer.from('M4A \0\0\0\0M4A ','latin1')),mp4Box('moov',mp4Box('udta',meta))]);
}
const wav=(name,{seconds=2,frequency=440}={})=>({name,mimeType:'audio/wav',buffer:wavBuffer({seconds,frequency})});

async function boot(page){
  await page.route(`${META}**`,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({matched:false})}));
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.buildCard b')).toHaveText('Build AP-810',{timeout:10000});
  await expect(page.locator('#heroStats')).toContainText('AP-810',{timeout:10000});
  await expect(page.locator('body')).not.toContainText('could not start');
}
async function importFiles(page,files,selector='#importTop'){
  await page.locator('[data-tab="library"]').click();
  await page.locator(selector).setInputFiles(files);
  await expect(page.locator('#libraryCount')).toContainText(`${files.length} track`,{timeout:15000});
}
async function addFiles(page,files,selector='#importTop'){
  const before=await page.locator('#libraryList .track').count();
  await page.locator(selector).setInputFiles(files);
  await expect(page.locator('#libraryList .track')).toHaveCount(before+files.length,{timeout:15000});
}
async function sortTitle(page){
  const b=page.locator('#sortBtn');
  if(await b.textContent()!=='Title')await b.click();
  await expect(b).toHaveText('Title');
}
async function openNow(page){
  await page.locator('#mini').click({position:{x:80,y:20}});
  await expect(page.locator('#now')).toBeVisible();
}

for(const emptySelector of ['#importEmpty','#importTop']){
  test(`native import control ${emptySelector} is directly tappable and opens Files`,async({page})=>{
    await boot(page);await page.locator('[data-tab="library"]').click();
    const wrap=page.locator(emptySelector).locator('..');
    const hit=await wrap.evaluate((el,id)=>{const r=el.getBoundingClientRect(),n=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return n?.id===id},emptySelector.slice(1));
    expect(hit).toBe(true);
    const chooser=page.waitForEvent('filechooser');await wrap.click();const fc=await chooser;await fc.setFiles([wav('Tap Artist - Tap Song.wav')]);
    await expect(page.locator('#libraryCount')).toContainText('1 track',{timeout:10000});
  });
}

test('UI boot, navigation, unique IDs, and every static control is wired',async({page})=>{
  await boot(page);
  const dup=await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(x=>x.id);return ids.filter((x,i)=>ids.indexOf(x)!==i)});expect(dup).toEqual([]);
  const handlers=await page.evaluate(()=>['brandHome','openSettings','sortBtn','editBtn','newPlaylist','mini','closeNow','play','prev','next','heart','shuffle','repeat','trackMenu','favoritesBtn','sleepBtn','clearHistory','storageBtn'].filter(id=>typeof document.getElementById(id)?.onclick!=='function'));
  expect(handlers).toEqual([]);
  for(const tab of ['library','playlists','more','home']){await page.locator(`[data-tab="${tab}"]`).click();await expect(page.locator(`.view[data-view="${tab}"]`)).toHaveClass(/active/)}
  await page.locator('#openSettings').click();await expect(page.locator('.view[data-view="more"]')).toHaveClass(/active/);
  await page.locator('#brandHome').click();await expect(page.locator('.view[data-view="home"]')).toHaveClass(/active/);
  await page.locator('[data-go="library"]').click();await expect(page.locator('.view[data-view="library"]')).toHaveClass(/active/);
});

test('icon-only transport controls have usable accessible labels',async({page})=>{
  await boot(page);
  const missing=await page.evaluate(()=>['openSettings','newPlaylist','closeNow','trackMenu','heart','shuffle','prev','play','next','repeat'].filter(id=>{const e=document.getElementById(id);return e&&!((e.getAttribute('aria-label')||'').trim())}));
  expect(missing).toEqual([]);
});

test('version markers are consistent across manifest, app and service worker',async({page})=>{
  await boot(page);
  const x=await page.evaluate(async()=>{const [m,a,s]=await Promise.all([fetch('./manifest.webmanifest').then(r=>r.json()),fetch('./app.js?v=800').then(r=>r.text()),fetch('./sw.js').then(r=>r.text())]);return{start:m.start_url,app:a,sw:s}});
  expect(x.start).toContain('build=810');
  expect(x.app).toContain("const BUILD='AP-810'");
  expect(x.app).toContain("register('./sw.js?v=810'");
  expect(x.sw).toContain('arise-player-ap810');
  expect(x.sw).toContain('hotfix.js?v=810');
});

test('database opens safely even if arise-player-v3 is already version 2',async({page})=>{
  await page.route('**/app.js*',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
  await page.route('**/hotfix.js*',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
  await page.goto(BASE);
  await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('arise-player-v3',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('tracks'))r.result.createObjectStore('tracks',{keyPath:'id'})};r.onsuccess=()=>{r.result.close();resolve()};r.onerror=()=>reject(r.error)}));
  await page.unroute('**/app.js*');await page.unroute('**/hotfix.js*');
  await page.route(`${META}**`,r=>r.fulfill({status:200,contentType:'application/json',body:'{"matched":false}'}));
  await page.reload();
  await expect(page.locator('.buildCard b')).toHaveText('Build AP-810',{timeout:10000});
  await expect(page.locator('body')).not.toContainText('could not start');
});

test('multi-file import stores detached audio bytes and survives reload',async({page})=>{
  await boot(page);await importFiles(page,[wav('Alpha - One.wav'),wav('Bravo - Two.wav',{frequency:520}),wav('Charlie - Three.wav',{frequency:630})]);
  const db=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('arise-player-v3');r.onsuccess=()=>{const q=r.result.transaction('tracks').objectStore('tracks').getAll();q.onsuccess=()=>resolve(q.result.map(t=>({title:t.title,artist:t.artist,bytes:t.audioBytes instanceof ArrayBuffer,size:t.audioBytes?.byteLength||0})));q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)}));
  expect(db).toHaveLength(3);expect(db.every(x=>x.bytes&&x.size>44)).toBe(true);
  await page.reload();await expect(page.locator('#libraryCount')).toContainText('3 tracks',{timeout:10000});
});

test('filename metadata fallback, embedded ID3 artist/title/cover, and M4A parser all work',async({page})=>{
  await boot(page);await importFiles(page,[wav('Filename Artist - Filename Song.wav')]);
  await expect(page.locator('#libraryList .trackCopy b')).toHaveText('Filename Song');await expect(page.locator('#libraryList .trackCopy small')).toHaveText('Filename Artist');
  await addFiles(page,[{name:'mystery.mp3',mimeType:'audio/mpeg',buffer:taggedMp3()}]);
  const id3=page.locator('#libraryList .track').filter({hasText:'Embedded Title'});await expect(id3.locator('.trackCopy small')).toHaveText('Embedded Artist');expect((await id3.locator('.trackArt img').getAttribute('src'))?.startsWith('data:image/png;base64,')).toBe(true);
  const out=await page.evaluate(async bytes=>{const f=new File([Uint8Array.from(bytes)],'test.m4a',{type:'audio/mp4'});return await ap810MP4(f)},Array.from(taggedM4a()));
  expect(out.title).toBe('M4A Title');expect(out.artist).toBe('M4A Artist');expect(out.album).toBe('M4A Album');expect(out.artworkData?.startsWith('data:image/png;base64,')).toBe(true);
});

test('catalog fallback repairs unknown artist and missing cover deterministically',async({page})=>{
  await boot(page);await page.unroute(`${META}**`);await page.route(`${META}**`,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({matched:true,title:'Catalog Song',artist:'Catalog Artist',album:'Catalog Album',artworkData:'data:image/png;base64,iVBORw0KGgo='})}));
  await importFiles(page,[wav('mystery.wav')]);
  await expect(page.locator('#libraryList .trackCopy b')).toHaveText('Catalog Song',{timeout:10000});await expect(page.locator('#libraryList .trackCopy small')).toHaveText('Catalog Artist');
  expect((await page.locator('#libraryList .trackArt img').getAttribute('src'))?.startsWith('data:image/png;base64,')).toBe(true);
});

test('legacy AP-800 filename-derived metadata is upgraded from embedded tags',async({page})=>{
  await boot(page);const bytes=Array.from(taggedMp3({title:'Real Title',artist:'Real Artist',album:'Real Album'}));
  await page.evaluate(async bytes=>{const rec={id:'legacy',title:'Wrong Title',artist:'Wrong Artist',album:'',filename:'Wrong Artist - Wrong Title.mp3',mimeType:'audio/mpeg',audioBytes:Uint8Array.from(bytes).buffer,duration:1,addedAt:Date.now(),artworkData:''};await new Promise((resolve,reject)=>{const r=indexedDB.open('arise-player-v3');r.onsuccess=()=>{const tx=r.result.transaction('tracks','readwrite');tx.objectStore('tracks').put(rec);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)};r.onerror=()=>reject(r.error)})},bytes);
  await page.reload();await page.locator('[data-tab="library"]').click();
  await expect(page.locator('#libraryList .trackCopy b')).toHaveText('Real Title',{timeout:10000});await expect(page.locator('#libraryList .trackCopy small')).toHaveText('Real Artist');
  expect((await page.locator('#libraryList .trackArt img').getAttribute('src'))?.startsWith('data:image/png;base64,')).toBe(true);
});

test('search and all three sort modes behave correctly',async({page})=>{
  await boot(page);await importFiles(page,[wav('Bravo - Zebra.wav'),wav('Alpha - Moon.wav'),wav('Charlie - Apple.wav')]);
  await sortTitle(page);expect(await page.locator('#libraryList .trackCopy b').allTextContents()).toEqual(['Apple','Moon','Zebra']);
  await page.locator('#sortBtn').click();await expect(page.locator('#sortBtn')).toHaveText('Artist');expect(await page.locator('#libraryList .trackCopy small').allTextContents()).toEqual(['Alpha','Bravo','Charlie']);
  await page.locator('#sortBtn').click();await expect(page.locator('#sortBtn')).toHaveText('Recent');
  await page.locator('#search').fill('moon');await expect(page.locator('#libraryList .track')).toHaveCount(1);await expect(page.locator('#libraryList')).toContainText('Moon');
  await page.locator('#search').fill('charlie');await expect(page.locator('#libraryList .track')).toHaveCount(1);await expect(page.locator('#libraryList')).toContainText('Apple');
  await page.locator('#search').fill('definitely-not-here');await expect(page.locator('#libraryList')).toContainText('No matches.');
});

test('mini player, Now Playing, pause/resume, seek, next and previous all work',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Alpha.wav',{seconds:7}),wav('B - Beta.wav',{seconds:7,frequency:520}),wav('C - Gamma.wav',{seconds:7,frequency:620})]);await sortTitle(page);
  await page.locator('#libraryList .track').first().click();await expect(page.locator('#mini')).toBeVisible();await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
  await openNow(page);await expect(page.locator('#nowTitle')).toHaveText('Alpha');await page.locator('#play').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',true);await page.waitForTimeout(250);await page.locator('#play').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
  await page.locator('#seek').evaluate(e=>{e.value='500';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))});await expect.poll(async()=>page.locator('#audio').evaluate(a=>a.currentTime),{timeout:4000}).toBeGreaterThan(2.5);
  await page.locator('#prev').click();await expect(page.locator('#nowTitle')).toHaveText('Alpha');await expect.poll(async()=>page.locator('#audio').evaluate(a=>a.currentTime)).toBeLessThan(1);
  await page.locator('#next').click();await expect(page.locator('#nowTitle')).toHaveText('Beta',{timeout:5000});await page.locator('#prev').click();await expect(page.locator('#nowTitle')).toHaveText('Alpha',{timeout:5000});
  await page.locator('#closeNow').click();await expect(page.locator('#now')).toBeHidden();
});

test('paused stale source recovers without reopening the app',async({page})=>{
  await boot(page);await importFiles(page,[wav('Idle Artist - Idle Song.wav',{seconds:8})]);await page.locator('#libraryList .track').first().click();await openNow(page);await page.locator('#play').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',true);
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('arise.ap800.session'));if(s){s.ts-=10*60*1000;localStorage.setItem('arise.ap800.session',JSON.stringify(s))}const a=document.querySelector('#audio');a.src='blob:http://127.0.0.1:4173/stale-source';try{a.load()}catch{}});
  await page.waitForTimeout(500);await page.locator('#play').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',false,{timeout:7000});expect(await page.locator('#audio').getAttribute('src')).toMatch(/^blob:/);
});

test('automatic end transition, repeat-one, repeat-all, and end-of-queue are correct',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Short.wav',{seconds:.35}),wav('B - Long.wav',{seconds:2.5,frequency:550})]);await sortTitle(page);
  await page.locator('#libraryList .track').filter({hasText:'Short'}).click();await expect(page.locator('#miniTitle')).toHaveText('Short');await expect(page.locator('#miniTitle')).toHaveText('Long',{timeout:8000});await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
  await page.locator('#libraryList .track').filter({hasText:'Short'}).click();await openNow(page);await page.locator('#repeat').click();await page.locator('#repeat').click();await expect(page.locator('#repeat')).toHaveText('↻¹');await page.waitForTimeout(1100);await expect(page.locator('#nowTitle')).toHaveText('Short');await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
  await page.locator('#repeat').click();await expect(page.locator('#repeat')).toHaveText('↻');
  await page.locator('#closeNow').click();await page.locator('#libraryList .track').filter({hasText:'Long'}).click();await openNow(page);await page.locator('#repeat').click();await page.waitForTimeout(3200);await expect(page.locator('#nowTitle')).toHaveText('Short');
  await page.locator('#repeat').click();await page.locator('#repeat').click();await page.locator('#closeNow').click();await page.locator('#libraryList .track').filter({hasText:'Long'}).click();await expect(page.locator('#audio')).toHaveJSProperty('paused',true,{timeout:6000});
});

test('shuffle never chooses the same current track and survives repeated next presses',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - One.wav',{seconds:4}),wav('B - Two.wav',{seconds:4,frequency:500}),wav('C - Three.wav',{seconds:4,frequency:600})]);await sortTitle(page);await page.locator('#libraryList .track').first().click();await openNow(page);await page.locator('#shuffle').click();await expect(page.locator('#shuffle')).toHaveClass(/active/);
  let prev=await page.locator('#nowTitle').textContent();for(let i=0;i<12;i++){await page.locator('#next').click();await expect.poll(async()=>page.locator('#nowTitle').textContent(),{timeout:5000}).not.toBe(prev);prev=await page.locator('#nowTitle').textContent()}
});

test('25 source transitions do not stall and old Blob URLs are revoked',async({page})=>{
  await boot(page);await page.evaluate(()=>{const c=URL.createObjectURL.bind(URL),r=URL.revokeObjectURL.bind(URL);window.__qaUrls=new Set();URL.createObjectURL=o=>{const u=c(o);window.__qaUrls.add(u);return u};URL.revokeObjectURL=u=>{window.__qaUrls.delete(u);return r(u)}});
  await importFiles(page,[wav('A - One.wav',{seconds:4}),wav('B - Two.wav',{seconds:4,frequency:500}),wav('C - Three.wav',{seconds:4,frequency:600})]);await sortTitle(page);await page.locator('#libraryList .track').first().click();await openNow(page);await page.locator('#repeat').click();
  for(let i=0;i<25;i++){const old=await page.locator('#nowTitle').textContent();await page.locator('#next').click();await expect.poll(async()=>page.locator('#nowTitle').textContent(),{timeout:5000}).not.toBe(old)}
  await page.waitForTimeout(1300);expect(await page.evaluate(()=>window.__qaUrls.size)).toBeLessThanOrEqual(2);await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
});

test('favorites work from heart and track menu, persist, and Favorites button plays them',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Favorite.wav',{seconds:4}),wav('B - Other.wav',{seconds:4})]);await sortTitle(page);await page.locator('#libraryList .track').first().click();await openNow(page);await page.locator('#heart').click();await expect(page.locator('#heart')).toHaveText('♥');await page.locator('#closeNow').click();await page.reload();await page.locator('[data-tab="more"]').click();await expect(page.locator('#favoritesCount')).toContainText('1 track');await page.locator('#favoritesBtn').click();await expect(page.locator('#miniTitle')).toHaveText('Favorite');
  await page.locator('[data-tab="library"]').click();await page.locator('#libraryList .track').filter({hasText:'Other'}).locator('.menuBtn').click();await page.locator('#sheet [data-act="fav"]').click();await page.locator('[data-tab="more"]').click();await expect(page.locator('#favoritesCount')).toContainText('2 tracks');
});

test('playlist create, add, open, remove, persistence, cancel, and delete all work',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Road.wav'),wav('B - Sky.wav')]);await page.locator('[data-tab="playlists"]').click();await page.locator('#newPlaylist').click();await page.locator('#plName').fill('Road Trip');await page.locator('#formDialog .confirm').click();await expect(page.locator('.playlist')).toContainText('Road Trip');
  await page.locator('#newPlaylist').click();await page.locator('#plName').fill('Cancel Me');await page.locator('#formDialog button[value="cancel"]').click();await expect(page.locator('#playlistRoot')).not.toContainText('Cancel Me');
  await page.locator('[data-tab="library"]').click();await page.locator('#libraryList .track').filter({hasText:'Road'}).locator('.menuBtn').click();await page.locator('#sheet button',{hasText:'Add to Road Trip'}).click();await page.reload();await page.locator('[data-tab="playlists"]').click();await expect(page.locator('.playlist')).toContainText('1 tracks');await page.locator('.playlist').click();await expect(page.locator('#playlistRoot')).toContainText('Road');
  await page.locator('#playlistRoot .track .menuBtn').click();await page.locator('#sheet button',{hasText:'Remove from Road Trip'}).click();await expect(page.locator('#playlistRoot')).toContainText('Nothing here yet.');
  await page.locator('#backPl').click();await page.locator('.playlist').click();page.once('dialog',d=>d.accept());await page.locator('#delPl').click();await expect(page.locator('#playlistRoot')).toContainText('No playlists yet.');
});

test('deleting a queued non-current track removes it from the active queue immediately',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Alpha.wav',{seconds:5}),wav('B - Beta.wav',{seconds:5}),wav('C - Gamma.wav',{seconds:5})]);await sortTitle(page);await page.locator('#libraryList .track').filter({hasText:'Alpha'}).click();await expect(page.locator('#queuePos')).toHaveText('1 of 3');await page.locator('#editBtn').click();
  const beta=page.locator('#libraryList .track').filter({hasText:'Beta'});page.once('dialog',d=>d.accept());await beta.locator('.deleteBtn').click();await expect(page.locator('#libraryCount')).toContainText('2 tracks');await expect(page.locator('#queuePos')).toHaveText('1 of 2');await openNow(page);await page.locator('#next').click();await expect(page.locator('#nowTitle')).toHaveText('Gamma',{timeout:5000});
});

test('deleting the current track clears playback and removes it from the library',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Delete Me.wav',{seconds:4}),wav('B - Stay.wav',{seconds:4})]);await sortTitle(page);await page.locator('#libraryList .track').filter({hasText:'Delete Me'}).click();await openNow(page);await page.locator('#heart').click();await page.locator('#trackMenu').click();page.once('dialog',d=>d.accept());await page.locator('#sheet [data-act="delete"]').click();await expect(page.locator('#mini')).toBeHidden();await page.locator('[data-tab="library"]').click();await expect(page.locator('#libraryCount')).toContainText('1 track');await expect(page.locator('#libraryList')).not.toContainText('Delete Me');
});

test('session restores current song and position, and Continue resumes it',async({page})=>{
  await boot(page);await importFiles(page,[wav('Resume Artist - Resume Song.wav',{seconds:8})]);await page.locator('#libraryList .track').first().click();await page.locator('#audio').evaluate(a=>{a.currentTime=2.2});await page.waitForTimeout(250);await page.locator('#miniPlay').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',true);await page.reload();await expect(page.locator('#mini')).toBeVisible();await expect(page.locator('#miniTitle')).toHaveText('Resume Song');await expect(page.locator('#continueSection')).toBeVisible();await page.locator('#continueCard').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',false,{timeout:7000});await expect.poll(async()=>page.locator('#audio').evaluate(a=>a.currentTime),{timeout:5000}).toBeGreaterThan(1.5);
});

test('recent history is recorded and Clear history removes only history',async({page})=>{
  await boot(page);await importFiles(page,[wav('Recent Artist - Recent Song.wav',{seconds:3})]);await page.locator('#libraryList .track').first().click();await page.waitForTimeout(200);await page.locator('[data-tab="home"]').click();await expect(page.locator('#recentSection')).toBeVisible();await page.locator('[data-tab="more"]').click();page.once('dialog',d=>d.accept());await page.locator('#clearHistory').click();await page.locator('[data-tab="home"]').click();await expect(page.locator('#recentSection')).toBeHidden();await page.locator('[data-tab="library"]').click();await expect(page.locator('#libraryCount')).toContainText('1 track');
});

test('sleep timer pauses playback and can be cancelled; storage button responds',async({page})=>{
  await boot(page);await importFiles(page,[wav('Sleep Artist - Sleep Song.wav',{seconds:5})]);await page.locator('#libraryList .track').first().click();await page.locator('[data-tab="more"]').click();page.once('dialog',d=>d.accept('0.003'));await page.locator('#sleepBtn').click();await expect(page.locator('#sleepStatus')).not.toHaveText('Off');await expect(page.locator('#audio')).toHaveJSProperty('paused',true,{timeout:3000});page.once('dialog',d=>d.accept('0'));await page.locator('#sleepBtn').click();await expect(page.locator('#sleepStatus')).toHaveText('Off');await page.locator('#storageBtn').click();await expect(page.locator('#toast')).not.toHaveText('');
});

test('Quick Start Play all, Shuffle, Favorites, and Library cards all perform an action',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - One.wav',{seconds:4}),wav('B - Two.wav',{seconds:4})]);await page.locator('[data-tab="home"]').click();await page.locator('[data-mix="all"]').click();await expect(page.locator('#mini')).toBeVisible();await page.locator('[data-mix="shuffle"]').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',false);await page.locator('#mini').click({position:{x:80,y:20}});await page.locator('#heart').click();await page.locator('#closeNow').click();await page.locator('[data-tab="home"]').click();await page.locator('[data-mix="favorites"]').click();await expect(page.locator('#mini')).toBeVisible();await page.locator('[data-go="library"]').click();await expect(page.locator('.view[data-view="library"]')).toHaveClass(/active/);
});

test('iPhone-size layout has no horizontal overflow and mini player does not overlap tabs',async({page})=>{
  await boot(page);for(const size of [{width:375,height:667},{width:390,height:844},{width:430,height:932}]){await page.setViewportSize(size);await page.locator('[data-tab="library"]').click();if((await page.locator('#libraryList .track').count())===0)await page.locator('#importTop').setInputFiles([wav('Layout Artist - Layout Song.wav',{seconds:4})]);await page.locator('#libraryList .track').first().click();const m=await page.evaluate(()=>{const mini=document.querySelector('#mini').getBoundingClientRect(),tabs=document.querySelector('.tabs').getBoundingClientRect();return{scroll:document.documentElement.scrollWidth,inner:innerWidth,miniBottom:mini.bottom,tabsTop:tabs.top,tabsBottom:tabs.bottom,h:innerHeight}});expect(m.scroll).toBeLessThanOrEqual(m.inner+1);expect(m.miniBottom).toBeLessThanOrEqual(m.tabsTop+1);expect(m.tabsBottom).toBeLessThanOrEqual(m.h+1)}
});

test('no uncaught page errors or console errors during a representative full flow',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(`page:${e.message}`));page.on('console',m=>{if(m.type()==='error')errors.push(`console:${m.text()}`)});await boot(page);await importFiles(page,[wav('QA - One.wav',{seconds:2}),wav('QA - Two.wav',{seconds:2})]);await page.locator('#libraryList .track').first().click();await openNow(page);await page.locator('#next').click();await page.locator('#play').click();await page.locator('#play').click();await page.locator('#heart').click();await page.locator('#closeNow').click();await page.locator('[data-tab="more"]').click();await page.locator('[data-tab="playlists"]').click();await page.locator('[data-tab="home"]').click();await page.waitForTimeout(500);expect(errors).toEqual([]);
});
