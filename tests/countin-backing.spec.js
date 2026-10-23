const {test,expect}=require('@playwright/test');
const ready=async page=>{await page.goto('/');await expect(page.locator('#play')).toBeEnabled();};

test('count-in bars: default 1, persisted, invalid stored value falls back to 1',async({page})=>{
  await ready(page);
  await expect(page.locator('#count-in-bars')).toHaveValue('1');
  await page.locator('#count-in-bars').selectOption('2');await expect(page.locator('#count-in-label')).toContainText('预备 2 小节');
  await page.reload();await expect(page.locator('#play')).toBeEnabled();await expect(page.locator('#count-in-bars')).toHaveValue('2');
  await page.evaluate(()=>{const l=JSON.parse(localStorage.getItem('cadence.layout.v1'));l.countInBars=3;localStorage.setItem('cadence.layout.v1',JSON.stringify(l));});
  await page.reload();await expect(page.locator('#play')).toBeEnabled();await expect(page.locator('#count-in-bars')).toHaveValue('1');
});

test('Afternoon in Paris: 1-bar count-in clicks at 0/500/1000/1500 ms at 120 BPM, pickup enters at 1500; backing waits for bar 1',async({page})=>{
  await ready(page);
  const r=await page.evaluate(async()=>{
    await loadSheet('sheet/Afternoon_In_Paris.musicxml');setTempo(120);document.getElementById('count-in').checked=true;
    const raw=[];let now=0,entry=null;clickSound=()=>raw.push(now||state.lastFrame);
    start();cancelAnimationFrame(state.raf);const t0=state.lastFrame;now=t0;
    for(let t=10;t<=2000;t+=10){now=t0+t;updateClock(now);if(entry===null&&!state.countRemaining)entry=t;}
    pause();const clicks=raw.map(t=>Math.round(t-t0));
    layout.backing=true;prepareBacking();const first=state.backing.notes[0].beat,e0=state.events[0];
    const bar1=state.events.find(e=>e.measure===2).beat;layout.backing=false;
    return {clicks,entry,pickupBeat:e0.beat,first,bar1};
  });
  expect(r.clicks).toEqual([0,500,1000,1500]);expect(r.entry).toBe(1500);
  expect(r.first).toBeGreaterThanOrEqual(r.bar1-1e-6);
});

test('backing on: loading a shorter score after a longer one does not crash and resets the range',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  await ready(page);
  const r=await page.evaluate(async()=>{
    document.getElementById('backing-enabled').click();const out=[];
    for(const f of ['Alfies_Theme','Waltz_for_Debby_bars_1-40','All_Of_Me']){await loadSheet(`sheet/${f}.musicxml`);out.push({f,end:state.endIndex,last:state.events.length-1,title:document.getElementById('piece-title').textContent,notes:!!state.backing.notes});}
    return out;
  });
  for(const x of r)expect(x.end).toBe(x.last);
  expect(r.map(x=>x.notes)).toEqual([true,true,true]);expect(errors).toEqual([]);
});

test('centred follow is the default and keeps the reading line at the viewport centre without jumps',async({page})=>{
  await ready(page);
  await expect(page.locator('#follow-style')).toHaveValue('center');
  const r=await page.evaluate(()=>{
    document.getElementById('count-in').checked=false;setTempo(120);reset();
    const v=document.getElementById('score-scroll'),offs=[],tops=[];start();cancelAnimationFrame(state.raf);let now=state.lastFrame;
    while(state.running){now+=1000/60;updateClock(now);drawPlayhead();if(!state.running)break;
      const p=state.cursorPoints[state.events[state.index].cursorIndex],vr=v.getBoundingClientRect(),sr=document.getElementById('score').getBoundingClientRect();
      const ideal=v.scrollTop+sr.top-vr.top+systemCentre(p)-v.clientHeight/2;
      if(ideal>=0&&ideal<=v.scrollHeight-v.clientHeight)offs.push(Math.abs(sr.top-vr.top+systemCentre(p)-v.clientHeight/2));tops.push(v.scrollTop);}
    const deltas=tops.slice(1).map((t,i)=>t-tops[i]);offs.sort((a,b)=>a-b);
    // Paused: a manual scroll stays put when the same position is redrawn.
    reset(40);v.scrollTop=0;updatePosition();drawPlayhead();
    return {median:offs[Math.floor(offs.length/2)],within:offs.filter(o=>o<=60).length/offs.length,maxDelta:Math.max(...deltas),minDelta:Math.min(...deltas),pausedTop:v.scrollTop,frames:tops.length};
  });
  expect(r.frames).toBeGreaterThan(1000);expect(r.median).toBeLessThan(2);expect(r.within).toBeGreaterThan(.75);
  expect(r.maxDelta).toBeLessThan(10);expect(r.minDelta).toBeGreaterThanOrEqual(0);expect(r.pausedTop).toBe(0);
});

test('展开反复: All of Me written out gives the same notes, chords and beats; setting persists',async({page})=>{
  await ready(page);
  const snap=()=>page.evaluate(()=>({plans:['human','human-2feel'].map(feel=>Backing.plan(Backing.timeline(state.baseEvents,state.leadMeta),0,state.events.at(-1).end,1,{feel,bpm:120,sections:state.leadMeta.sections}).map(n=>`${n.beat}:${n.kind}:${n.midi}:${n.gain}:${n.offsetMs}`).join('|')),sections:state.leadMeta.sections,ev:state.baseEvents.map(e=>`${e.beat.toFixed(6)}:${e.notes.map(n=>n.midi).sort((a,b)=>a-b).join('.')}`),chords:Backing.timeline(state.baseEvents,state.leadMeta).flatMap(v=>v.chords.map(c=>`${c.at.toFixed(6)}:${c.chord.label}`)),bars:state.osmd.Sheet.SourceMeasures.length,labels:[...document.getElementById('range-start').options].map(o=>o.text)}));
  await page.locator('#score-picker').selectOption('sheet/All_Of_Me.musicxml');await expect(page.locator('#piece-title')).toHaveText(/All Of Me/i);
  const off=await snap();
  await page.locator('#unroll-repeats').check();await expect.poll(()=>page.evaluate(()=>state.osmd.Sheet.SourceMeasures.length)).toBe(32);
  const on=await snap();
  expect(on.ev).toEqual(off.ev);expect(on.chords).toEqual(off.chords);expect(off.bars).toBe(24);
  // Repeat-sign sections map to every visit, so the human / 2-feel backing is unchanged.
  expect(on.plans).toEqual(off.plans);expect(off.sections).toEqual([1]);expect(on.sections).toEqual([1,17]);
  expect(on.labels[16]).toBe('第 1 小节（第 2 遍）');
  // Every bar label uses the same name: header, position, review rows.
  const names=await page.evaluate(()=>{reset(state.events.findIndex(e=>e.measure===17));const i=state.index;state.trail=[{target:i,time:0,midi:60,status:'pitch-or-extra',color:'#c4553f'}];renderReview();return {header:$('measure').textContent,position:$('position-label').textContent,review:document.querySelector('#performance-review .review-where').textContent,total:$('measure-total').textContent};});
  expect(names).toEqual({header:'01 · 第 2 遍',position:'第 1 小节（第 2 遍）',review:'第 1 小节（第 2 遍） · 第 1 拍',total:'24'});await expect(page.locator('#score-picker')).toHaveValue('sheet/All_Of_Me.musicxml');
  expect(await page.evaluate(()=>/<repeat|<ending/.test(Unroll.expand(state.sourceXml)))).toBe(false);
  await page.reload();await expect(page.locator('#play')).toBeEnabled();await expect(page.locator('#unroll-repeats')).toBeChecked();
  await expect(page.locator('#piece-title')).toHaveText('Waltz for Debby');
});

test('Afternoon in Paris bar 18: cursor stays on the written notes and the playhead never jumps ahead',async({page})=>{
  await ready(page);
  for(const [style,perLine] of [['center','8'],['line','xml']]){
    const r=await page.evaluate(async([style,perLine])=>{
      layout.followStyle=style;layout.measuresPerLine=perLine;await loadSheet('sheet/Afternoon_In_Paris.musicxml');
      // A chord symbol after bar 17's whole note used to add an invisible cursor stop, shifting every later playhead position by one note.
      const misaligned=state.events.filter(e=>{const p=state.cursorPoints[e.cursorIndex];return p.headX!==undefined&&Math.abs(p.headX-p.x)>8;}).length;
      document.getElementById('count-in').checked=false;setTempo(120);reset();start();cancelAnimationFrame(state.raf);let now=state.lastFrame,back=0,last=null;
      const bar18=state.events.filter(e=>e.measure===19);
      while(state.running){now+=1000/60;updateClock(now);drawPlayhead();
        // Play bar 18 on time: every written note there must be a hit.
        for(const e of bar18)if(!e.played&&state.beat>=e.beat){e.played=true;state.lastFrame=now=performance.now();state.beat=e.beat;e.notes.forEach(n=>{noteOn(n.midi);noteOff(n.midi);});now=state.lastFrame;}
        const line=document.getElementById('playhead'),pos={x:parseFloat(line.style.left),y:parseFloat(line.style.top),i:state.index};
        if(last&&last.y===pos.y&&pos.x<last.x-.5&&pos.i>=last.i)back++;last=pos;}
      const i0=state.events.indexOf(bar18[0]),i1=state.events.indexOf(bar18.at(-1));
      return {misaligned,back,bar18:bar18.map(e=>e.notes.map(n=>n.midi).join('.')),missedInBar:state.missedTargets.length+[...state.noteColors.entries()].filter(([n,c])=>c==='#d97765'&&bar18.some(e=>e.notes.some(x=>x.source===n))).length,hits:state.trail.filter(t=>t.target>=i0&&t.target<=i1&&t.status==='exact').length};
    },[style,perLine]);
    expect(r.misaligned).toBe(0);expect(r.back).toBe(0);expect(r.bar18).toEqual(['77','76','79']);expect(r.missedInBar).toBe(0);expect(r.hits).toBe(3);
  }
});

test('timing tolerance: presets plus a free 40–400 ms slider, persisted and used by the matcher',async({page})=>{
  await ready(page);
  await expect(page.locator('#timing-window')).toHaveValue('200');await expect(page.locator('#timing-window-value')).toHaveText('±200 ms');
  await page.locator('#timing-window-range').fill('150');
  await expect(page.locator('#timing-window')).toHaveValue('custom');await expect(page.locator('#timing-window-value')).toHaveText('±150 ms');
  expect(await page.evaluate(()=>[state.matcher.windowMs,state.matcher.exactMs])).toEqual([150,80]);
  await page.reload();await expect(page.locator('#play')).toBeEnabled();await expect(page.locator('#timing-window-range')).toHaveValue('150');
  await page.locator('#timing-window').selectOption('120');await page.locator('#timing-window').selectOption('custom');
  // 自定义 stays selected with the current value until a preset is chosen.
  await expect(page.locator('#timing-window')).toHaveValue('custom');await expect(page.locator('#timing-window-range')).toHaveValue('120');
  await page.locator('#timing-window').selectOption('80');await expect(page.locator('#timing-window-range')).toHaveValue('80');
  expect(await page.evaluate(()=>[state.matcher.windowMs,state.matcher.exactMs,layout.timingWindow])).toEqual([80,80,80]);
});

test('review: hits colour the written note only; wrong notes sit red at the event; generated left-hand hits sit at the notehead on the bass staff',async({page})=>{
  await ready(page);
  const r=await page.evaluate(()=>{
    document.getElementById('count-in').checked=false;setTempo(60);
    const at=(beat,notes)=>{state.beat=beat;state.lastFrame=performance.now();updateClock(state.lastFrame);notes.forEach(m=>{noteOn(m);noteOff(m);});};
    const sounding=state.events.map((e,i)=>i).filter(i=>state.events[i].notes.length).slice(0,4);
    reset();start();cancelAnimationFrame(state.raf);
    const [a,b,c,d]=sounding.map(i=>state.events[i]);
    at(a.beat,a.notes.map(n=>n.midi));at(b.beat-.12,b.notes.map(n=>n.midi));at(c.beat,[c.notes[0].midi+1]);
    state.beat=d.end+.5;state.lastFrame=performance.now();updateClock(state.lastFrame);pause();
    const fill=e=>{const g=state.osmd.EngravingRules.GNote(e.notes[0].source).getSVGGElement();return (g.querySelector('.vf-notehead path')||g.querySelector('path'))?.getAttribute('fill');};
    const groups=[...document.querySelectorAll('#actual-note-overlay g[data-midi]')].map(g=>({midi:+g.dataset.midi,status:g.dataset.status,cx:+g.querySelector('ellipse').getAttribute('cx')}));
    const pc=state.cursorPoints[c.cursorIndex];
    const original={fills:[a,b,c,d].map(fill),groups,headX:pc.headX,step:pc.staves[0].step,wrongMidi:c.notes[0].midi+1};
    // Level 1: the generated left-hand voicing is drawn at the chord's notehead x on the added bass staff.
    document.getElementById('detection').value='1';changeDetection();reset();start();cancelAnimationFrame(state.raf);
    const k=state.events.findIndex(e=>e.lead?.leftAttack&&e.lead.left.length&&e.notes.length),e=state.events[k];
    at(e.beat,[...e.lead.left,...e.notes.map(n=>n.midi)]);pause();
    const p=state.cursorPoints[e.cursorIndex];
    const left=[...document.querySelectorAll('#actual-note-overlay g[data-midi]')].map(g=>({midi:+g.dataset.midi,status:g.dataset.status,cx:+g.querySelector('ellipse').getAttribute('cx'),cy:+g.querySelector('ellipse').getAttribute('cy')}));
    return {original,left,lead:e.lead.left,headX:p.headX??p.x,bassTop:p.bass.top,trebleBottom:p.staves[0].top+8*p.staves[0].step,melodyFill:fill(e)};
  });
  const o=r.original;
  expect(o.fills).toEqual(['#267b63','#b18631','#d97765','#d97765']);
  expect(o.groups.filter(g=>['exact','early','late','hit'].includes(g.status))).toEqual([]);
  expect(o.groups.length).toBe(1);expect(o.groups[0].status).toBe('pitch-or-extra');expect(o.groups[0].midi).toBe(o.wrongMidi);
  expect(Math.abs(o.groups[0].cx-o.headX)).toBeLessThanOrEqual(2.6*o.step+1);
  expect(r.left.map(g=>g.midi).sort()).toEqual([...r.lead].sort());expect(r.melodyFill).toBe('#267b63');
  for(const g of r.left){expect(g.status).toBe('exact');expect(Math.abs(g.cx-r.headX)).toBeLessThan(.5);expect(g.cy).toBeGreaterThan(r.trebleBottom);expect(g.cy).toBeGreaterThan(r.bassTop-6);}
});

test('pickup is named 弱起; cursor steps map events to the cursor stops',async({page})=>{
  await ready(page);
  const r=await page.evaluate(async()=>{
    await loadSheet('sheet/Afternoon_In_Paris.musicxml');reset();
    // An empty first position (no cursor stop of its own) and a skipped one in the middle both point at the preceding stop.
    return {header:$('measure').textContent,position:$('position-label').textContent,first:$('range-start').options[0].text,steps:cursorSteps([0,1,2,3,3.5,4],[1,2,3,4]),early:cursorSteps([0,.5,1],[0,1])};
  });
  expect(r).toEqual({header:'弱起',position:'弱起小节',first:'弱起小节',steps:[0,0,1,2,2,3],early:[0,0,1]});
});

test('Level 1 review: left-hand notes go to the bass staff (right, wrong, octave up, missed); melody mistakes stay on the treble staff',async({page})=>{
  await ready(page);
  const r=await page.evaluate(()=>{
    document.getElementById('count-in').checked=false;setTempo(60);document.getElementById('detection').value='1';changeDetection();reset();start();cancelAnimationFrame(state.raf);
    const at=(beat,notes)=>{state.beat=beat;state.lastFrame=performance.now();updateClock(state.lastFrame);notes.forEach(m=>{noteOn(m);noteOff(m);});};
    const plan=['correct','oneWrong','octaveUp','skipped','wrongPc','correct'],wrongMelody=[];
    for(let bar=1;bar<=6;bar++){
      const e=state.events.find(e=>e.measure===bar&&e.lead?.leftAttack&&e.lead.left.length),left=e.lead.left,mel=e.lead.melody?.midi,kind=plan[bar-1];
      const play=kind==='correct'?left:kind==='oneWrong'?[left[0],left[1]+1]:kind==='octaveUp'?left.map(m=>m+12):kind==='skipped'?[]:left.map(m=>m+1);
      const melody=mel==null?[]:bar===5?[mel+1]:[mel];if(bar===5)wrongMelody.push(mel+1);
      at(e.beat,[...play,...melody]);
    }
    state.beat=state.events.find(e=>e.measure===7).beat;state.lastFrame=performance.now();updateClock(state.lastFrame);pause();
    const p=state.cursorPoints[0],trebleBottom=p.staves[0].top+8*p.staves[0].step;
    const groups=[...document.querySelectorAll('#actual-note-overlay g[data-midi]')].map(g=>{const el=g.querySelector('ellipse');return {midi:+g.dataset.midi,status:g.dataset.status,bass:+el.getAttribute('cy')>trebleBottom,hollow:el.getAttribute('fill')==='none',color:g.getAttribute('fill')};});
    return {groups,wrongMelody,hands:state.trail.map(t=>t.hand)};
  });
  const melody=r.groups.filter(g=>r.wrongMelody.includes(g.midi)&&!g.hollow),left=r.groups.filter(g=>!melody.includes(g));
  expect(melody.map(g=>[g.bass,g.color])).toEqual([[false,'#c4553f']]);
  expect(left.every(g=>g.bass)).toBe(true);
  expect(left.filter(g=>g.status==='exact'&&g.color==='#267b63').map(g=>g.midi)).toEqual([45,52,48,42,48]);
  expect(left.filter(g=>g.status==='pitch-or-extra'&&g.color==='#c4553f').map(g=>g.midi)).toEqual([54,58,65,44,50]);
  expect(left.filter(g=>g.hollow).length).toBeGreaterThanOrEqual(5);
});
