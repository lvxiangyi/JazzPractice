const {test,expect}=require('@playwright/test');

test('reference line moves to barline at system end, selected range end and score end, retaining its final position',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  await page.locator('[data-mode="tempo"]').click();await page.locator('#count-in').uncheck();
  const result=await page.evaluate(()=>{
    const cross=state.events.findIndex((e,i)=>{const a=state.cursorPoints[e.cursorIndex],b=state.cursorPoints[state.events[i+1]?.cursorIndex];return b&&Math.abs(a.y-b.y)>5;});
    function sample(index,rangeEnd=false){
      reset(index);if(rangeEnd)state.endIndex=index;start();cancelAnimationFrame(state.raf);
      const e=state.events[index],p=state.cursorPoints[e.cursorIndex];
      state.beat=e.beat+(e.end-e.beat)*.5;drawPlayhead();const middle=parseFloat(document.getElementById('playhead').style.left);
      state.beat=e.beat+(e.end-e.beat)*.95;drawPlayhead();const late=parseFloat(document.getElementById('playhead').style.left);
      pause();drawPlayhead();const paused=parseFloat(document.getElementById('playhead').style.left);
      return {start:p.x,end:p.endX,middle,late,paused};
    }
    const row=sample(cross),range=sample(0,true);state.endIndex=state.events.length-1;
    const final=sample(state.events.length-1);finish();drawPlayhead();
    return {row,range,final,complete:state.completed,finalX:parseFloat(document.getElementById('playhead').style.left)};
  });
  for(const item of [result.row,result.range,result.final]){
    expect(item.end).toBeGreaterThan(item.start+5);expect(item.middle).toBeGreaterThan(item.start);expect(item.late).toBeGreaterThan(item.middle);expect(item.paused).toBeCloseTo(item.late,3);
  }
  expect(result.complete).toBe(true);expect(result.finalX).toBeCloseTo(result.final.end,3);
});

test('3/4 reference count-in sounds three quarter notes; pause resumes remaining pulses',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('[data-mode="tempo"]').click();await page.locator('#tempo').fill('60');
  await expect(page.locator('#count-in-label')).toContainText('3/4 · 3 下');
  const result=await page.evaluate(()=>{
    const clicks=[];clickSound=accent=>clicks.push({accent,remaining:state.countRemaining});
    start();cancelAnimationFrame(state.raf);let now=state.lastFrame;
    updateClock(now+500);updateClock(now+1000);updateClock(now+1400);
    pause();const countBefore=clicks.length;start();cancelAnimationFrame(state.raf);now=state.lastFrame;
    updateClock(now+590);const stillTwo=clicks.length;updateClock(now+610);updateClock(now+1590);
    const beforeEnd={clicks:clicks.length,remaining:state.countRemaining,beat:state.beat};updateClock(now+1610);
    return {clicks,countBefore,stillTwo,beforeEnd,remaining:state.countRemaining,beat:state.beat};
  });
  expect(result.countBefore).toBe(2);expect(result.stillTwo).toBe(2);expect(result.clicks.map(c=>c.accent)).toEqual([true,false,false]);expect(result.beforeEnd.remaining).toBeGreaterThan(0);expect(result.beforeEnd.beat).toBe(0);expect(result.remaining).toBe(0);expect(result.beat).toBeCloseTo(.01,2);
});

test('meter changes control count-in, denominator timing, loop restart and live metronome',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  const result=await page.evaluate(async()=>{
    const meters=[[3,4,6,'half'],[2,4,4,'half'],[6,8,6,'half'],[4,4,8,'whole']];
    const xml=`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${meters.map(([beats,den,duration,type],i)=>`<measure number="${i+1}"><attributes><divisions>2</divisions><time><beats>${beats}</beats><beat-type>${den}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><type>${type}</type>${duration===6?'<dot/>':''}</note></measure>`).join('')}</part></score-partwise>`;
    await loadScore(xml,'Meters');if(state.events.length!==4)throw new Error('Meter fixture failed to load');state.mode='tempo';setTempo(60);const summaries=[];
    for(let index=0;index<4;index++){
      reset(index);const clicks=[];clickSound=accent=>clicks.push(accent);start();cancelAnimationFrame(state.raf);
      const now=state.lastFrame,total=state.countTotal;
      for(let q=.125;q<total;q+=.125)updateClock(now+q*1000);
      summaries.push({clicks:[...clicks],total,unit:state.countUnit,stillWaiting:state.countRemaining>0});pause();
    }
    state.startIndex=2;state.endIndex=2;reset();document.getElementById('loop').checked=true;start();cancelAnimationFrame(state.raf);finish();
    const loop={count:state.countRemaining,unit:state.countUnit,pass:state.pass};
    document.getElementById('loop').checked=false;document.getElementById('count-in').checked=false;state.startIndex=0;state.endIndex=3;reset(2);state.metronome=true;
    const live=[];clickSound=accent=>live.push(accent);start();cancelAnimationFrame(state.raf);const now=state.lastFrame;updateClock(now);
    for(let q=.125;q<3;q+=.125)updateClock(now+q*1000);
    pause();return {summaries,loop,live};
  });
  expect(result.summaries.map(x=>x.clicks.length)).toEqual([3,2,6,4]);expect(result.summaries.map(x=>x.total)).toEqual([3,2,3,4]);expect(result.summaries.map(x=>x.unit)).toEqual([1,1,.5,1]);expect(result.summaries.every(x=>x.stillWaiting)).toBe(true);
  expect(result.loop).toEqual({count:3,unit:.5,pass:2});expect(result.live).toEqual([true,false,false,false,false,false]);
});
