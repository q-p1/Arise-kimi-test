import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:4173/';
const IPHONE_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
test.use({viewport:{width:390,height:844},serviceWorkers:'allow',userAgent:IPHONE_UA});
test.setTimeout(45000);

function wavBuffer({seconds=4,sampleRate=8000,frequency=440}={}){
  const samples=Math.floor(seconds*sampleRate),dataBytes=samples*2,b=Buffer.alloc(44+dataBytes);b.write('RIFF',0);b.writeUInt32LE(36+dataBytes,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(dataBytes,40);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*i/sampleRate)*.15*32767),44+i*2);return b;
}
const wav=(name,o={})=>({name,mimeType:'audio/wav',buffer:wavBuffer(o)});

async function controlled(page){
  await page.addInitScript(()=>{try{Object.defineProperty(navigator,'standalone',{configurable:true,value:true})}catch{}});
  await page.goto(BASE,{waitUntil:'domcontentloaded'});await expect(page.locator('.buildCard b')).toHaveText('Build AP-813',{timeout:10000});
  await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js?v=813',{scope:'./'});await Promise.race([navigator.serviceWorker.ready,new Promise(r=>setTimeout(r,12000))])});
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:15000});
  const flags=await page.evaluate(()=>({ios:AP813_IOS,standalone:AP813_STANDALONE,virtual:ap813CanVirtual()}));expect(flags).toEqual({ios:true,standalone:true,virtual:true});
}

test('installed iPhone hidden-page path hands off before the dead ended state',async({page})=>{
  await controlled(page);await page.locator('[data-tab="library"]').click();await page.locator('#importTop').setInputFiles([wav('A - Alpha.wav',{seconds:5,frequency:330}),wav('B - Beta.wav',{seconds:8,frequency:550})]);await expect(page.locator('#libraryList .track')).toHaveCount(2);
  const sort=page.locator('#sortBtn');while((await sort.textContent())!=='Title')await sort.click();await page.locator('#libraryList .track').filter({hasText:'Alpha'}).click();await expect(page.locator('#miniTitle')).toHaveText('Alpha');
  await page.waitForFunction(()=>Number.isFinite(audio.duration)&&audio.duration>1&&audio.readyState>=1,{timeout:10000});
  const r=await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    const before={title:state.current?.title,index:state.index,src:audio.src,duration:audio.duration};
    audio.currentTime=Math.max(0,audio.duration-.2);audio.dispatchEvent(new Event('timeupdate'));
    return{before,hidden:document.hidden};
  });expect(r.hidden).toBe(true);expect(r.before.duration).toBeGreaterThan(1);
  await expect(page.locator('#miniTitle')).toHaveText('Beta',{timeout:5000});await expect(page.locator('#audio')).toHaveJSProperty('paused',false);const src=await page.locator('#audio').evaluate(a=>a.src);expect(src).toContain('/__arise_media__/');expect(src).not.toBe(r.before.src);
});
