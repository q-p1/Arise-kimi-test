import { test, expect } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
test.use({viewport:{width:390,height:844},serviceWorkers:'allow'});
test.setTimeout(50000);
function wavBuffer({seconds=3,sampleRate=8000,frequency=440}={}){const samples=Math.floor(seconds*sampleRate),dataBytes=samples*2,b=Buffer.alloc(44+dataBytes);b.write('RIFF',0);b.writeUInt32LE(36+dataBytes,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(dataBytes,40);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*i/sampleRate)*.18*32767),44+i*2);return b}
const file={name:'Offline Artist - Offline Song.wav',mimeType:'audio/wav',buffer:wavBuffer()};
async function waitController(page){await page.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration();return !!(r&&(r.active||r.waiting))},{timeout:12000});await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:12000})}

test('service worker installs AP-810 cache and offline shell reloads',async({page,context})=>{
  await page.goto(BASE);await expect(page.locator('.buildCard b')).toHaveText('Build AP-810',{timeout:10000});await waitController(page);
  const keys=await page.evaluate(()=>caches.keys());expect(keys.some(k=>k.includes('ap810'))).toBe(true);
  await page.locator('[data-tab="library"]').click();await page.locator('#importTop').setInputFiles([file]);await expect(page.locator('#libraryCount')).toContainText('1 track',{timeout:10000});
  await context.setOffline(true);await page.reload();await expect(page.locator('.buildCard b')).toHaveText('Build AP-810',{timeout:10000});await page.locator('[data-tab="library"]').click();await expect(page.locator('#libraryCount')).toContainText('1 track');await page.locator('#libraryList .track').click();await expect(page.locator('#audio')).toHaveJSProperty('paused',false,{timeout:7000});await context.setOffline(false);
});

test('offline navigation still loads exactly one AP-810 hotfix script',async({page,context})=>{
  await page.goto(BASE);await waitController(page);await context.setOffline(true);await page.reload();const scripts=await page.locator('script[src*="hotfix.js"]').count();expect(scripts).toBe(1);await expect(page.locator('#heroStats')).toContainText('AP-810');await context.setOffline(false);
});
