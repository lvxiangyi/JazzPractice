const {test,expect}=require('@playwright/test');
const {LeadSheet}=require('../lead-sheet.js');
const {PracticeMatcher}=require('../practice-engine.js');
const fs=require('node:fs');
const sample=fs.readFileSync('examples/lead-sheet.musicxml','utf8');
test('voicings spell chord degrees and minimize local movement; guide tone excludes melody',()=>{
  const dm={root:2,degrees:{3:3,5:7,7:10,9:14},label:'Dm7'};
  const g={root:7,degrees:{3:4,5:7,7:10,9:14},label:'G7'};
  const shell=LeadSheet.nearestVoicing(dm,1);expect(shell.map(n=>n%12).sort((a,b)=>a-b)).toEqual([0,5]);
  const first=LeadSheet.nearestVoicing(dm,2),second=LeadSheet.nearestVoicing(g,2,first);
  expect(first.map(n=>n%12).sort((a,b)=>a-b)).toEqual([0,4,5,9]);
  expect(second.map(n=>n%12).sort((a,b)=>a-b)).toEqual([2,5,9,11]);
  expect(second.at(-1)-second[0]).toBeLessThanOrEqual(12);
  const options=LeadSheet.rightOptions(dm,65,[40,45,48,53]);expect(options).toEqual([60]);
  const matcher=new PracticeMatcher([{beat:0,notes:[{midi:65},{key:'guide',midi:60,accepts:[60,72]}]}]);
  expect(matcher.matchAt(0,72,e=>e.notes)).toMatchObject({key:'guide'});
  expect(matcher.matchAt(0,60,e=>e.notes)).toBeNull();
  expect(matcher.expire(0,e=>e.notes)).toEqual([65]);
});
test('swing shifts paired eighths only and leaves triplets, sixteenths and compound meter straight',()=>{
  const eighths=[0,.5,1,1.5].map(beat=>({beat,end:beat+.5,eighth:true,measure:1,notes:[{midi:60,duration:.5}]}));
  const swing=LeadSheet.swing(eighths,eighths,true,[{beats:4,beatType:4}]);
  expect(swing[1].beat).toBeCloseTo(2/3);expect(swing[0].notes[0].duration).toBeCloseTo(2/3);expect(swing[1].notes[0].duration).toBeCloseTo(1/3);expect(swing.at(-1).end).toBe(2);
  expect(LeadSheet.swing(eighths,eighths,false).map(e=>e.beat)).toEqual([0,.5,1,1.5]);
  const mixed=eighths.map(e=>({...e,swingBlocked:true}));expect(LeadSheet.swing(mixed,mixed,true).map(e=>e.beat)).toEqual([0,.5,1,1.5]);
  expect(LeadSheet.swing(eighths,eighths,true,[{beats:6,beatType:8}]).map(e=>e.beat)).toEqual([0,.5,1,1.5]);
});
test('lead levels preserve score, detect generated left hand and one optional guide-tone choice',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.evaluate(()=>loadScore(makeDemo(),'fixture',true));
  await page.locator('[data-mode="wait"]').click();
  await page.locator('#detection').selectOption('1');await expect(page.locator('#rule-error')).toContainText('没有');await expect(page.locator('#detection')).toHaveValue('0');
  await page.locator('#file').setInputFiles({name:'lead.musicxml',mimeType:'application/xml',buffer:Buffer.from(sample)});await expect(page.locator('#piece-title')).toContainText('Guide Tone');
  const scoreGeometry=()=>page.locator('#score svg').evaluate(svg=>[...svg.querySelectorAll('path,text')].map(n=>n.tagName==='path'?n.getAttribute('d'):n.textContent));
  const before=await scoreGeometry();
  await page.locator('#detection').selectOption('1');await expect(page.locator('#rule-error')).toBeHidden();expect(await scoreGeometry()).toEqual(before);
  const wanted=await page.evaluate(()=>activeNotes().map(n=>n.midi));expect(wanted).toHaveLength(3);expect(wanted).toContain(65);
  await page.locator('#play').click();await page.evaluate(()=>{for(const note of activeNotes().map(n=>n.midi)){noteOn(note);noteOff(note);}});expect(await page.evaluate(()=>state.index)).toBe(1);
  expect(await page.evaluate(()=>activeNotes().filter(n=>n.hand==='left').length)).toBe(0);
  await page.locator('#detection').selectOption('2');expect(await page.evaluate(()=>activeNotes().filter(n=>n.hand==='left').length)).toBe(4);
  await page.locator('#detection').selectOption('3');await expect(page.locator('#rule-error')).toBeHidden();
  const target=await page.evaluate(()=>activeNotes().find(n=>n.key==='guide'));expect(target.accepts.length).toBeGreaterThan(0);
  await page.locator('#play').click();await page.evaluate(()=>{const notes=activeNotes().filter(n=>!n.accepts).map(n=>n.midi);for(const n of notes){noteOn(n);noteOff(n);}});expect(await page.evaluate(()=>state.index)).toBe(0);
  await page.evaluate(()=>{const n=activeNotes().find(n=>n.accepts).accepts[0];noteOn(n);noteOff(n);});expect(await page.evaluate(()=>state.index)).toBe(1);
  expect(await page.evaluate(()=>activeNotes().some(n=>n.key==='guide'))).toBe(false);
  await page.locator('#rhythm').selectOption('swing');expect(await page.evaluate(()=>state.events[1].beat)).toBeCloseTo(2/3);
  await page.locator('#detection').selectOption('0');expect(await page.evaluate(()=>state.events[1].beat)).toBeCloseTo(2/3);
  await page.locator('#rhythm').selectOption('straight');expect(await page.evaluate(()=>state.events[1].beat)).toBe(.5);
  expect(errors).toEqual([]);
});
test('fullscreen and zoom retain score position, provide native or fallback exit',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.evaluate(()=>loadScore(makeDemo(),'fixture',true));
  await page.locator('#lead-demo').click();await expect(page.locator('#piece-title')).toContainText('Guide Tone');await page.locator('#detection').selectOption('3');await page.locator('#rhythm').selectOption('swing');
  await page.locator('#fullscreen').click();await expect(page.locator('#fullscreen')).toHaveAttribute('aria-pressed','true');
  await page.waitForTimeout(400);await page.locator('#score-size').fill('180');await expect(page.locator('#zoom-value')).toHaveText('180%');await expect(page.locator('#score svg')).toHaveCount(1);
  await page.screenshot({path:'preview-fullscreen.png'});
  await page.locator('#fullscreen').click();await expect(page.locator('#fullscreen')).toHaveAttribute('aria-pressed','false');
  await page.evaluate(()=>{document.getElementById('practice-workspace').requestFullscreen=async()=>{throw new Error('blocked');};});
  await page.locator('#fullscreen').click();await expect(page.locator('#practice-workspace')).toHaveClass(/focus-mode/);await page.keyboard.press('Escape');await expect(page.locator('#practice-workspace')).not.toHaveClass(/focus-mode/);
  expect(errors).toEqual([]);
});

test('harmony offsets, altered ninths, no chord and repeated visits produce correct targets',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.evaluate(()=>loadScore(makeDemo(),'fixture',true));
  const result=await page.evaluate(()=>{
    const xml='<score-partwise><part><measure><attributes><divisions>2</divisions></attributes><harmony><root><root-step>G</root-step></root><kind>dominant</kind></harmony><note><duration>2</duration></note><harmony><root><root-step>D</root-step></root><kind>minor-seventh</kind><degree><degree-value>9</degree-value><degree-alter>-1</degree-alter><degree-type>add</degree-type></degree><offset>1</offset></harmony></measure><measure><harmony><kind>none</kind></harmony></measure></part></score-partwise>';
    const meta=LeadSheet.parse(new DOMParser().parseFromString(xml,'text/xml'));
    const base=[0,1,2,3,4].map((beat,i)=>({beat,end:beat+1,cursorIndex:i,relativeBeat:beat%4,measure:beat<4?1:2,measureDuration:4,notes:[{midi:65,staff:1,duration:1}]}));
    const compiled=LeadSheet.compile(base,meta,2);
    const offset=compiled.find(e=>e.beat===1.5);
    const repeatMeta={harmonies:[meta.harmonies[0]],meters:meta.meters};
    const repeated=LeadSheet.compile([{...base[0],end:4},{...base[0],beat:4,end:8}],repeatMeta,1);
    return {offset:meta.harmonies[1].relative,ninth:meta.harmonies[1].degrees[9],synthetic:!!offset,cursor:offset.cursorIndex,notes:offset.notes.length,left:offset.lead.left.map(n=>n%12).sort((a,b)=>a-b),nc:compiled.at(-1).lead.left,repeat:repeated.map(e=>e.lead.leftAttack)};
  });
  expect(result).toEqual({offset:1.5,ninth:13,synthetic:true,cursor:1,notes:0,left:[0,3,5,9],nc:[],repeat:[true,true]});
});
