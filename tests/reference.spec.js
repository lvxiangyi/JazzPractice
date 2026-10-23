const {test,expect}=require('@playwright/test');
test('Waltz for Debby is the default; line follows input and scrolls into later systems',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#piece-title')).toHaveText('Waltz for Debby');await expect(page.locator('#measure-total')).toHaveText('40');
  expect(await page.evaluate(()=>state.cursorPoints.length)).toBeGreaterThan(40);
  await page.locator('[data-mode="wait"]').click();
  await page.locator('#play').click();
  await page.evaluate(()=>{for(const n of activeNotes().map(n=>n.midi)){noteOn(n);noteOff(n);}});
  expect(await page.evaluate(()=>state.index)).toBe(1);
  await page.locator('#restart').click();
  await page.evaluate(()=>{reset(state.events.findIndex(e=>e.measure===30));});
  expect(await page.locator('#score-scroll').evaluate(n=>n.scrollTop)).toBeGreaterThan(500);
  const boxes=await page.evaluate(()=>{const a=document.getElementById('playhead').getBoundingClientRect(),b=document.getElementById('score-scroll').getBoundingClientRect();return {top:a.top,bottom:a.bottom,viewTop:b.top,viewBottom:b.bottom};});
  expect(boxes.top).toBeGreaterThanOrEqual(boxes.viewTop);expect(boxes.bottom).toBeLessThanOrEqual(boxes.viewBottom);
  await page.locator('#auto-follow').uncheck();await page.locator('#score-scroll').evaluate(n=>n.scrollTop=0);
  await page.evaluate(()=>reset(state.events.findIndex(e=>e.measure===35)));expect(await page.locator('#score-scroll').evaluate(n=>n.scrollTop)).toBe(0);
  await page.locator('#show-playhead').uncheck();await expect(page.locator('#playhead')).toBeHidden();
  await page.locator('#auto-follow').check();await page.locator('#show-playhead').check();await expect(page.locator('#playhead')).toBeVisible();
  await page.locator('#reference-score').click();await expect(page.locator('#measure')).toHaveText('01');expect(await page.evaluate(()=>state.index)).toBe(0);
  expect(errors).toEqual([]);
});

test('tempo playhead interpolates between notes and page follow changes systems',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('[data-mode="tempo"]').click();await page.locator('#count-in').uncheck();
  const result=await page.evaluate(()=>{
    const i=state.events.findIndex((e,i)=>{const a=state.cursorPoints[e.cursorIndex],b=state.cursorPoints[state.events[i+1]?.cursorIndex];return b&&Math.abs(a.y-b.y)<5&&b.x>a.x;});
    reset(i);start();cancelAnimationFrame(state.raf);
    const e=state.events[i],a=state.cursorPoints[e.cursorIndex],b=state.cursorPoints[state.events[i+1].cursorIndex];
    state.beat=(e.beat+e.end)/2;drawPlayhead();pause();
    return {actual:parseFloat(document.getElementById('playhead').style.left),expected:(a.x+b.x)/2};
  });
  expect(result.actual).toBeCloseTo(result.expected,2);
  await page.locator('#follow-style').selectOption('page');await page.evaluate(()=>reset(state.events.findIndex(e=>e.measure===25)));
  expect(await page.locator('#score-scroll').evaluate(n=>n.scrollTop)).toBeGreaterThan(500);
});

test('fullscreen maximizes sheet, adjustable sidebar and zoom preferences survive reload',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#fullscreen').click();await page.waitForTimeout(350);
  await expect(page.locator('.settings')).toBeHidden();await expect(page.locator('.score-toolbar')).toBeHidden();
  expect(await page.locator('.score-column').evaluate(n=>n.getBoundingClientRect().width)).toBeGreaterThan(1400);
  await page.locator('#score-size').fill('240');await expect(page.locator('#zoom-value')).toHaveText('240%');
  await page.locator('#layout-options summary').click();await page.locator('#show-settings').check();await expect(page.locator('.settings')).toBeVisible();
  await page.locator('#sidebar-size').fill('360');await page.waitForTimeout(250);expect(await page.locator('.settings').evaluate(n=>Math.round(n.getBoundingClientRect().width))).toBe(360);
  await page.locator('#show-settings').uncheck();await page.locator('#layout-options summary').click();await page.waitForTimeout(300);
  await page.screenshot({path:'preview-waltz-fullscreen.png'});
  await page.locator('#fullscreen').click();await page.reload();await expect(page.locator('#play')).toBeEnabled();await expect(page.locator('#zoom-value')).toHaveText('240%');
  await page.locator('#layout-options summary').click();await expect(page.locator('#sidebar-size')).toHaveValue('360');
  await page.locator('#reset-layout').click();await expect(page.locator('#score-size')).toHaveValue('100');
});
