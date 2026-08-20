import { test, expect } from '@playwright/test';

const BASE='http://127.0.0.1:4173/';

function wavBuffer({seconds=.32,sampleRate=8000,frequency=440}={}){
  const samples=Math.floor(seconds*sampleRate),dataBytes=samples*2,b=Buffer.alloc(44+dataBytes);
  b.write('RIFF',0);b.writeUInt32LE(36+dataBytes,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(dataBytes,40);
  for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*i/sampleRate)*.2*32767),44+i*2);
  return b;
}

function syncSafe(n){return Buffer.from([(n>>21)&127,(n>>14)&127,(n>>7)&127,n&127])}
function frame(id,payload){const h=Buffer.alloc(10);h.write(id,0);h.writeUInt32BE(payload.length,4);return Buffer.concat([h,payload])}
function taggedMp3(){
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nK8AAAAASUVORK5CYII=','base64');
  const text=s=>Buffer.concat([Buffer.from([3]),Buffer.from(s)]);
  const apic=Buffer.concat([Buffer.from([3]),Buffer.from('image/png\0'),Buffer.from([3]),Buffer.from([0]),png]);
  const body=Buffer.concat([frame('TIT2',text('Embedded Title')),frame('TPE1',text('Embedded Artist')),frame('TALB',text('Embedded Album')),frame('APIC',apic)]);
  return Buffer.concat([Buffer.from('ID3'),Buffer.from([3,0,0]),syncSafe(body.length),body,Buffer.alloc(64)]);
}

async function clearPlayer(page){
  await page.evaluate(async()=>{
    localStorage.clear();
    await new Promise(resolve=>{const r=indexedDB.deleteDatabase('arise-player-v3');r.onsuccess=r.onerror=r.onblocked=()=>resolve()});
  });
}

async function importVia(page,files){
  await page.locator('[data-tab="library"]').click();
  const chooserPromise=page.waitForEvent('filechooser');
  await page.locator('.pageHead .nativeImport').click();
  const chooser=await chooserPromise;
  await chooser.setFiles(files);
}

test.beforeEach(async({page})=>{
  await page.goto(BASE);
  await clearPlayer(page);
  await page.reload();
  await expect(page.locator('.buildCard b')).toHaveText('Build AP-811',{timeout:10000});
});

test('AP-811 auto advances from the first local track to the second',async({page})=>{
  await importVia(page,[
    {name:'Second Artist - Second.wav',mimeType:'audio/wav',buffer:wavBuffer({seconds:2,frequency:550})},
    {name:'First Artist - First.wav',mimeType:'audio/wav',buffer:wavBuffer({seconds:.32,frequency:330})},
  ]);
  await expect(page.locator('#libraryCount')).toContainText('2 tracks');
  await page.locator('#libraryList .track').first().click();
  await expect(page.locator('#miniTitle')).toHaveText('First');
  await expect.poll(async()=>page.locator('#miniTitle').textContent(),{timeout:8000}).toBe('Second');
  await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
});

test('AP-811 reads embedded artist and song cover from ID3',async({page})=>{
  await importVia(page,[{name:'mystery.mp3',mimeType:'audio/mpeg',buffer:taggedMp3()}]);
  await expect(page.locator('#libraryCount')).toContainText('1 track',{timeout:10000});
  await expect(page.locator('#libraryList .trackCopy b')).toHaveText('Embedded Title');
  await expect(page.locator('#libraryList .trackCopy small')).toHaveText('Embedded Artist');
  const src=await page.locator('#libraryList .trackArt img').getAttribute('src');
  expect(src?.startsWith('data:image/png;base64,')).toBe(true);
});
