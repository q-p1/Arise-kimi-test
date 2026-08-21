import { test, expect } from '@playwright/test';

const BASE='http://127.0.0.1:4173/';
const META='https://arise-snowy-beta.vercel.app/api/track-meta';
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nK8AAAAASUVORK5CYII=';
const IPHONE_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
test.use({viewport:{width:390,height:844},serviceWorkers:'block',userAgent:IPHONE_UA});
test.setTimeout(60000);

function wavBuffer({seconds=4,sampleRate=8000,frequency=440}={}){
  const samples=Math.floor(seconds*sampleRate),dataBytes=samples*2,b=Buffer.alloc(44+dataBytes);
  b.write('RIFF',0);b.writeUInt32LE(36+dataBytes,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(dataBytes,40);
  for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*i/sampleRate)*.18*32767),44+i*2);
  return b;
}
const wav=(name,o={})=>({name,mimeType:'audio/wav',buffer:wavBuffer(o)});

async function boot(page,{metaHandler}={}){
  await page.route(`${META}**`,route=>{
    if(metaHandler)return metaHandler(route);
    return route.fulfill({status:200,contentType:'application/json',body:'{"matched":false}',headers:{'access-control-allow-origin':'*'}});
  });
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.buildCard b')).toHaveText('Build AP-812',{timeout:10000});
  await expect(page.locator('#heroStats')).toContainText('AP-812',{timeout:10000});
}
async function importFiles(page,files){
  await page.locator('[data-tab="library"]').click();
  await page.locator('#importTop').setInputFiles(files);
  await expect(page.locator('#libraryList .track')).toHaveCount(files.length,{timeout:15000});
}
async function titleSort(page){const b=page.locator('#sortBtn');while((await b.textContent())!=='Title')await b.click()}

function u32le(n){const b=Buffer.alloc(4);b.writeUInt32LE(n);return b}
function u32be(n){const b=Buffer.alloc(4);b.writeUInt32BE(n);return b}
function flacFixture(){
  const vendor=Buffer.from('Arise QA');
  const comments=['TITLE=FLAC Title','ARTIST=FLAC Artist','ALBUM=FLAC Album'].map(x=>Buffer.from(x));
  const vorbis=Buffer.concat([u32le(vendor.length),vendor,u32le(comments.length),...comments.flatMap(x=>[u32le(x.length),x])]);
  const png=Buffer.from(PNG,'base64'),mime=Buffer.from('image/png');
  const picture=Buffer.concat([u32be(3),u32be(mime.length),mime,u32be(0),u32be(1),u32be(1),u32be(24),u32be(0),u32be(png.length),png]);
  const head=(type,last,len)=>Buffer.from([(last?0x80:0)|type,(len>>16)&255,(len>>8)&255,len&255]);
  return Buffer.concat([Buffer.from('fLaC'),head(4,false,vorbis.length),vorbis,head(6,true,picture.length),picture]);
}
function oggPage(packet,seq=0){
  const segs=[];let remaining=packet.length;while(remaining>=255){segs.push(255);remaining-=255}segs.push(remaining);
  const h=Buffer.alloc(27+segs.length);h.write('OggS',0);h[4]=0;h[5]=seq===0?2:0;h.writeUInt32LE(seq,18);h[26]=segs.length;segs.forEach((n,i)=>h[27+i]=n);return Buffer.concat([h,packet]);
}
function opusFixture(){
  const head=Buffer.concat([Buffer.from('OpusHead'),Buffer.from([1,1,0,0,0x80,0xbb,0,0,0,0,0])]);
  const vendor=Buffer.from('Arise QA'),comments=['TITLE=Opus Title','ARTIST=Opus Artist','ALBUM=Opus Album'].map(x=>Buffer.from(x));
  const tags=Buffer.concat([Buffer.from('OpusTags'),u32le(vendor.length),vendor,u32le(comments.length),...comments.flatMap(x=>[u32le(x.length),x])]);
  return Buffer.concat([oggPage(head,0),oggPage(tags,1)]);
}

test('pause then immediate resume keeps the exact same source and resumes playback',async({page})=>{
  await boot(page);await importFiles(page,[wav('Artist - Resume.wav',{seconds:7})]);
  await page.locator('#libraryList .track').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
  await page.locator('#mini').click({position:{x:80,y:20}});const src=await page.locator('#audio').getAttribute('src');
  await page.locator('#play').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',true);await page.waitForTimeout(20);
  await page.locator('#play').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',false,{timeout:5000});
  expect(await page.locator('#audio').getAttribute('src')).toBe(src);
  const t=await page.locator('#audio').evaluate(a=>a.currentTime);await page.waitForTimeout(250);expect(await page.locator('#audio').evaluate(a=>a.currentTime)).toBeGreaterThan(t);
});

test('iPhone media session leaves native play and pause handlers unclaimed',async({page})=>{
  await page.addInitScript(()=>{
    const ms={handlers:{},metadata:null,playbackState:'none',setActionHandler(n,f){this.handlers[n]=f},setPositionState(){}};
    Object.defineProperty(navigator,'mediaSession',{configurable:true,value:ms});
    Object.defineProperty(window,'MediaMetadata',{configurable:true,value:class{constructor(v){Object.assign(this,v)}}});
  });
  await boot(page);
  const h=await page.evaluate(()=>({play:navigator.mediaSession.handlers.play,pause:navigator.mediaSession.handlers.pause,next:typeof navigator.mediaSession.handlers.nexttrack,prev:typeof navigator.mediaSession.handlers.previoustrack}));
  expect(h.play).toBeNull();expect(h.pause).toBeNull();expect(h.next).toBe('function');expect(h.prev).toBe('function');
});

test('ended handoff invokes play synchronously before the ended dispatch returns',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Alpha.wav'),wav('B - Beta.wav')]);await titleSort(page);
  await page.locator('#libraryList .track').filter({hasText:'Alpha'}).click();
  const r=await page.evaluate(()=>{
    audio.pause();let calls=0;const original=audio.play.bind(audio);audio.play=()=>{calls++;return Promise.resolve()};
    audio.dispatchEvent(new Event('ended'));
    const result={calls,current:state.current&&title(state.current),index:state.index};audio.play=original;return result;
  });
  expect(r.calls).toBe(1);expect(r.current).toBe('Beta');expect(r.index).toBe(1);
});

test('natural ended boundary still starts the next song and it keeps advancing',async({page})=>{
  await boot(page);await importFiles(page,[wav('A - Alpha.wav',{seconds:.8,frequency:330}),wav('B - Beta.wav',{seconds:3.5,frequency:550})]);await titleSort(page);
  await page.locator('#libraryList .track').filter({hasText:'Alpha'}).click();
  await expect(page.locator('#miniTitle')).toHaveText('Beta',{timeout:9000});await expect(page.locator('#audio')).toHaveJSProperty('paused',false);
  const t=await page.locator('#audio').evaluate(a=>a.currentTime);await page.waitForTimeout(300);expect(await page.locator('#audio').evaluate(a=>a.currentTime)).toBeGreaterThan(t);
});

test('FLAC Vorbis comments and embedded picture are recognized locally',async({page})=>{
  await boot(page);const bytes=[...flacFixture()];
  const meta=await page.evaluate(async b=>ap812Embedded(new Blob([Uint8Array.from(b)],{type:'audio/flac'}),'unknown.flac'),bytes);
  expect(meta.title).toBe('FLAC Title');expect(meta.artist).toBe('FLAC Artist');expect(meta.album).toBe('FLAC Album');expect(meta.artworkData.startsWith('data:image/png;base64,')).toBe(true);
});

test('OpusTags metadata is recognized locally',async({page})=>{
  await boot(page);const bytes=[...opusFixture()];
  const meta=await page.evaluate(async b=>ap812Embedded(new Blob([Uint8Array.from(b)],{type:'audio/ogg'}),'unknown.opus'),bytes);
  expect(meta.title).toBe('Opus Title');expect(meta.artist).toBe('Opus Artist');expect(meta.album).toBe('Opus Album');
});

test('noisy numbered filename becomes a clean artist/title and catalog cover can attach',async({page})=>{
  await boot(page,{metaHandler:route=>{
    const u=new URL(route.request().url());const ok=u.searchParams.get('title')==='Let Down'&&u.searchParams.get('artist')==='Radiohead';
    route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(ok?{matched:true,title:'Let Down',artist:'Radiohead',album:'OK Computer',artworkData:`data:image/png;base64,${PNG}`}:{matched:false})});
  }});
  await importFiles(page,[wav('01. Radiohead - Let Down (Official Audio).wav')]);
  await expect(page.locator('#libraryList .trackCopy b')).toHaveText('Let Down');await expect(page.locator('#libraryList .trackCopy small')).toHaveText('Radiohead');
  await expect.poll(async()=>page.locator('#libraryList .trackArt img').getAttribute('src'),{timeout:10000}).toContain('data:image/png;base64,');
});

test('Apple catalog fallback can recover metadata and persist artwork when primary lookup misses',async({page})=>{
  await page.route('https://itunes.apple.com/search**',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({resultCount:1,results:[{trackName:'Jigsaw Falling Into Place',artistName:'Radiohead',collectionName:'In Rainbows',trackTimeMillis:248000,artworkUrl100:'https://example.test/100x100bb.jpg'}]})}));
  await page.route('https://example.test/**',route=>route.fulfill({status:200,contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:Buffer.from(PNG,'base64')}));
  await boot(page);
  await importFiles(page,[wav('Radiohead - Jigsaw Falling Into Place.wav',{seconds:248})]);
  await expect(page.locator('#libraryList .trackCopy small')).toHaveText('Radiohead');
  await expect.poll(async()=>page.locator('#libraryList .trackArt img').getAttribute('src'),{timeout:12000}).toContain('data:image/png;base64,');
});
