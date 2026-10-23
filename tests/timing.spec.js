const {test,expect}=require('@playwright/test');
const {PracticeMatcher}=require('../practice-engine.js');
const notesFor=e=>e.notes;
const events=[{beat:0,notes:[{midi:60},{midi:48}]},{beat:1,notes:[{midi:60}]},{beat:2,notes:[{midi:62}]}];
test('matches early and late onsets across event boundaries, without double counting',()=>{
  const matcher=new PracticeMatcher(events);
  expect(matcher.match(60,.1,60,0,2,notesFor)).toMatchObject({index:0,rating:'late'});
  expect(matcher.match(48,.05,60,0,2,notesFor)).toMatchObject({index:0,rating:'exact'});
  expect(matcher.match(60,.12,60,0,2,notesFor)).toBeNull();
  expect(matcher.match(60,.85,60,0,2,notesFor)).toMatchObject({index:1,rating:'early'});
  expect(matcher.match(62,2.3,60,0,2,notesFor)).toBeNull();
  expect(matcher.expire(0,notesFor)).toEqual([]);
  expect(matcher.expire(2,notesFor)).toEqual([62]);
  expect(matcher.expire(2,notesFor)).toEqual([]);
});
test('timing windows follow BPM, respect practice bounds and close missed notes',()=>{
  const matcher=new PracticeMatcher(events,{windowMs:120});
  expect(matcher.match(60,0,120,1,2,notesFor)).toBeNull();
  expect(matcher.match(60,.78,120,1,2,notesFor)).toMatchObject({index:1,rating:'early'});
  expect(matcher.expire(2,notesFor)).toEqual([62]);
  expect(matcher.match(62,2,120,1,2,notesFor)).toBeNull();
});
test('count-in ignores input, selected passage loops, score feedback survives zoom',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.evaluate(()=>loadScore(makeDemo(),'fixture',true));
  await page.locator('#range-start').selectOption('2');await page.locator('#range-end').selectOption('2');
  await page.locator('#hand').selectOption('right');await page.locator('#loop').check();
  await page.locator('[data-mode="tempo"]').click();await page.locator('#tempo').fill('200');await page.locator('#play').click();
  await page.locator('[data-midi="67"]').click();await expect(page.locator('#correct')).toHaveText('0');await expect(page.locator('#missed')).toHaveText('0');
  await expect.poll(()=>page.evaluate(()=>state.pass),{timeout:5000}).toBe(2);
  await expect(page.locator('#result')).not.toBeVisible();
  await page.locator('#restart').click();await page.locator('[data-mode="wait"]').click();
  await page.locator('#play').click();await page.locator('[data-midi="67"]').click();await expect(page.locator('#correct')).toHaveText('1');
  expect(await page.evaluate(()=>state.noteColors.size)).toBe(1);
  await page.locator('#zoom-in').click();expect(await page.evaluate(()=>state.noteColors.size)).toBe(1);
  expect(await page.locator('#score [fill="#267b63"]').count()).toBeGreaterThan(0);
  await page.locator('#whole-score').click();const note=page.locator('#score [data-event-index="4"]').first();await note.click();
  expect(await page.evaluate(()=>state.index)).toBe(4);await expect(page.locator('#measure')).toHaveText('02');
  expect(errors).toEqual([]);
});

test('tempo MIDI input hits a future note, expires missed notes and survives pause',async({page})=>{
  await page.addInitScript(()=>{window.port={state:'connected',name:'Test Piano'};navigator.requestMIDIAccess=async()=>({inputs:new Map([['p',window.port]])});});
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.evaluate(()=>loadScore(makeDemo(),'fixture',true));await page.locator('#connect').click();
  await page.locator('#hand').selectOption('right');await page.locator('[data-mode="tempo"]').click();await page.locator('#count-in').uncheck();await page.locator('#tempo').fill('60');
  await page.locator('#play').click();
  await page.evaluate(()=>{
    // Deliver a MIDI onset 150 ms before the second note, after the first note's window.
    cancelAnimationFrame(state.raf);state.beat=.85;state.lastFrame=performance.now();
    window.port.onmidimessage({data:[0x90,64,90]});window.port.onmidimessage({data:[0x80,64,0]});
  });
  await expect(page.locator('#correct')).toHaveText('1');await expect(page.locator('#early')).toHaveText('1');await expect(page.locator('#missed')).toHaveText('1');
  expect(await page.evaluate(()=>state.matcher.hitsAt(1).has(64))).toBe(true);
  await page.locator('#play').click();await page.locator('#play').click();
  expect(await page.evaluate(()=>state.matcher.hitsAt(1).has(64))).toBe(true);
});
