const {test,expect}=require('@playwright/test');

test('actual chord is drawn on reference staff with correct ledger lines and survives zoom',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  await page.evaluate(()=>{noteOn(52);noteOn(60);noteOn(63);});
  await expect(page.locator('#actual-note-overlay g[data-midi]')).toHaveCount(3);
  const geometry=()=>page.evaluate(()=>{
    const point=state.cursorPoints[0],staff=point.staves[0];
    return {step:staff.step,top:staff.top,topPitch:staff.topPitch,bass:point.bass,staves:document.querySelectorAll('#actual-note-overlay .bass-staff').length,notes:[...document.querySelectorAll('#actual-note-overlay g[data-midi]')].map(g=>({midi:Number(g.dataset.midi),y:Number(g.querySelector('ellipse').getAttribute('cy')),acc:g.querySelector('text.acc')?.textContent??'',name:g.dataset.name,ledger:g.querySelectorAll('line').length-1}))};
  });
  let g=await geometry();expect(g.topPitch).toBe(38);
  expect(g.notes.map(n=>n.acc)).toEqual(['','','♭']);expect(g.notes.map(n=>n.name)).toEqual(['E3','C4','E♭4']);expect(g.notes.map(n=>n.ledger)).toEqual([0,1,0]);
  // Below middle C goes to the bass staff added under the melody-only line (top line A3, so E3 is three steps down).
  expect(g.staves).toBe(1);expect(g.bass.topPitch).toBe(26);expect(g.bass.top).toBeGreaterThan(g.top+8*g.step);
  expect(g.notes[0].y).toBeCloseTo(g.bass.top+3*g.bass.step,4);expect(g.notes[1].y).toBeCloseTo(g.top+10*g.step,4);
  await page.locator('#zoom-in').click();await expect(page.locator('#actual-note-overlay g[data-midi]')).toHaveCount(3);g=await geometry();expect(g.notes[0].y).toBeCloseTo(g.bass.top+3*g.bass.step,4);
  await page.evaluate(()=>{noteOff(63);noteOff(60);noteOff(52);});await expect(page.locator('#actual-note-overlay g[data-midi]')).toHaveCount(3);
  await page.screenshot({path:'preview-actual-notes.png',fullPage:true});
  await page.evaluate(()=>loadScore(makeDemo(),'fixture',true));await page.evaluate(()=>noteOn(48));
  const bass=await page.evaluate(()=>({staff:state.cursorPoints[0].staves.at(-1),y:Number(document.querySelector('#actual-note-overlay ellipse').getAttribute('cy'))}));
  expect(bass.staff.topPitch).toBe(26);expect(bass.y).toBeCloseTo(bass.staff.top+5*bass.staff.step,4);
});

test('MIDI receive timestamp recovers an on-time note dispatched after its scoring window',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  const result=await page.evaluate(()=>{
    document.getElementById('count-in').checked=false;setTempo(60);start();cancelAnimationFrame(state.raf);
    const now=performance.now();state.beat=.4;state.lastFrame=now;state.inputStart=now-500;
    state.clockHistory=[{time:now-400,beat:0,count:0,bpm:60}];
    updateClock(now);const missedBefore=state.missed;
    const midi=activeNotes(state.events[0])[0].midi;
    midiMessage({data:[0x90,midi,90],timeStamp:now-350});
    const attempt=state.attempts.at(-1);
    pause();return {attempt,missedBefore,missedAfter:state.missed,correct:state.correct};
  });
  expect(result.attempt.reason).toBe('hit');expect(result.attempt.offset).toBeCloseTo(50,2);expect(result.attempt.dispatchMs).toBeGreaterThanOrEqual(350);
  expect(result.correct).toBe(1);expect(result.missedAfter).toBe(result.missedBefore-1);
  await expect(page.locator('#performance-diagnosis')).toContainText('MIDI 消息排队');
  await page.reload();await expect(page.locator('#play')).toBeEnabled();await expect(page.locator('#performance-diagnosis')).toContainText('上次记录');
});
