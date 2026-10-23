const {test,expect}=require('@playwright/test');

test('tempo is default; saved volume controls count-in and live clicks including mute',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-mode="tempo"]')).toHaveClass('selected');
  expect(await page.evaluate(()=>state.mode)).toBe('tempo');
  await page.locator('#metronome-volume').fill('40');
  await expect(page.locator('#metronome-volume-value')).toHaveText('40%');
  await page.reload();await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#metronome-volume')).toHaveValue('40');
  await expect(page.locator('#metronome-volume-value')).toHaveText('40%');
  const result=await page.evaluate(()=>{
    const sounds=[];tone=(midi,duration,velocity)=>sounds.push({midi,velocity});
    setTempo(60);start();cancelAnimationFrame(state.raf);const now=state.lastFrame;
    updateClock(now+1000);updateClock(now+2000);
    state.metronome=true;updateClock(now+3000);
    return {sounds,running:state.running,remaining:state.countRemaining};
  });
  expect(result.running).toBe(true);expect(result.remaining).toBe(0);
  expect(result.sounds.map(s=>s.midi)).toEqual([100,96,96,100]);
  for(const [i,sound] of result.sounds.entries())expect(sound.velocity).toBeCloseTo((i===0||i===3?.72:.48)*.4,6);
  await page.locator('#metronome-volume').fill('0');
  expect(await page.evaluate(()=>{let calls=0;tone=()=>calls++;clickSound(true);clickSound(false);return calls;})).toBe(0);
  await page.locator('#metronome-volume').fill('100');
  expect(await page.evaluate(()=>{let velocity;tone=(m,d,v)=>velocity=v;clickSound(true);return velocity;})).toBeCloseTo(.72,6);
  await page.locator('#metronome-volume').fill('200');
  expect(await page.evaluate(()=>{let velocity;tone=(m,d,v)=>velocity=v;clickSound(true);return velocity;})).toBeCloseTo(1.44,6);
});
