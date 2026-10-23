const {test,expect}=require('@playwright/test');
test('MIDI failures distinguish permission denial from device initialization errors',async({page})=>{
  await page.addInitScript(()=>{navigator.requestMIDIAccess=async()=>{throw new DOMException('Permission denied','NotAllowedError');};});
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.evaluate(()=>loadScore(makeDemo(),'fixture',true));
  await page.locator('#connect').click();await expect(page.locator('#device-label')).toHaveText('MIDI 权限被阻止');await expect(page.locator('#midi-hint')).toContainText('NotAllowedError');
  await page.evaluate(()=>{navigator.requestMIDIAccess=async()=>{throw new DOMException('MIDI backend unavailable','InvalidStateError');};});
  await page.locator('#connect').click();await expect(page.locator('#device-label')).toHaveText('MIDI 初始化失败');await expect(page.locator('#midi-hint')).toContainText('InvalidStateError');await expect(page.locator('#connect')).toBeEnabled();
});
test('score, wait mode, chords, MIDI, tempo, import and responsive layout',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.testPort={state:'connected',name:'Test Digital Piano',onmidimessage:null};
    window.testMidi={inputs:new Map([['piano',window.testPort]]),onstatechange:null};
    navigator.requestMIDIAccess=async()=>window.testMidi;
  });
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.evaluate(()=>loadScore(makeDemo(),'fixture',true));
  await page.locator('[data-mode="wait"]').click();
  await expect(page.locator('#score svg')).toHaveCount(1);
  await expect(page.locator('#expected')).toContainText('E4');await expect(page.locator('#expected')).toContainText('C3');
  await page.screenshot({path:'preview-desktop.png',fullPage:true});
  await page.waitForTimeout(350); // Full-page capture can resize the viewport; let layout settle.
  await page.locator('#connect').click();await expect(page.locator('#device-label')).toContainText('Test Digital Piano');
  await page.locator('#play').click();
  const send=async(n,v=90)=>page.evaluate(({n,v})=>window.testPort.onmidimessage({data:[0x90,n,v]}),{n,v});
  await send(61);await send(61,0);await expect(page.locator('#missed')).toHaveText('1');
  await send(64);await send(64,0);expect(await page.evaluate(()=>state.index)).toBe(0);
  await send(48);await send(48,0);expect(await page.evaluate(()=>state.index)).toBe(1);await expect(page.locator('#correct')).toHaveText('2');
  await page.locator('#restart').click();await page.selectOption('#hand','right');await page.locator('#play').click();await send(64);await send(64,0);expect(await page.evaluate(()=>state.index)).toBe(1);
  await page.locator('#restart').click();await page.locator('[data-mode="tempo"]').click();await page.locator('#count-in').uncheck();await page.locator('#tempo').fill('200');await page.locator('#play').click();await page.waitForTimeout(700);expect(await page.evaluate(()=>state.index)).toBeGreaterThan(0);expect(Number(await page.locator('#missed').textContent())).toBeGreaterThan(0);
  await page.locator('#restart').click();await page.locator('#zoom-in').click();await expect(page.locator('#score svg')).toHaveCount(1);
  await page.locator('#listen').click();await page.waitForTimeout(400);await expect(page.locator('#correct')).toHaveText('0');await expect(page.locator('#missed')).toHaveText('0');await page.locator('#restart').click();
  const xml=await page.evaluate(()=>makeDemo());
  await page.locator('#file').setInputFiles({name:'new.musicxml',mimeType:'application/xml',buffer:Buffer.from(xml.replaceAll('Ode to Joy','Imported Score'))});await expect(page.locator('#piece-title')).toHaveText('Imported Score');
  await page.locator('#file').setInputFiles({name:'broken.xml',mimeType:'application/xml',buffer:Buffer.from('broken')});await expect(page.locator('#toast')).toContainText('有效');await expect(page.locator('#piece-title')).toHaveText('Imported Score');
  const JSZip=require('jszip');const zip=new JSZip();zip.file('META-INF/container.xml','<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>');zip.file('score.xml',xml.replaceAll('Ode to Joy','Compressed Score'));
  await page.locator('#file').setInputFiles({name:'score.mxl',mimeType:'application/octet-stream',buffer:await zip.generateAsync({type:'nodebuffer'})});await expect(page.locator('#piece-title')).toHaveText('Compressed Score');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);await page.screenshot({path:'preview-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('completion, pause/resume, rests and tied notes',async({page})=>{
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.evaluate(()=>loadScore(makeDemo(),'fixture',true));
  await page.locator('[data-mode="wait"]').click();
  // A true tie must not require the same pitch to be attacked a second time.
  const xml='<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/><type>quarter</type><notations><tied type="start"/></notations></note><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/><type>quarter</type><notations><tied type="stop"/></notations></note><note><rest/><duration>1</duration><type>quarter</type></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>';
  await page.locator('#file').setInputFiles({name:'ties.xml',mimeType:'application/xml',buffer:Buffer.from(xml)});await expect(page.locator('#piece-title')).toHaveText('ties');
  await page.locator('#count-in').uncheck();await page.locator('#tempo').fill('200');await page.locator('#play').click();await page.locator('[data-midi="60"]').click();
  await expect(page.locator('#expected')).toHaveText('待弹 D4',{timeout:3000});
  await page.locator('[data-midi="62"]').click();await expect(page.locator('#result')).toBeVisible();await expect(page.locator('#accuracy')).toHaveText('100%');await expect(page.locator('#correct')).toHaveText('2');
  await page.locator('#close-result').click();await page.locator('#demo').click();await expect(page.locator('#piece-title')).toHaveText('欢乐颂');
  await page.locator('[data-mode="tempo"]').click();await page.locator('#play').click();await page.locator('#play').click();
  await page.locator('#count-in').uncheck();await page.evaluate(()=>state.countRemaining=0);const before=await page.evaluate(()=>state.beat);await page.waitForTimeout(350);expect(await page.evaluate(()=>state.beat)).toBe(before);
  await page.locator('#play').click();await page.waitForTimeout(300);expect(await page.evaluate(()=>state.beat)).toBeGreaterThan(before);
});
