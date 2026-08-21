import { test, expect } from '@playwright/test';

const BASE='http://127.0.0.1:4173/?testApple=1';
const META='https://arise-snowy-beta.vercel.app/api/track-meta';
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nK8AAAAASUVORK5CYII=';
test.use({viewport:{width:390,height:844},serviceWorkers:'block'});
test.setTimeout(30000);

function wavBuffer({seconds=4,sampleRate=8000,frequency=440}={}){const samples=Math.floor(seconds*sampleRate),dataBytes=samples*2,b=Buffer.alloc(44+dataBytes);b.write('RIFF',0);b.writeUInt32LE(36+dataBytes,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(dataBytes,40);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*i/sampleRate)*.18*32767),44+i*2);return b}

test('JSONP catalog fallback repairs artist/album and supplies a real cover URL without CORS errors',async({page})=>{
  const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('pageerror',e=>errors.push(e.message));
  await page.route(`${META}**`,r=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"matched":false}'}));
  await page.route('https://itunes.apple.com/search**',route=>{
    const u=new URL(route.request().url()),cb=u.searchParams.get('callback');
    const payload={resultCount:1,results:[{trackName:'Jigsaw Falling Into Place',artistName:'Radiohead',collectionName:'In Rainbows',trackTimeMillis:4000,artworkUrl100:'https://example.test/100x100bb.jpg'}]};
    route.fulfill({status:200,contentType:'application/javascript',body:`${cb}(${JSON.stringify(payload)});`});
  });
  await page.route('https://example.test/**',r=>r.fulfill({status:200,contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:Buffer.from(PNG,'base64')}));
  await page.goto(BASE,{waitUntil:'domcontentloaded'});await expect(page.locator('.buildCard b')).toHaveText('Build AP-812');
  await page.locator('[data-tab="library"]').click();await page.locator('#importTop').setInputFiles([{name:'Radiohead - Jigsaw Falling Into Place.wav',mimeType:'audio/wav',buffer:wavBuffer()}]);
  await expect(page.locator('#libraryList .trackCopy small')).toHaveText('Radiohead');
  await expect.poll(async()=>page.locator('#libraryList .trackArt img').getAttribute('src'),{timeout:10000}).toContain('600x600bb');
  const rec=await page.evaluate(async()=>{const r=indexedDB.open('arise-player-v3');await new Promise((res,rej)=>{r.onsuccess=res;r.onerror=()=>rej(r.error)});return new Promise((res,rej)=>{const q=r.result.transaction('tracks','readonly').objectStore('tracks').getAll();q.onsuccess=()=>res(q.result[0]);q.onerror=()=>rej(q.error)})});
  expect(rec.album).toBe('In Rainbows');expect(rec.artworkData).toContain('600x600bb');expect(errors).toEqual([]);
});
