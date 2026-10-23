const {test,expect}=require('@playwright/test');

test('actual MIDI notes, chords, release and octave are visible during fullscreen practice',async({page})=>{
  await page.addInitScript(()=>{window.port={state:'connected',name:'Test Piano'};navigator.requestMIDIAccess=async()=>({inputs:new Map([['p',window.port]])});});
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('#connect').click();
  const send=async(data)=>page.evaluate(data=>window.port.onmidimessage({data}),data);
  await send([0x90,60,91]);await expect(page.locator('#played-notes')).toHaveText('按下 C4 · MIDI 60 · 力度 91');
  await send([0x90,64,82]);await send([0x90,67,75]);await expect(page.locator('#played-notes')).toContainText('C4 + E4 + G4');
  await send([0x80,64,0]);await expect(page.locator('#played-notes')).toContainText('C4 + G4');
  await send([0x90,60,0]);await send([0x80,67,0]);await expect(page.locator('#played-notes')).toContainText('刚弹');
  await page.locator('#fullscreen').click();await page.waitForTimeout(500);await page.locator('#play').click();
  // Assessment style: nothing played is shown until practice stops, unless live display is switched on.
  await send([0x90,97,100]);await expect(page.locator('#played-notes')).toContainText('演奏中不显示');await expect(page.locator('#actual-note-overlay')).toHaveCount(0);
  await page.evaluate(()=>{document.getElementById('live-notes').click();});await expect(page.locator('#played-notes')).toHaveText('按下 C♯7 · MIDI 97 · 力度 100');
  await send([0x80,97,0]);await expect(page.locator('#last-note')).toContainText('刚弹 C♯7');
});

test('3/4 metronome panel saves chosen beats and only sounds selected beats during practice',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('#metronome').click();
  await expect(page.locator('#metronome-panel')).toBeVisible();await expect(page.locator('#metronome-meter')).toHaveText('3/4');
  await page.locator('#metronome-enabled').check();await page.locator('[data-beat-preset="last"]').click();
  await expect(page.getByRole('button',{name:'第 3 拍发声',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'第 1 拍发声',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.locator('#metronome-panel-volume').fill('35');await page.locator('#close-metronome').click();
  await expect(page.locator('#metronome-volume')).toHaveValue('35');await page.reload();await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#fullscreen').click();await page.locator('#metronome').click();await expect(page.locator('#metronome-panel')).toBeVisible();
  await expect(page.locator('#metronome-enabled')).toBeChecked();await expect(page.locator('#metronome-pattern-summary')).toContainText('第 3 拍');
  await page.locator('#close-metronome').click();
  const sample=()=>page.evaluate(()=>{
    pause();reset();document.getElementById('count-in').checked=false;setTempo(60);
    const clicks=[];clickSound=accent=>clicks.push({beat:state.beat,accent});start();cancelAnimationFrame(state.raf);const now=state.lastFrame;
    for(let q=0;q<6;q+=.125)updateClock(now+q*1000);pause();return clicks;
  });
  let clicks=await sample();expect(clicks.map(c=>c.beat)).toEqual([2,5]);expect(clicks.every(c=>!c.accent)).toBe(true);
  await page.locator('#metronome').click();await page.locator('[data-beat-preset="first"]').click();await page.locator('#close-metronome').click();
  clicks=await sample();expect(clicks.map(c=>c.beat)).toEqual([0,3]);expect(clicks.every(c=>c.accent)).toBe(true);
  await page.locator('#metronome').click();await page.getByRole('button',{name:'第 3 拍发声',exact:true}).click();await page.locator('#close-metronome').click();
  clicks=await sample();expect(clicks.map(c=>c.beat)).toEqual([0,2,3,5]);
  await page.locator('#metronome').click();await page.locator('#metronome-enabled').uncheck();await page.locator('#close-metronome').click();expect(await sample()).toEqual([]);
  await page.locator('#metronome').click();await page.screenshot({path:'preview-metronome.png'});
});
