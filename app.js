'use strict';
const $ = id => document.getElementById(id);
const state = { osmd:null, events:[], staffIds:[], index:0, mode:'tempo', hand:'both', bpm:80, originalBpm:80, running:false, listening:false, correct:0, wrong:0, missed:0, streak:0, best:0, hits:new Set(), held:new Set(), beat:0, lastFrame:0, lastClick:-1, metronome:false, metronomeVolume:1, zoom:1, loading:false, midi:null, audio:null, voices:new Set(), markerNodes:[], restUntil:0, raf:0 };
try{const saved=localStorage.getItem('cadence.metronomeVolume');if(saved!==null&&Number.isFinite(Number(saved)))state.metronomeVolume=Math.max(0,Math.min(2,Number(saved)));}catch{}
state.metronomePatterns={};state.lastPlayed=[];
state.clockHistory=[];state.attempts=[];state.trail=[];state.missedTargets=[];state.latencyMs=0;state.calibration=null;
try{const saved=Number(localStorage.getItem('cadence.latencyMs'));if(Number.isFinite(saved))state.latencyMs=Math.max(0,Math.min(400,Math.round(saved)));}catch{}
const TRAIL_COLORS={exact:'#267b63',early:'#b18631',late:'#b18631',hit:'#267b63','outside-window':'#c4553f','pitch-or-extra':'#c4553f',accompaniment:'#2965b5',ignored:'#2965b5'};
try{const saved=JSON.parse(localStorage.getItem('cadence.metronome.v1')||'{}');state.metronome=saved.enabled===true;if(saved.patterns&&typeof saved.patterns==='object')state.metronomePatterns=saved.patterns;}catch{}
Object.assign(state,{matcher:null,startIndex:0,endIndex:0,sessionStart:0,expireIndex:0,countRemaining:0,pass:1,exact:0,early:0,late:0,noteColors:new Map(),completed:false});
Object.assign(state,{baseEvents:[],leadMeta:{harmonies:[],meters:[]},level:0,anchor:'chord',rhythm:'straight'});
const REFERENCE_SCORE='sheet/Waltz_for_Debby_bars_1-40.musicxml';
const layoutDefaults={zoom:1,sidebar:270,height:800,settings:true,fullscreenSettings:false,compact:false,fullscreenCompact:true,keyboard:true,playhead:true,follow:true,followStyle:'center',liveNotes:false,lineFollow:true,centerFollow:true,unrollRepeats:false,timingWindow:200,timingCustom:false,measuresPerLine:'8',octaveRule:'strict',backing:false,backingBass:true,backingDrums:true,backingVolume:.8,backingFeel:'human',countInBars:1};
let layout={...layoutDefaults};
try{const saved=JSON.parse(localStorage.getItem('cadence.layout.v1')||'{}');for(const key of Object.keys(layoutDefaults))if(typeof saved[key]===typeof layoutDefaults[key])layout[key]=saved[key];}catch{}
layout.zoom=Math.max(.7,Math.min(3.5,layout.zoom));layout.sidebar=Math.max(200,Math.min(440,layout.sidebar));layout.height=Math.max(500,Math.min(1400,layout.height));state.zoom=layout.zoom;
// Line-by-line follow became the default later; older saved layouts switch to it once.
if(!layout.lineFollow){layout.followStyle='line';layout.lineFollow=true;}
// Centred continuous follow replaced it as the default; switch older layouts once, later choices are kept.
if(!layout.centerFollow){layout.followStyle='center';layout.centerFollow=true;}
if(!['center','line','smooth','page'].includes(layout.followStyle))layout.followStyle='center';
layout.timingWindow=Number.isFinite(layout.timingWindow)?Math.max(40,Math.min(400,Math.round(layout.timingWindow/10)*10)):200;
if(!['4','8','xml'].includes(layout.measuresPerLine))layout.measuresPerLine='8';
if(!['strict','left','all'].includes(layout.octaveRule))layout.octaveRule='strict';
if(!['simple','human','human-2feel'].includes(layout.backingFeel))layout.backingFeel='human';
if(![1,2].includes(layout.countInBars))layout.countInBars=1;
// Fixed bars per line override the file's own line breaks; 'xml' keeps them.
function applySystemLayout(osmd){const fixed=layout.measuresPerLine!=='xml';osmd.EngravingRules.RenderXMeasuresPerLineAkaSystem=fixed?Number(layout.measuresPerLine):0;osmd.EngravingRules.NewSystemAtXMLNewSystemAttribute=!fixed;}
state.cursorPoints=[];state.followTarget=null;
const names = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const noteName = midi => names[midi % 12] + (Math.floor(midi / 12) - 1);
let toastTimer, resizeTimer;
function toast(message) { $('toast').textContent=message; $('toast').style.display='block'; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').style.display='none',4500); }
function feedback(message) { $('feedback').textContent=message; }
function makeDemo() {
  const melody = [[64,64,65,67],[67,65,64,62],[60,60,62,64],[64,62,62],[64,64,65,67],[67,65,64,62],[60,60,62,64],[62,60,60]];
  const bass = [[48,55],[48,55],[53,55],[55,50],[48,55],[48,55],[53,55],[55,48]];
  const steps=['C','C','D','D','E','F','F','G','G','A','A','B'];
  function note(n,d,staff) { return `<note><pitch><step>${steps[n%12]}</step><octave>${Math.floor(n/12)-1}</octave></pitch><duration>${d}</duration><voice>${staff}</voice><type>${d===2?'half':'quarter'}</type><stem>${staff===1?'up':'down'}</stem><staff>${staff}</staff></note>`; }
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Ode to Joy</work-title></work><identification><creator type="composer">Ludwig van Beethoven</creator></identification><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults><part-list><score-part id="P1"><part-name>Piano</part-name><part-abbreviation>Pno.</part-abbreviation><score-instrument id="I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1">${melody.map((bar,i)=>`<measure number="${i+1}">${i===4?'<print new-system="yes"/>':''}${i===0?'<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction placement="above"><direction-type><words>Andante, con calma</words></direction-type><sound tempo="80"/></direction>':''}${bar.map((n,j)=>note(n,bar.length===3&&j===2?2:1,1)).join('')}<backup><duration>4</duration></backup>${bass[i].map(n=>note(n,2,2)).join('')}${i===7?'<barline location="right"><bar-style>light-heavy</bar-style></barline>':''}</measure>`).join('')}</part></score-partwise>`;
}
function buildEvents(osmd) {
  const events=[];
  const it=osmd.cursor.Iterator.clone();it.SkipInvisibleNotes=osmd.cursor.Iterator.SkipInvisibleNotes;
  // cursor.next() skips positions without visible voice entries (e.g. a chord symbol placed after a bar's last note), so cursorIndex is taken from the cursor's own stops, matched by time.
  const stops=[],cursorIt=osmd.cursor.Iterator.clone();cursorIt.SkipInvisibleNotes=it.SkipInvisibleNotes;
  for(let g=0;!cursorIt.EndReached&&g<40000;g++){stops.push(cursorIt.CurrentEnrolledTimestamp.RealValue*4);cursorIt.moveToNextVisibleVoiceEntry(false);}
  let guard=0;
  while(!it.EndReached && guard++ < 40000) {
    // Positions without any voice entry carry no notes (only a chord symbol's timestamp).
    if(!(it.CurrentVoiceEntries||[]).length){it.moveToNext();continue;}
    const notes=(it.CurrentVoiceEntries||[]).flatMap(v=>v.Notes||[]).filter(n=>!n.isRest() && n.Pitch && !n.IsGraceNote && (!n.NoteTie || n.NoteTie.StartNote===n));
    const beat=it.CurrentEnrolledTimestamp.RealValue*4;
    const allNotes=(it.CurrentVoiceEntries||[]).flatMap(v=>v.Notes||[]);
    events.push({beat,cursorIndex:0,relativeBeat:it.CurrentRelativeInMeasureTimestamp.RealValue*4,measureDuration:it.CurrentMeasure.Duration.RealValue*4,eighth:allNotes.some(n=>Math.abs(n.Length.RealValue*4-.5)<1e-6&&!n.NoteTuplet),swingBlocked:allNotes.some(n=>!!n.NoteTuplet||n.Length.RealValue*4<.5), measure:it.CurrentMeasureIndex+1, notes:notes.map(n=>({midi:Math.round(69+12*Math.log2(n.Pitch.Frequency/440)), staff:n.ParentStaff.Id, duration:n.Length.RealValue*4, source:n})), duration:Math.max(.25,...allNotes.map(n=>n.Length.RealValue*4))});
    it.moveToNext();
  }
  if(guard>=40000) throw new Error('乐谱过长，请导入较短的练习片段。');
  if(!events.some(e=>e.notes.length)) throw new Error('未找到可练习的有音高音符。');
  events.forEach((e,i)=>e.end=events[i+1]?.beat ?? e.beat+e.duration);
  cursorSteps(events.map(e=>e.beat),stops).forEach((step,i)=>events[i].cursorIndex=step);
  return events;
}
// Index of the last cursor stop at or before each (ascending) event time; an event before the first stop uses stop 0.
function cursorSteps(times,stops){let j=0;return times.map(t=>{while(j+1<stops.length&&stops[j+1]<=t+1e-9)j++;return j;});}
async function loadScore(xml, fileName='示例曲', demo=false) {
  if(state.loading) return;
  pause(); state.loading=true; $('play').disabled=true; $('listen').disabled=true; $('loading').hidden=false;
  let candidate, host;const sourceXml=xml;
  try {
    let doc=new DOMParser().parseFromString(xml,'text/xml');
    if(doc.querySelector('parsererror') || doc.documentElement.tagName!=='score-partwise') throw new Error('请导入有效的 MusicXML partwise 乐谱（.xml、.musicxml 或 .mxl）。');
    if(doc.querySelectorAll('note').length>20000) throw new Error('这个乐谱过大，请导出较短的练习片段。');
    // 展开反复 rewrites only the in-memory copy; everything below reads the written-out (linear) score.
    let unrolled=null;
    // Section starts (rehearsal marks, double bars, repeat signs) are read from the notation as written, before the repeat signs are removed.
    const sourceSections=LeadSheet.parse(doc).sections;
    if(layout.unrollRepeats){unrolled=Unroll.expandDoc(doc);doc=unrolled.doc;if(unrolled.unrolled)xml=new XMLSerializer().serializeToString(doc);if(doc.querySelectorAll('note').length>20000)throw new Error('展开反复后乐谱过大，请关闭「展开反复」。');}
    host=document.createElement('div'); host.id='score-staging'; host.style.width=$('score').clientWidth+'px'; host.style.position='absolute'; host.style.visibility='hidden'; document.body.append(host);
    candidate=new opensheetmusicdisplay.OpenSheetMusicDisplay(host,{autoResize:false,backend:'svg',drawTitle:false,drawSubtitle:false,drawComposer:false,drawPartNames:false,drawPartAbbreviations:false,drawCredits:false,drawMetronomeMarks:true,drawingParameters:'default',newSystemFromXML:true,cursorsOptions:[{type:0,color:'#62b398',alpha:0.20,follow:false}]});
    candidate.Zoom=.9*state.zoom;applySystemLayout(candidate);
    // Melody-only scores get room under each line for the left-hand staff drawn in the review.
    const melodyOnly=doc.querySelectorAll('score-part').length===1&&![...doc.querySelectorAll('staves')].some(n=>Number(n.textContent)>1);
    if(melodyOnly)candidate.EngravingRules.MinSkyBottomDistBetweenSystems=14;
    await candidate.load(xml); candidate.render(); candidate.cursor.reset();
    const events=buildEvents(candidate);
    host.id='score-content'; host.style.cssText=melodyOnly?'position:relative;padding-bottom:110px':'position:relative';
    $('score').replaceChildren(host); host=null;
    state.noteColors.clear();state.osmd=candidate;state.fifths=Number(doc.querySelector('key fifths')?.textContent)||0;state.baseEvents=events;state.leadMeta=LeadSheet.parse(doc);
    // Every visit of a section-start bar starts a section in the written-out score too, so the backing phrases exactly as with repeats.
    if(unrolled?.unrolled)state.leadMeta.sections=unrolled.order.flatMap((source,i)=>sourceSections.includes(source+1)?[i+1]:[]);state.level=0;state.anchor='chord';state.rhythm='straight';$('detection').value='0';$('anchor').value='chord';$('rhythm').value='straight';$('rule-error').hidden=true;state.events=events;state.staffIds=[...new Set(events.flatMap(e=>e.notes.map(n=>n.staff)))].sort((a,b)=>a-b);
    state.hand='both';$('hand').value='both';
    // A melody-only lead sheet has no written accompaniment, so a pianist's left hand must not be scored as wrong notes.
    $('allow-accompaniment').checked=state.staffIds.length<2;
    $('anchor').disabled=true;$('rule-help').textContent='保留原谱。Lead Sheet 模式从和弦标记生成检测目标；左手按换和弦时检测。';
    const title=doc.querySelector('work-title, movement-title')?.textContent || fileName.replace(/\.(xml|musicxml|mxl)$/i,'');
    $('piece-title').textContent=demo?'欢乐颂':title; $('paper-title').textContent=title;
    const composer=doc.querySelector('creator[type="composer"]')?.textContent || '我的乐谱';
    const time=doc.querySelector('time'); const signature=time?`${time.querySelector('beats')?.textContent}/${time.querySelector('beat-type')?.textContent} 拍`:'';
    $('piece-subtitle').textContent=demo?'贝多芬 · 入门改编 · C 大调 · 4/4 拍':`${composer} · ${signature} · MusicXML`;
    $('paper-credit').textContent=demo?'欢乐颂 · Ludwig van Beethoven':composer;
    state.originalBpm=Math.round(Number(doc.querySelector('sound[tempo]')?.getAttribute('tempo'))||80);
    // The range must describe the new events before setTempo re-plans the backing over it.
    // Written-out bars keep their printed number; a second visit says which pass it is.
    // Bars are named by their printed number (and pass when repeats are written out); the pickup is 弱起.
    const printed=[...(doc.querySelector('score-partwise > part')?.children||[])].filter(n=>n.tagName==='measure').map((m,i)=>m.getAttribute('number')||String(i+1));
    state.barNames=Array.from({length:candidate.Sheet.SourceMeasures.length},(_,i)=>({number:unrolled?.labels?.[i]?.number??printed[i]??String(i+1),pass:unrolled?.labels?.[i]?.pass||1,pickup:i===0&&pickupPad(events[0])>0}));
    setupRange();setTempo(state.originalBpm); $('original-tempo').textContent=`原速 ${state.originalBpm}`;
    $('measure-total').textContent=String(state.barNames.at(-1)?.number??candidate.Sheet.SourceMeasures.length).padStart(2,'0');
    state.sourceXml=sourceXml;state.sourceName=fileName;state.sourceDemo=demo;
    bindScoreNotes();cacheCursorPoints();
    renderBackingStatus();
    reset();
    if(!demo) toast(unrolled?.unrolled&&unrolled.jumps?`已载入「${title}」· 只展开了反复与房子，D.C. / D.S. / Coda 跳转保持原样`:`已载入「${title}」${unrolled?.unrolled?' · 已展开反复':''}`);
  } catch(error) { toast(error.message||'乐谱读取失败，请检查文件。'); console.error(error); }
  finally { host?.remove(); state.loading=false; $('loading').hidden=true; $('play').disabled=!state.events.length; $('listen').disabled=!state.events.length; }
}
async function readFile(file) {
  if(!file) return;
  if(state.loading) return toast('正在处理上一份乐谱，请稍候。');
  if(file.size>10*1024*1024) return toast('请使用小于 10 MB 的乐谱文件。');
  try {
    let xml;
    if(/\.mxl$/i.test(file.name)) {
      const zip=await JSZip.loadAsync(file);
      const manifest=zip.file('META-INF/container.xml');
      if(!manifest) throw new Error('MXL 文件缺少 container.xml。');
      const doc=new DOMParser().parseFromString(await manifest.async('string'),'text/xml');
      const path=doc.querySelector('rootfile')?.getAttribute('full-path');
      if(!path||!zip.file(path)) throw new Error('MXL 中找不到乐谱文件。');
      // Reject unexpectedly large expanded files before materializing their contents.
      if(zip.file(path)._data?.uncompressedSize>20*1024*1024) throw new Error('解压后的乐谱过大。');
      xml=await zip.file(path).async('string');
    } else xml=await file.text();
    await loadScore(xml,file.name);
  } catch(error) { toast(error.message||'无法读取这个文件。'); }
  $('file').value='';
}
function activeNotes(event=state.events[state.index]) {
  if(!event) return [];
  if(state.level&&event.lead) {
    let targets=event.lead.targets;
    if(event===state.events[state.sessionStart]&&!event.lead.leftAttack)targets=[...targets,...event.lead.left.map(midi=>({midi,hand:'left',duration:1}))];
    return targets.filter(n=>state.hand==='both'||n.hand===state.hand);
  }
  const wanted=state.hand==='right'?state.staffIds[0]:state.staffIds[1];
  return event.notes.filter(n=>state.hand==='both'||n.staff===wanted);
}
function pitches() { return [...new Set(activeNotes().map(n=>n.midi))]; }
function stats() {
  const total=state.correct+state.wrong+state.missed;
  $('accuracy').textContent=total?Math.round(state.correct/total*100)+'%':'—';
  $('correct').textContent=state.correct; $('missed').textContent=state.wrong+state.missed; $('streak').textContent=state.streak;
  $('on-time').textContent=state.exact;$('early').textContent=state.early;$('late').textContent=state.late;
}
// One name per bar for every label: printed number, the pass when repeats are written out, 弱起 for a pickup.
function barLabel(measure){const bar=state.barNames?.[measure-1];if(!bar)return `第 ${measure} 小节`;return bar.pickup?'弱起小节':`第 ${bar.number} 小节${bar.pass>1?`（第 ${bar.pass} 遍）`:''}`;}
function setupRange() {
  const count=state.osmd.Sheet.SourceMeasures.length;
  for(const id of ['range-start','range-end']) {
    $(id).replaceChildren(...Array.from({length:count},(_,i)=>new Option(barLabel(i+1),i+1)));
  }
  $('range-end').value=count;$('loop').checked=false;state.startIndex=0;state.endIndex=state.events.length-1;
}
function changeRange() {
  let start=Number($('range-start').value),end=Number($('range-end').value);
  if(end<start){end=start;$('range-end').value=end;}
  state.startIndex=state.events.findIndex(e=>e.measure>=start);
  if(state.startIndex<0)state.startIndex=0;
  state.endIndex=state.events.length-1;
  // A selected section uses its first contiguous visit; whole-score playback retains repeats.
  if(start!==1||end!==state.osmd.Sheet.SourceMeasures.length) {
    const next=state.events.findIndex((e,i)=>i>state.startIndex&&(e.measure>end||e.measure<start));
    if(next!==-1)state.endIndex=next-1;
  }
  reset();
}
function bindScoreNotes() {
  $('score').querySelectorAll('[data-event-index]').forEach(n=>delete n.dataset.eventIndex);
  state.events.forEach((event,index)=>event.notes.forEach(note=>{
    const graphic=state.osmd.EngravingRules.GNote(note.source);
    const element=graphic?.getSVGGElement();
    if(element&&element.dataset.eventIndex===undefined){element.dataset.eventIndex=index;element.style.cursor='pointer';}
  }));
}
// Octave rule: 'left' lets left-hand targets (Lead Sheet voicing or the lower staff) match in any octave; 'all' extends that to the melody.
const isLeftTarget=n=>n.hand==='left'||n.hand===undefined&&state.staffIds.length>1&&n.staff===state.staffIds[1];
function samePitch(note,target,played){
  if(target===played)return true;
  const free=layout.octaveRule==='all'||layout.octaveRule==='left'&&isLeftTarget(note);
  return free&&(target-played)%12===0;
}
function colorNote(index,key,color) {
  activeNotes(state.events[index]).filter(n=>n.source&&(n.key??n.midi)===key).forEach(n=>{
    state.noteColors.set(n.source,color);state.osmd.EngravingRules.GNote(n.source)?.setColor(color,{applyToNoteheads:true,applyToStem:false,applyToBeams:false});
  });
}
function clearColors() {
  state.noteColors.forEach((_,note)=>state.osmd?.EngravingRules.GNote(note)?.setColor(note.NoteheadColorXml||'#000000',{applyToNoteheads:true,applyToStem:false,applyToBeams:false}));
  state.noteColors.clear();
}
function positionCursor(index) {
  state.osmd.cursor.reset();for(let i=0;i<(state.events[index]?.cursorIndex||0);i++)state.osmd.cursor.next();
}
function cacheCursorPoints() {
  const cursor=state.osmd.cursor;cursor.reset();cursor.show();
  const origin=$('score').getBoundingClientRect();state.cursorPoints=[];
  // Stave-line paths give the actual barline x, without including overhanging lyrics or chord labels.
  const staffLines=[...$('score').querySelectorAll('g.vf-measure > path')].map(n=>n.getBoundingClientRect()).filter(r=>r.width>20&&r.height<3).map(r=>({left:r.left-origin.left,right:r.right-origin.left,y:r.top-origin.top}));
  const steps=Math.max(0,...state.baseEvents.map(e=>e.cursorIndex))+1;
  for(let i=0;i<steps;i++) {
    const rect=cursor.cursorElement.getBoundingClientRect();
    const point={x:rect.left-origin.left+rect.width/2,y:rect.top-origin.top,height:rect.height};
    const stave=staffLines.find(r=>r.left<=point.x+1&&r.right>point.x+1&&r.y>=point.y-2&&r.y<=point.y+point.height+2);
    point.endX=stave?.right??point.x;
    state.cursorPoints.push(point);
    if(i<steps-1)cursor.next();
  }
  positionCursor(Math.min(state.index,state.events.length-1));
  // Notehead centres let the review put an on-time note exactly over the written one.
  for(const event of state.baseEvents){
    const point=state.cursorPoints[event.cursorIndex],element=event.notes[0]&&state.osmd.EngravingRules.GNote(event.notes[0].source)?.getSVGGElement();
    const head=element&&(element.querySelector('.vf-notehead')||element).getBoundingClientRect();
    if(point&&head?.width)point.headX=head.left-origin.left+head.width/2;
  }
  PlayedNotes.cache(state.osmd,$('score'),state.cursorPoints,state.baseEvents);
  renderActualNotes();
  let line=$('playhead');if(!line){line=document.createElement('div');line.id='playhead';line.setAttribute('aria-hidden','true');$('score').append(line);}
  state.followTarget=null;
}
function drawPlayhead() {
  const line=$('playhead'),event=state.events[state.index];if(!line||!event)return;
  const point=state.cursorPoints[event.cursorIndex];if(!point)return;
  let x=point.x;
  const next=state.index<state.endIndex?state.cursorPoints[state.events[state.index+1]?.cursorIndex]:null;
  if(state.playheadTimed&&!state.countRemaining) {
    const endX=next&&Math.abs(next.y-point.y)<5&&next.x>point.x?next.x:point.endX;
    const amount=Math.max(0,Math.min(1,(state.beat-event.beat)/(event.end-event.beat||1)));x+=(endX-point.x)*amount;
  }
  line.style.left=x+'px';line.style.top=point.y+'px';line.style.height=Math.max(24,point.height)+'px';line.hidden=!layout.playhead;
  if(!layout.follow)return;
  const viewport=$('score-scroll'),vr=viewport.getBoundingClientRect(),sr=$('score').getBoundingClientRect();
  const top=sr.top-vr.top+point.y,bottom=top+point.height,left=sr.left-vr.left+x;
  if(layout.followStyle==='center') {
    // Keeps the reading line at the viewport's middle and glides toward the next system over the last 30% of this one, so the page never jumps.
    const target=centerTarget(point),maxTop=viewport.scrollHeight-viewport.clientHeight;
    const targetTop=Math.max(0,Math.min(maxTop,viewport.scrollTop+sr.top-vr.top+target-viewport.clientHeight/2));
    const targetLeft=left<15||left>vr.width-20?Math.max(0,Math.min(viewport.scrollWidth-viewport.clientWidth,viewport.scrollLeft+left-vr.width*.3)):viewport.scrollLeft;
    const key=`center:${state.index}:${Math.round(targetLeft)}`;
    if(state.running){
      // Tempo / listen targets move every frame; wait-mode targets step per note, so ease toward them.
      const eased=state.playheadTimed||Math.abs(targetTop-viewport.scrollTop)<.5?targetTop:viewport.scrollTop+(targetTop-viewport.scrollTop)*.12;
      if(Math.abs(eased-viewport.scrollTop)>=.5)viewport.scrollTop=eased;if(targetLeft!==viewport.scrollLeft)viewport.scrollLeft=targetLeft;state.followTarget=key;
    } else if(state.followTarget!==key){state.followTarget=key;viewport.scrollTo({top:targetTop,left:targetLeft,behavior:'instant'});}
    return;
  }
  if(layout.followStyle==='line') {
    // Like Piano Marvel: on entering a new system, glide it to the top so the following systems stay in view.
    const headroom=Math.max(36,point.height*1.7),targetTop=Math.max(0,Math.min(viewport.scrollHeight-viewport.clientHeight,viewport.scrollTop+top-headroom));
    const targetLeft=left<15||left>vr.width-20?Math.max(0,Math.min(viewport.scrollWidth-viewport.clientWidth,viewport.scrollLeft+left-vr.width*.3)):viewport.scrollLeft;
    const key=`line:${Math.round(point.y)}:${Math.round(targetLeft)}`;
    if(state.followTarget!==key){state.followTarget=key;viewport.scrollTo({top:targetTop,left:targetLeft,behavior:state.running?'smooth':'instant'});}
    return;
  }
  if(top<18||bottom>vr.height-25||left<15||left>vr.width-20) {
    const targetTop=Math.max(0,Math.min(viewport.scrollHeight-viewport.clientHeight,viewport.scrollTop+top-vr.height*(layout.followStyle==='page'?.08:.24)));
    const targetLeft=Math.max(0,Math.min(viewport.scrollWidth-viewport.clientWidth,viewport.scrollLeft+left-vr.width*.3));
    const key=`${Math.round(targetTop)}:${Math.round(targetLeft)}`;
    if(state.followTarget!==key){state.followTarget=key;viewport.scrollTo({top:targetTop,left:targetLeft,behavior:state.running&&layout.followStyle==='smooth'?'smooth':'instant'});}
  } else state.followTarget=null;
}
// Vertical centre of a system: its staves, plus the review's added bass staff when the score has only a melody.
function systemCentre(point){const top=point.staves?.[0]?.top??point.y;return point.bass?(top+point.bass.top+8*point.bass.step)/2:point.y+point.height/2;}
// Systems of the current position, cached per index: first event of this system, first event of the next one.
function systemSpan(index){
  const c=state.centerSpan;if(c?.index===index&&c.events===state.events&&c.points===state.cursorPoints&&c.end===state.endIndex)return c;
  const y=i=>state.cursorPoints[state.events[i]?.cursorIndex]?.y,same=i=>Math.abs(y(i)-y(index))<5;
  let first=index;while(first>state.sessionStart&&same(first-1))first--;
  let next=index+1;while(next<=state.endIndex&&same(next))next++;
  // Skip-backward jumps (a repeat drawn on an earlier line) are not glided toward.
  const nextPoint=next<=state.endIndex&&y(next)>y(index)?state.cursorPoints[state.events[next].cursorIndex]:null;
  return state.centerSpan={index,events:state.events,points:state.cursorPoints,end:state.endIndex,first,next,nextPoint};
}
function centerTarget(point){
  const span=systemSpan(state.index),from=systemCentre(point);if(!span.nextPoint)return from;
  const progress=state.playheadTimed?(state.beat-state.events[span.first].beat)/((state.events[span.next].beat-state.events[span.first].beat)||1):(state.index-span.first+1)/(span.next-span.first);
  const t=Math.max(0,Math.min(1,(progress-.7)/.3));
  return from+(systemCentre(span.nextPoint)-from)*t*t*(3-2*t);
}
function changeDetection() {
  if(!state.baseEvents.length||state.loading)return;
  pause();
  try {
    const level=Number($('detection').value),anchor=$('anchor').value,rhythm=$('rhythm').value;
    const compiled=level?LeadSheet.compile(state.baseEvents,state.leadMeta,level,anchor):state.baseEvents;
    const events=LeadSheet.swing(compiled,state.baseEvents,rhythm==='swing',state.leadMeta.meters);
    state.level=level;state.anchor=anchor;state.rhythm=rhythm;state.events=events;
    $('rule-error').hidden=true;$('anchor').disabled=level!==3;
    $('rule-help').textContent=level===0?'按原谱音高检测。切换规则不会改写谱面。':`左手按提示音高弹奏${level===1?' 3 / 7':' 3 / 5 / 7 / 9'}，换和弦时重新检测；${level===3?'骨干旋律下方加一个 3 或 7 音（两者任选）。':'右手保持原旋律。'}未写七音的大 / 小三和弦分别按 maj7 / m7 扩展。`;
    bindScoreNotes();changeRange();
  } catch(error) {
    $('rule-error').textContent=error.message;$('rule-error').hidden=false;toast(error.message);
    $('detection').value=state.level;$('anchor').value=state.anchor;$('rhythm').value=state.rhythm;
  }
}
function updateLeadStatus() {
  const event=state.events[state.index];$('lead-status').hidden=!state.level;
  if(!event?.lead)return;
  $('chord-label').textContent=event.lead.chord.label;
  const left=activeNotes(event).filter(n=>n.hand==='left').map(n=>noteName(n.midi)).join(' · ');
  const right=activeNotes(event).filter(n=>n.hand==='right').map(n=>n.accepts?'加 '+n.accepts.map(noteName).join(' / ')+'（任选一音）':noteName(n.midi)).join(' + ');
  $('lead-targets').textContent=`左手：${left||'本次无需重弹'}　｜　右手：${right||'休止 / 延音'}`;
}
// Generated Lead Sheet targets (left-hand voicing, guide tones) have no notehead in the score, so a missed one is drawn hollow in the review.
function recordMissed(index,keys){
  for(const key of keys){const target=activeNotes(state.events[index]).find(n=>(n.key??n.midi)===key);if(target&&!target.source)state.missedTargets.push({index,midi:target.accepts?target.accepts.at(-1):target.midi,accepts:target.accepts,hand:target.hand});}
}
function newPass(index=state.startIndex) {
  state.missedTargets=[];
  clearColors();state.matcher=new PracticeMatcher(state.events,{windowMs:layout.timingWindow,same:samePitch});state.trail=[];renderReview();
  state.clockHistory=[];if(state.running)state.inputStart=state.lastFrame;
  state.playheadTimed=false;state.started=false;state.index=index;state.sessionStart=index;state.expireIndex=index;state.hits=state.matcher.hitsAt(index);state.beat=state.events[index]?.beat||0;state.restUntil=0;state.lastClick=-1;state.countEnd=null;
  positionCursor(index);updatePosition();$('pass-label').textContent=`第 ${state.pass} 轮`;
  prepareBacking();
}
function updatePosition() {
  const event=state.events[state.index]; if(!event) return;
  const bar=state.barNames?.[event.measure-1];$('measure').textContent=bar?.pickup?'弱起':String(bar?.number??event.measure).padStart(2,'0')+(bar?.pass>1?` · 第 ${bar.pass} 遍`:'');
  const progress=Math.round((state.index-state.sessionStart)/(state.endIndex-state.sessionStart+1)*100);
  $('progress').style.width=progress+'%'; $('progress-label').textContent=progress+'%';
  $('position-label').textContent=barLabel(event.measure);
  renderCountInLabel();
  renderMetronome();
  $('expected').textContent=pitches().length?'待弹 '+pitches().map(noteName).join(' · '):'休止 / 延音';
  updateLeadStatus();
  paintKeys();
  state.osmd.cursor.show();
  drawPlayhead();
}
function paintKeys() {
  const expected=new Set(activeNotes().flatMap(n=>n.accepts||[n.midi]));
  document.querySelectorAll('.key').forEach(key=>{const midi=Number(key.dataset.midi);key.classList.toggle('expected',expected.has(midi));key.classList.toggle('pressed',state.held.has(midi));});
}
function reset(index=state.startIndex) {
  pause();state.correct=0;state.wrong=0;state.missed=0;state.streak=0;state.best=0;state.exact=0;state.early=0;state.late=0;state.pass=1;state.completed=false;state.countRemaining=0;
  state.markerNodes.forEach(n=>n.remove());state.markerNodes=[];
  state.attempts=[];state.playedAt=null;state.trail=[];$('actual-note-overlay')?.remove();
  if(state.osmd)newPass(typeof index==='number'?index:state.startIndex);
  $('timing-offset').textContent='等待起音';
  stats();feedback('每一个音符，都是进步的开始。');$('score-state').textContent='准备练习';
}
function pause() {
  cancelAnimationFrame(state.raf);
  showMetronomeBeat(-1);
  state.running=false;state.listening=false;state.restUntil=0;
  stopSound();stopBacking(); $('play').innerHTML='▶<span>开始练习</span>';$('listen').textContent='♫ 试听';
  if(state.events.length) $('score-state').textContent='已暂停';
  if(state.osmd){renderActualNotes();displayPlayedNotes();}
}
function meterAt(index) {
  const meter=state.leadMeta.meters[state.events[index]?.measure-1]||{beats:4,beatType:4};
  return {...meter,unit:4/meter.beatType};
}
function metronomePattern(meter=meterAt(state.index)) {
  const saved=state.metronomePatterns[`${meter.beats}/${meter.beatType}`];
  return Array.from({length:meter.beats},(_,i)=>Array.isArray(saved)?saved.includes(i+1):true);
}
function saveMetronome(){try{localStorage.setItem('cadence.metronome.v1',JSON.stringify({enabled:state.metronome,patterns:state.metronomePatterns}));}catch{}}
function renderMetronome() {
  const meter=meterAt(state.index),key=`${meter.beats}/${meter.beatType}`,pattern=metronomePattern(meter);
  $('metronome-enabled').checked=state.metronome;
  $('metronome').textContent=state.metronome?'♩ 已开启':'♩ 节拍器';
  $('metronome-meter').textContent=key;
  $('metronome-tempo').textContent=`♩ = ${state.bpm} BPM`;
  const container=$('metronome-beats');
  if(container.dataset.meter!==key){
    container.dataset.meter=key;
    container.replaceChildren(...pattern.map((_,i)=>{
      const button=document.createElement('button');button.type='button';button.textContent=String(i+1);button.setAttribute('aria-label',`第 ${i+1} 拍发声`);
      button.onclick=()=>{const next=metronomePattern(meter);next[i]=!next[i];state.metronomePatterns[key]=next.flatMap((enabled,j)=>enabled?[j+1]:[]);saveMetronome();renderMetronome();};
      return button;
    }));
  }
  [...container.children].forEach((b,i)=>b.setAttribute('aria-pressed',String(pattern[i])));
  $('metronome-pattern-summary').textContent=pattern.some(Boolean)?`每小节第 ${pattern.flatMap((on,i)=>on?[i+1]:[]).join('、')} 拍发声`:'所有拍均静音';
}
function showMetronomeBeat(pulse){[...$('metronome-beats').children].forEach((b,i)=>b.classList.toggle('current-beat',i===pulse));}
// A pickup (anacrusis) bar is shorter than its meter; its notes sit at the end of a full bar, so beat positions are shifted by the missing part.
function pickupPad(event){
  if(event?.measure!==1)return 0;
  const meter=state.leadMeta.meters[0]||{beats:4,beatType:4},bar=meter.beats*4/meter.beatType;
  return event.measureDuration<bar-1e-6?bar-event.measureDuration:0;
}
// Describes the next count-in: from the current note before starting, from the range start (loop) once playing.
function renderCountInLabel(){
  const index=state.started?state.startIndex:state.index,event=state.events[index];if(!event)return;
  const meter=meterAt(index),entry=countEntry(event).position/meter.unit;
  $('count-in-label').textContent=`跟拍前预备 ${layout.countInBars} 小节（${meter.beats}/${meter.beatType} · ${layout.countInBars*meter.beats} 下${entry>1e-6?`，第 ${+(entry+1).toFixed(2)} 拍进入`:''}）`;
}
// Start note's position in its full bar (quarter beats, on the practice clock as the live metronome measures it, so a swung pickup lines up).
function countEntry(event){
  if(!event)return {position:0};
  const measureStart=(event.straightBeat??event.beat)-event.relativeBeat-pickupPad(event);
  return {position:Math.max(0,event.beat-measureStart)};
}
// K whole bars in the meter (like iReal Pro / MuseScore), the last one being the start note's own bar: a pickup or mid-bar start enters on its beat inside the count, and the count's remaining clicks continue up to the barline.
function beginCountIn() {
  const meter=meterAt(state.index),event=state.events[state.index],bar=meter.beats*meter.unit,{position}=countEntry(event);
  state.countUnit=meter.unit;state.countBeats=meter.beats;state.countClicks=layout.countInBars*meter.beats;
  state.countTotal=(layout.countInBars-1)*bar+(position>1e-6?position:bar);state.countRemaining=state.countTotal;state.countLast=0;
  state.countStart=state.beat-state.countTotal;state.countEnd=state.countStart+layout.countInBars*bar;
  clickSound(true);$('score-state').textContent=`预备 · 1 / ${meter.beats}`;feedback(`预备 1 / ${meter.beats}，准备开始。`);
}
// Count click k (0-based from the first click) at count position `at` beats; after the entry only the status label follows, so hit feedback is kept.
function countClick(at,entered){
  const k=Math.floor(at/state.countUnit+1e-8);if(k<0||k>=state.countClicks||k===state.countLast)return;
  state.countLast=k;const count=k%state.countBeats+1;clickSound(count===1);$('score-state').textContent=`预备 · ${count} / ${state.countBeats}`;
  if(!entered)feedback(`预备 ${count} / ${state.countBeats}，准备开始。`);
}
function start(listening=false) {
  if(!state.events.length||state.loading) return;
  if(state.running) {pause();return;}
  if(state.completed) reset();
  const needsCountIn=!state.started&&!listening&&state.mode==='tempo'&&$('count-in').checked;
  state.started=true;
  state.playheadTimed=state.mode==='tempo'||listening;
  initAudio();loadBacking();prepareBacking();state.running=true;state.listening=listening;state.lastFrame=performance.now();state.lastClick=-1;
  state.inputStart=state.lastFrame;state.clockHistory=[];
  state.followTarget=null;
  $('play').innerHTML='Ⅱ<span>暂停练习</span>'; $('listen').textContent=listening?'■ 停止试听':'♫ 试听';
  $('score-state').textContent=listening?'正在试听':state.mode==='wait'?'正在等你弹奏':'跟拍练习中';
  feedback(listening?'试听中，不计入练习成绩。':state.mode==='wait'?'弹下绿色琴键对应的音符。':'跟随指示线，保持你的节奏。');
  if(needsCountIn)beginCountIn();
  if(listening) soundEvent();
  state.raf=requestAnimationFrame(tick);
}
function advance() {
  if(state.index>=state.endIndex) {finish();return;}
  const oldCursor=state.events[state.index].cursorIndex;state.index++;state.hits=state.matcher.hitsAt(state.index);state.restUntil=0;
  for(let i=oldCursor;i<state.events[state.index].cursorIndex;i++)state.osmd.cursor.next();updatePosition();
  if(state.listening) soundEvent();
}
function updateClock(now) {
  // rAF timestamps can precede the performance.now() of a MIDI note handled just before; never move the clock back, or that span is counted twice.
  if(!state.running||now<state.lastFrame) return;
  state.clockHistory.push({time:state.lastFrame,beat:state.beat,count:state.countRemaining,bpm:state.bpm});
  if(state.clockHistory.length>1000)state.clockHistory.splice(0,500);
  let dt=(now-state.lastFrame)/1000; state.lastFrame=now;
  if(state.countRemaining>0) {
    const before=state.countRemaining;
    // Snap a floating-point remainder to zero so the boundary frame cannot click once more.
    state.countRemaining=Math.max(0,before-dt*state.bpm/60);if(state.countRemaining<1e-6)state.countRemaining=0;
    if(state.countRemaining>0){countClick(state.countTotal-state.countRemaining,false);return;}
    dt=Math.max(0,dt-before*60/state.bpm);state.lastClick=-1;$('score-state').textContent='跟拍练习中';
  }
  if(state.mode==='tempo'||state.listening) {
    state.beat+=dt*state.bpm/60;
    if(!state.listening) {
      const radius=state.matcher.windowMs*state.bpm/60000;
      while(state.expireIndex<=state.endIndex&&state.beat>state.events[state.expireIndex].beat+radius) {
        const i=state.expireIndex++,missing=state.matcher.expire(i,activeNotes);
        if(missing.length){state.missed+=missing.length;state.streak=0;missing.forEach(n=>colorNote(i,n,'#d97765'));recordMissed(i,missing);feedback(`${barLabel(state.events[i].measure)}漏过 ${missing.length} 个音符，继续跟上节奏。`);stats();}
      }
    }
    while(state.running&&state.index<state.endIndex&&state.beat>=state.events[state.index].end)advance();
    const endBeat=Math.max(state.events[state.endIndex].end,state.events[state.endIndex].beat+(state.listening?0:state.matcher.windowMs*state.bpm/60000));
    if(state.running&&state.beat>endBeat)finish();
  } else if(!pitches().length) {
    if(!state.restUntil) state.restUntil=now+(state.events[state.index].end-state.events[state.index].beat)*60000/state.bpm;
    if(now>=state.restUntil) advance();
  }
  if(state.running&&!state.countRemaining && (state.mode==='tempo'||state.listening)) {
    // Count clicks at or after the entry (e.g. "4" under a beat-4 pickup) sound up to the barline, metronome on or off; the live metronome takes over there.
    let counting=false;
    if(state.countEnd!=null){if(state.beat<state.countEnd-1e-6){counting=true;countClick(state.beat-state.countStart,true);}else{state.countEnd=null;if(state.running)$('score-state').textContent='跟拍练习中';}}
    const event=state.events[state.index],meter=meterAt(state.index),measureStart=(event.straightBeat??event.beat)-event.relativeBeat-pickupPad(event);
    const position=(state.beat-measureStart)/meter.unit,pulse=Math.floor(position+1e-8),key=`${measureStart}:${meter.beatType}:${pulse}`;
    // Only a crossed beat clicks: starting halfway through a beat (a ½-beat pickup) must not repeat the count-in's last click.
    if(key!==state.lastClick){state.lastClick=key;showMetronomeBeat(pulse);if(!counting&&state.metronome&&metronomePattern(meter)[pulse]&&position-pulse<.25)clickSound(pulse===0);}
  }
}
function tick(now){updateClock(now);backingTick();drawPlayhead();if(state.running)state.raf=requestAnimationFrame(tick);}
// Backing: planned once per pass from the chord symbols, then scheduled ~0.35 s ahead on the audio clock against the practice clock (count-in included).
state.backing={notes:null,next:0,sources:new Set(),gain:null};
const backingWanted=()=>layout.backing&&(state.mode==='tempo'||state.listening);
function prepareBacking(){
  const b=state.backing;b.notes=null;
  if(!layout.backing||!state.events.length||!state.leadMeta.harmonies.length)return;
  // Indices can still belong to the previous score while a new one is being set up.
  const first=state.events[state.sessionStart],last=state.events[state.endIndex];if(!first||!last||state.endIndex<state.sessionStart)return;
  const from=first.beat,to=last.end;
  b.notes=Backing.plan(Backing.timeline(state.baseEvents,state.leadMeta),from,to,state.pass,{feel:layout.backingFeel,bpm:state.bpm,sections:state.leadMeta.sections||[]});
  b.next=b.notes.findIndex(n=>n.beat>=state.beat-1e-6);if(b.next<0)b.next=b.notes.length;b.until=null;
}
function backingTick(){
  const b=state.backing;
  if(!state.running||!backingWanted()||!b.notes||!Backing.ready()||!state.audio)return;
  const ctx=state.audio,position=state.beat-state.countRemaining,ahead=position+.35*state.bpm/60;
  if(!b.gain){b.gain=ctx.createGain();b.gain.connect(ctx.destination);}
  b.gain.gain.value=layout.backingVolume;
  b.until=ahead;
  while(b.next<b.notes.length&&b.notes[b.next].beat<=ahead){
    const note=b.notes[b.next++];
    if(note.beat<position-.05||(note.kind==='bass'?!layout.backingBass:!layout.backingDrums))continue;
    // Human feel: per-note micro-timing, clamped so a pushed-ahead note at the start is never scheduled in the past.
    const source=Backing.play(ctx,b.gain,note,Math.max(ctx.currentTime,ctx.currentTime+(note.beat-position)*60/state.bpm+(note.offsetMs||0)/1000),state.bpm);
    if(source){b.sources.add(source);source.addEventListener('ended',()=>b.sources.delete(source));}
  }
}
function stopBacking(){state.backing.sources.forEach(s=>{try{s.stop();}catch{}});state.backing.sources.clear();}
function loadBacking(){
  if(!layout.backing)return;initAudio();if(!state.audio||Backing.ready())return renderBackingStatus();
  $('backing-status').textContent='正在载入贝斯与鼓的音色…';
  Backing.load(state.audio).then(renderBackingStatus).catch(error=>{$('backing-status').textContent=error.message;toast(error.message);});
}
function renderBackingStatus(){
  const parts=[layout.backingBass&&'走动贝斯',layout.backingDrums&&'刷子鼓'].filter(Boolean).join(' + ')||'未选择乐器';
  $('backing-status').textContent=!state.leadMeta.harmonies.length?'这份乐谱没有和弦标记，无法生成伴奏。':layout.backing?`${parts} · 按谱面和弦生成，跟拍与试听时播放；等音模式不播放。`:'按谱面和弦生成 Medium Swing 走动贝斯与刷子鼓。';
}
function finish() {
  if($('loop').checked) {
    const timed=state.playheadTimed;state.pass++;state.markerNodes.forEach(n=>n.remove());state.markerNodes=[];newPass();state.playheadTimed=timed;
    state.countRemaining=0;state.started=true;
    feedback(`进入第 ${state.pass} 轮，成绩累计。`);if(state.mode==='tempo'&&!state.listening&&$('count-in').checked)beginCountIn();if(state.listening)soundEvent();return;
  }
  if(state.playheadTimed)state.beat=state.events[state.endIndex].end;
  const listening=state.listening;pause();$('progress').style.width='100%';$('progress-label').textContent='100%';$('score-state').textContent=listening?'试听完成':'练习完成';
  state.completed=true;
  if(listening) return feedback('试听完成，轮到你了。');
  $('result-copy').textContent=`完成 ${state.pass} 轮练习！音符准确率 ${$('accuracy').textContent}，正确 ${state.correct} 个音符，错音 ${state.wrong} 个、漏音 ${state.missed} 个，最高连续命中 ${state.best} 个。${state.mode==='tempo'?`起音：准时 ${state.exact}，偏早 ${state.early}，偏晚 ${state.late}。`:''}`;
  $('result').showModal(); feedback('练习完成。休息一下，或再试一次。');
}
function inputTiming(received,now) {
  if(Number.isFinite(received)&&received>0&&received<(state.inputStart||0))return {beat:state.beat,count:Infinity,dispatchMs:now-received};
  const timestamped=Number.isFinite(received)&&received>0&&received<=now&&received>=(state.inputStart||0);
  if(!timestamped)received=now;
  // Calibrated loop latency (click output + MIDI input) shifts the onset back to when it was intended.
  const at=received-state.latencyMs;
  const frames=[...state.clockHistory,{time:state.lastFrame,beat:state.beat,count:state.countRemaining,bpm:state.bpm}];
  const frame=frames.findLast(f=>f.time<=at)||frames[0];
  const elapsed=(at-frame.time)*frame.bpm/60000;
  return {beat:frame.count>0?frame.beat+Math.max(0,elapsed-frame.count):frame.beat+elapsed,count:Math.max(0,frame.count-elapsed),dispatchMs:timestamped?now-received:null};
}
function nearestTarget(midi,timing){
  return state.events.flatMap((event,index)=>index<state.sessionStart||index>state.endIndex?[]:activeNotes(event).some(n=>samePitch(n,n.midi,midi)||n.accepts?.some(a=>samePitch(n,a,midi)))?[{index,offset:(timing.beat-event.beat)*60000/state.bpm}]:[]).sort((a,b)=>Math.abs(a.offset)-Math.abs(b.offset))[0];
}
function melodyCeiling(beat){
  // Lowest of the top target pitches sounding within one beat of the onset; falls back to the last melody note during rests.
  let top=null,last=null;
  for(let i=state.sessionStart;i<=state.endIndex;i++){
    const event=state.events[i];if(event.beat>beat+1)break;
    const notes=activeNotes(event);if(!notes.length)continue;
    const high=Math.max(...notes.flatMap(n=>n.accepts||[n.midi]));
    if(event.end>=beat-1)top=top===null?high:Math.min(top,high);else last=high;
  }
  return top??last;
}
function classifyMiss(midi,timing){
  const near=nearestTarget(midi,timing);
  if(state.mode==='tempo'&&near&&Math.abs(near.offset)>state.matcher.windowMs&&Math.abs(near.offset)<1500)return {reason:'outside-window',near};
  const ceiling=state.level?null:melodyCeiling(state.mode==='tempo'?timing.beat:state.events[state.index].beat);
  return {reason:'pitch-or-extra',near,belowMelody:ceiling!==null&&midi<=ceiling-3};
}
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?(sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2:null;};
const quantile=(values,q)=>{const sorted=[...values].sort((a,b)=>a-b);if(!sorted.length)return null;const p=(sorted.length-1)*q,l=Math.floor(p);return sorted[l]+(sorted[Math.ceil(p)]-sorted[l])*(p-l);};
function diagnose(){
  const a=state.attempts,count=reason=>a.filter(x=>x.reason===reason).length;
  const hits=count('hit'),outside=count('outside-window'),pitch=count('pitch-or-extra'),accompaniment=count('accompaniment'),scored=hits+outside+pitch;
  const timed=a.filter(x=>(x.reason==='hit'||x.reason==='outside-window')&&x.offset!==null).map(x=>x.offset);
  const med=median(timed),iqr=timed.length>=4?quantile(timed,.75)-quantile(timed,.25):null,queue=median(a.filter(x=>x.dispatchMs!==null).map(x=>x.dispatchMs));
  const lowExtra=a.filter(x=>x.reason==='pitch-or-extra'&&x.belowMelody).length;
  const lines=[`已记录 ${a.length} 次起音：命中 ${hits}，超出节奏窗口 ${outside}，音高不符 / 多弹 ${pitch}${accompaniment?`，伴奏（不计错）${accompaniment}`:''}。`];
  if(timed.length)lines.push(`起音偏差（命中 + 超窗）：中位 ${med>0?'+':''}${Math.round(med)} ms${iqr!==null?`，离散度 IQR ${Math.round(iqr)} ms`:''}，共 ${timed.length} 次。${state.latencyMs?`已扣除校准补偿 ${state.latencyMs} ms。`:''}`);
  if(queue!==null)lines.push(`MIDI 消息排队中位 ${Math.round(queue)} ms（浏览器内部，不含琴到电脑与声音输出）。`);
  const verdict=[];
  if(scored<8)verdict.push('记录还少，继续弹 8 个以上的音再看结论。');
  else {
    if(lowExtra>=Math.max(3,pitch*.5)&&!$('allow-accompaniment').checked)verdict.push(`${lowExtra} 个“错音”低于旋律，看起来是左手伴奏：这份谱只写了旋律，勾选「伴奏音不计错」或切换到 Lead Sheet Level 1–3。`);
    if(pitch-lowExtra>scored*.25)verdict.push(`音高不符占 ${Math.round((pitch-lowExtra)/scored*100)}%：主要是弹错音，而非延迟。可先用等音模式熟悉音符。`);
    if(timed.length>=6) {
      const dir=med>0?'偏晚':'偏早';
      if(Math.abs(med)>=60&&iqr<=Math.max(70,Math.abs(med)*.8))verdict.push(`整体稳定${dir}约 ${Math.abs(Math.round(med))} ms：符合固定延迟的特征（例如蓝牙耳机 / 声卡输出延迟），也可能是习惯性${dir}。请做一次「延迟校准」区分两者。`);
      else if(iqr>120)verdict.push(`起音偏差分散（IQR ${Math.round(iqr)} ms）：主要是节奏不稳，固定延迟无法解释。可降低速度或调大节奏容差。`);
      else if(outside>scored*.2)verdict.push(`有 ${outside} 次正确音高落在容差外，中位偏差 ${Math.round(med)} ms 不大：多为个别音抢拍 / 拖拍，不像固定延迟。`);
      else verdict.push(`中位偏差 ${Math.round(med)} ms，节奏在容差内：延迟不是主要原因。`);
    }
  }
  if(state.calibrationResult)verdict.push(`上次延迟校准：${state.calibrationResult}`);
  return [...lines,...verdict.map(v=>'▸ '+v)].join('\n');
}
function recordAttempt(midi,timing,match,miss){
  const reason=match?'hit':miss.reason;
  state.attempts.push({midi,beat:timing.beat,measure:state.events[match?.index??state.index].measure,offset:state.mode==='tempo'?(match?.offset??miss?.near?.offset??null):null,dispatchMs:timing.dispatchMs,reason,belowMelody:!!miss?.belowMelody});
  if(state.attempts.length>2000)state.attempts.shift();
  const text=`${diagnose()}\n当前为${state.level?` Lead Sheet Level ${state.level}`:'原谱检测'}，${state.hand==='both'?'双手':state.hand==='left'?'左手':'右手'}，${state.bpm} BPM。`;
  $('performance-diagnosis').textContent=text;
  try{localStorage.setItem('cadence.lastPerformance',JSON.stringify({title:$('piece-title').textContent,bpm:state.bpm,mode:state.mode,level:state.level,hand:state.hand,rhythm:state.rhythm,latencyMs:state.latencyMs,text,attempts:state.attempts.slice(-500)}));}catch{}
}
function anchorPosition(anchor){
  const event=state.events[anchor.index],point=state.cursorPoints[event?.cursorIndex];if(!point)return null;
  const next=state.cursorPoints[state.events[anchor.index+1]?.cursorIndex];
  const endX=next&&Math.abs(next.y-point.y)<5&&next.x>point.x?next.x:point.endX;
  const amount=anchor.timed?Math.max(0,Math.min(1,(anchor.beat-event.beat)/(event.end-event.beat||1))):0;
  const head=p=>p.headX??p.x,start=head(point),end=next&&Math.abs(next.y-point.y)<5&&next.x>point.x?head(next):endX;
  return {point,x:start+(end-start)*amount};
}
// During practice nothing played is drawn unless asked; afterwards every note is reviewed in place, as in an assessment.
const hidingLive=()=>state.running&&!state.listening&&!layout.liveNotes;
function renderActualNotes(){
  if(hidingLive()){$('actual-note-overlay')?.remove();$('overlay-warning').hidden=true;return;}
  const review=!state.running,groups=[];
  // A hit on a written note is shown by colouring that notehead, so nothing is drawn over it; everything else sits at its score position (the notehead x), not at the raw timing.
  for(const note of state.trail){
    if(note.written)continue;
    const point=state.cursorPoints[state.events[note.target]?.cursorIndex];if(!point)continue;
    const x=point.headX??point.x,step=point.staves?.[0]?.step||2,wrong=note.status==='pitch-or-extra'||note.status==='outside-window';
    // A wrong note on (or next to) a written note's staff position moves one notehead right so both stay readable.
    const row=midi=>{const s=PlayedNotes.spell(midi,state.fifths,spellingHint(note.target,midi));return s.octave*7+s.letter;};
    const shift=wrong&&state.events[note.target].notes.some(n=>Math.abs(row(n.midi)-row(note.midi))<=1)?step*2.5:0;
    const last=groups.at(-1),shown={...note,hint:spellingHint(note.target,note.midi),opacity:1,label:!review};
    if(last&&last.point===point&&last.baseX===x&&last.shift===shift&&note.time-last.time<150&&!last.notes.some(n=>n.midi===note.midi)){last.notes.push(shown);continue;}
    const stacked=groups.filter(g=>g.point===point&&g.baseX===x&&g.shift===shift&&g.notes.some(n=>n.status===note.status)).length;
    groups.push({point,baseX:x,x:x+stacked*step*3,shift,time:note.time,notes:[shown]});
  }
  if(review)for(const missed of state.missedTargets){
    const point=state.cursorPoints[state.events[missed.index]?.cursorIndex];
    if(point)groups.push({point,x:(point.headX??point.x)-(point.staves?.[0]?.step||2)*5,shift:0,notes:[{midi:missed.midi,hand:missed.hand,status:'missed',color:'#c4553f',hollow:true,label:false}]});
  }
  const anchor=state.playedAt;
  if(anchor&&!anchor.trail){const at=anchorPosition(anchor),notes=state.held.size?[...state.held]:state.lastPlayed;if(at)groups.push({...at,notes:notes.map(midi=>({midi,status:'free',opacity:state.held.has(midi)?1:.6}))});}
  if(groups.some(g=>!g.point.staves?.length))PlayedNotes.cache(state.osmd,$('score'),state.cursorPoints,state.baseEvents,true);
  const drawn=PlayedNotes.render($('score'),groups,state.fifths);
  $('overlay-warning').hidden=!groups.length||drawn>0;
}
// Letter of a written note with the same pitch, so the played note is spelled like the score (G♯ vs A♭).
function spellingHint(index,midi){
  const note=state.events[index]?.notes.find(n=>n.midi===midi&&n.source?.Pitch);
  const letter=note?[0,2,4,5,7,9,11].indexOf(note.source.Pitch.FundamentalNote):-1;
  return letter<0?undefined:letter;
}
const spelledName=(index,midi)=>PlayedNotes.spell(midi,state.fifths,spellingHint(index,midi)).name;
// Written notes next to what was actually played, grouped by the score position each onset belongs to.
function renderReview(){
  const rows=[];
  for(const note of state.trail){
    const last=rows.at(-1);
    if(last&&last.target===note.target&&note.time-last.time<1500)last.played.push(note);
    else rows.push({target:note.target,time:note.time,played:[note]});
  }
  const list=$('performance-review');
  if(!rows.length){list.replaceChildren();$('review-empty').hidden=false;return;}
  $('review-empty').hidden=true;
  list.replaceChildren(...rows.map(row=>{
    const event=state.events[row.target],li=document.createElement('li');
    const written=[...new Set(activeNotes(event).flatMap(n=>n.accepts||[n.midi]))].sort((a,b)=>a-b).map(midi=>spelledName(row.target,midi));
    const head=document.createElement('span');head.className='review-where';head.textContent=`${barLabel(event.measure)} · 第 ${Math.floor((event.relativeBeat+pickupPad(event))/meterAt(row.target).unit+1e-6)+1} 拍`;
    const score=document.createElement('span');score.textContent=`谱 ${written.join(' ')||'休止'}`;
    const played=document.createElement('span');played.className='review-played';played.append('弹 ');
    row.played.sort((a,b)=>a.midi-b.midi).forEach(note=>{const b=document.createElement('b');b.textContent=spelledName(row.target,note.midi)+' ';b.style.color=note.color;b.title={exact:'准时',early:'偏早',late:'偏晚',hit:'命中','outside-window':'音高对但超出节奏窗口','pitch-or-extra':'错音 / 多弹',accompaniment:'伴奏（不计错）',ignored:'不计分'}[note.status]||'';played.append(b);});
    li.append(head,score,played);return li;
  }));
  list.lastElementChild?.scrollIntoView?.({block:'nearest'});
}
// Which hand a played note belongs to: the matched target says so; otherwise accompaniment and notes below middle C are the left hand.
function handOf(midi,status,target,key){
  const event=state.events[target];
  if(key!==undefined&&event){
    const note=activeNotes(event).find(n=>(n.key??n.midi)===key);
    if(note?.hand)return note.hand;
    if(note?.staff!==undefined&&state.staffIds.length>1)return note.staff===state.staffIds[1]?'left':'right';
    if(note)return 'right';
  }
  if(state.level&&event?.lead?.left.some(m=>samePitch({hand:'left'},m,midi)))return 'left';
  if(state.level&&event?.lead){
    // Lead Sheet: an unmatched voicing / chord tone (any octave) is the left hand unless it sits at the melody or shares its pitch class; so is anything below middle C or over an octave under the melody.
    const melody=event.lead.melody?.midi??melodyCeiling(event.beat),pc=n=>((n%12)+12)%12,ch=event.lead.chord;
    if(melody!=null&&midi>=melody-2)return 'right';
    const tones=new Set([...event.lead.left.map(pc),...(ch&&!ch.none&&ch.degrees?(state.level===1?[3,7]:[3,5,7,9]).filter(d=>Number.isFinite(ch.degrees[d])).map(d=>pc(ch.root+ch.degrees[d])):[])]);
    if(tones.has(pc(midi))&&(melody==null||pc(midi)!==pc(melody)))return 'left';
    return midi<60||melody!=null&&midi<melody-12?'left':'right';
  }
  return status==='accompaniment'||midi<60?'left':'right';
}
function addTrail(midi,timing,status,target=state.playedAt.index,key){
  state.playedAt.trail=true;
  // written: the hit matched a notehead in the score (coloured there instead of drawn again).
  const written=['exact','early','late','hit'].includes(status)&&key!==undefined&&!!activeNotes(state.events[target]).find(n=>(n.key??n.midi)===key)?.source;
  state.trail.push({index:state.playedAt.index,target,beat:timing.beat,timed:state.playedAt.timed,midi,status,written,hand:handOf(midi,status,target,key),color:TRAIL_COLORS[status],time:performance.now()});
  if(state.trail.length>1500)state.trail.shift();
  renderActualNotes();renderReview();
}
function noteOn(midi,velocity=90,virtual=false,received) {
  if(!Number.isInteger(midi)||midi<0||midi>127)return;
  const now=performance.now();
  if(state.calibration){calibrationTap(midi,velocity,received,now);return;}
  const timing=inputTiming(received,now);
  const anchorIndex=state.running&&state.mode==='tempo'?Math.max(state.sessionStart,state.events.findLastIndex(e=>e.beat<=timing.beat+1e-8)):state.index;
  state.playedAt={index:anchorIndex,beat:timing.beat,timed:state.running&&state.mode==='tempo'};
  state.lastVelocity=velocity;
  state.lastPlayed=[...new Set([...state.held,midi])].sort((a,b)=>a-b);
  const alreadyHeld=state.held.has(midi);state.held.add(midi);
  displayPlayedNotes(state.lastPlayed,true);
  if(alreadyHeld)return;
  paintKeys();$('input-dot').style.background='#5e9d78';
  if(virtual) {initAudio();tone(midi,.65,velocity/127);}
  if(!state.running||state.listening) return;
  updateClock(now);
  if(!state.running||timing.count>0)return;
  const wanted=pitches();
  const match=state.mode==='tempo'?state.matcher.match(midi,timing.beat,state.bpm,state.sessionStart,state.endIndex,activeNotes,true):state.matcher.matchAt(state.index,midi,activeNotes);
  if(!match&&state.level&&state.hand!=='right'&&state.events[state.index].lead?.left.some(m=>samePitch({hand:'left'},m,midi))&&(!activeNotes().some(n=>n.hand==='left'&&samePitch(n,n.midi,midi))||[...state.hits].some(k=>typeof k==='number'&&samePitch({hand:'left'},k,midi)))){addTrail(midi,timing,'ignored');return;}
  const miss=match?null:classifyMiss(midi,timing);
  if(miss?.belowMelody&&miss.reason==='pitch-or-extra'&&$('allow-accompaniment').checked){miss.reason='accompaniment';recordAttempt(midi,timing,null,miss);addTrail(midi,timing,'accompaniment',miss.near&&Math.abs(miss.near.offset)<1500?miss.near.index:undefined);return;}
  recordAttempt(midi,timing,match,miss);
  addTrail(midi,timing,match?match.rating||'hit':miss.reason,match?.index??(miss.near&&Math.abs(miss.near.offset)<1500?miss.near.index:undefined),match?.key);
  if(match) {
    if(match.wasClosed){state.missed=Math.max(0,state.missed-1);state.missedTargets=state.missedTargets.filter(m=>!(m.index===match.index&&(m.midi===midi||m.accepts?.includes(midi))));}
    state.correct++;state.streak++;state.best=Math.max(state.best,state.streak);
    colorNote(match.index,match.key,match.rating&&match.rating!=='exact'?'#b18631':'#267b63');
    if(match.rating){state[match.rating]++;const text=match.rating==='exact'?'准时':match.rating==='early'?'偏早':'偏晚';$('timing-offset').textContent=`${text} ${Math.round(Math.abs(match.offset))} ms`;feedback(`${noteName(midi)} · ${text}，连续命中 ${state.streak} 个音符。`);}
    else feedback(state.streak>=5?`连续命中 ${state.streak} 个音符，保持这个感觉。`:`${noteName(midi)}，弹对了。`);
    stats();
    if(state.mode==='wait'&&activeNotes().every(n=>state.hits.has(n.key??n.midi))) advance();
  } else {
    state.wrong++;state.streak=0;stats();feedback(`听见了 ${noteName(midi)}，${wanted.length?'试试 '+wanted.map(noteName).join('、'):'这里先停一下'}。`);
    const key=document.querySelector(`[data-midi="${midi}"]`);key?.classList.add('wrong');setTimeout(()=>key?.classList.remove('wrong'),450);
  }
}
function latencyLabel(){$('latency-value').textContent=state.latencyMs?`当前补偿 ${state.latencyMs} ms`:'未启用补偿';$('clear-latency').hidden=!state.latencyMs;}
function setLatency(ms){state.latencyMs=Math.max(0,Math.min(400,Math.round(ms)));try{localStorage.setItem('cadence.latencyMs',String(state.latencyMs));}catch{}latencyLabel();}
// Loop-latency test: clicks are scheduled on the audio clock, taps keep their MIDI receive timestamps.
function calibrateLatency(){
  if(state.calibration){finishCalibration(true);return;}
  pause();initAudio();const ctx=state.audio;if(!ctx)return toast('浏览器无法播放声音，不能进行延迟校准。');
  const interval=60/90,lead=4,taps=8,startAt=ctx.currentTime+.6,clicks=[];
  for(let i=0;i<lead+taps;i++){
    const t=startAt+i*interval,gain=ctx.createGain(),osc=ctx.createOscillator();osc.type='triangle';osc.frequency.value=440*2**((i%4===0?31:27)/12);
    gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.12*(i<lead?.5:.72)*Math.max(.3,state.metronomeVolume),t+.004);gain.gain.exponentialRampToValueAtTime(.001,t+.05);
    osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+.08);state.voices.add(osc);osc.onended=()=>{state.voices.delete(osc);gain.disconnect();};
    // Same reference as practice clicks: the moment the audio clock renders the click, before output latency.
    if(i>=lead)clicks.push(performance.now()+(t-ctx.currentTime)*1000);
  }
  state.calibration={clicks,taps:[],interval:interval*1000,outputMs:Math.round(((ctx.outputLatency||0)+(ctx.baseLatency||0))*1000),timer:setTimeout(()=>finishCalibration(false),(startAt-ctx.currentTime+(lead+taps)*interval+.6)*1000)};
  $('calibrate').textContent='■ 停止校准';$('apply-latency').hidden=true;
  $('latency-status').textContent='先听 4 下，然后在接下来的 8 下咔嗒声上，用电钢琴弹任意一个键（每下一次）。请使用平时练习用的耳机 / 音箱。';
}
function calibrationTap(midi,velocity,received,now){
  state.lastVelocity=velocity;state.lastPlayed=[midi];state.held.add(midi);displayPlayedNotes([midi],true);
  const c=state.calibration;c.taps.push(Number.isFinite(received)&&received>0&&received<=now?received:now);
  $('latency-status').textContent=`已收到 ${c.taps.length} 次敲击…`;
}
function finishCalibration(cancelled){
  const c=state.calibration;if(!c)return;clearTimeout(c.timer);state.calibration=null;stopSound();$('calibrate').textContent='◎ 开始延迟校准';
  if(cancelled){$('latency-status').textContent='校准已取消。';return;}
  const offsets=[],used=new Set();
  for(const click of c.clicks){
    let best=-1;c.taps.forEach((tap,i)=>{if(!used.has(i)&&Math.abs(tap-click)<c.interval/2&&(best<0||Math.abs(tap-click)<Math.abs(c.taps[best]-click)))best=i;});
    if(best>=0){used.add(best);offsets.push(c.taps[best]-click);}
  }
  if(offsets.length<5){$('latency-status').textContent=`只对上 ${offsets.length} / 8 下，无法得出结论。请确认 MIDI 已连接，并在每下咔嗒声上各弹一次。`;return;}
  const med=Math.round(median(offsets)),iqr=Math.round(quantile(offsets,.75)-quantile(offsets,.25));
  const head=`跟拍 ${offsets.length}/8 次，弹奏比咔嗒声${med>=0?'晚':'早'} ${Math.abs(med)} ms（中位），离散 IQR ${iqr} ms；浏览器估计声音输出延迟约 ${c.outputMs} ms。`;
  let advice;
  if(iqr>60)advice='离散较大，结果不可靠：请只跟着声音、每下弹一次，再测一次。';
  else if(med>=40){advice=`存在约 ${med} ms 的固定延迟（声音输出 + MIDI 输入 + 反应），足以让 ±120 ms 及更小的节奏容差判为偏晚。建议应用补偿。`;state.suggestedLatency=med;$('apply-latency').textContent=`应用 ${med} ms 补偿`;$('apply-latency').hidden=false;}
  else advice='固定延迟很小，不是弹错的主要原因；请查看下方演奏诊断中的音高与节奏分析。';
  state.calibrationResult=head+advice;$('latency-status').textContent=state.calibrationResult;
  try{localStorage.setItem('cadence.lastCalibration',state.calibrationResult);}catch{}
}
function displayPlayedNotes(notes=[...state.held].sort((a,b)=>a-b),down=state.held.size>0) {
  const actual=notes.length?notes:state.lastPlayed;
  const text=hidingLive()?'演奏中不显示 · 结束或暂停后在谱面回看你弹的每个音':actual.length?`${down?'按下':'刚弹'} ${actual.map(noteName).join(' + ')}${actual.length===1?` · MIDI ${actual[0]}`:''} · 力度 ${state.lastVelocity}`:'等待输入';
  $('last-note').textContent=text;$('played-notes').textContent=text;
  renderActualNotes();
  $('input-dot').style.background=down?'#5e9d78':'';
}
function noteOff(midi) {state.held.delete(midi);paintKeys();displayPlayedNotes();}
function midiMessage(event) {
  const [status,note,velocity]=event.data;const command=status&0xf0;
  if(command===0x90&&velocity>0)noteOn(note,velocity,false,event.timeStamp);
  if(command===0x80||(command===0x90&&velocity===0))noteOff(note);
  if(command===0xb0 && (note===120||note===123)){state.held.clear();paintKeys();displayPlayedNotes();}
}
function updateDevices() {
  const inputs=[...state.midi.inputs.values()].filter(p=>p.state==='connected');
  state.midi.inputs.forEach(p=>p.onmidimessage=p.state==='connected'?midiMessage:null);
  $('connect').classList.toggle('connected',inputs.length>0);
  $('device-label').textContent=inputs.length?inputs.map(p=>p.name||'MIDI Piano').join(' / '):'未检测到电钢琴';
  $('midi-hint').textContent=inputs.length?'MIDI 已就绪 · 弹奏电钢琴，琴键与演奏位置会实时响应。':'未发现 MIDI 输入设备。检查 USB / 蓝牙 MIDI 连接，重新接入后会自动识别。';
  if(!inputs.length){state.held.clear();paintKeys();displayPlayedNotes();if(state.running&&!state.listening){pause();toast('MIDI 连接已断开，练习已暂停。');}}
}
async function connect() {
  const report=(label,message)=>{$('connect').classList.remove('connected');$('device-label').textContent=label;$('midi-hint').textContent=message;toast(message);};
  if(!window.isSecureContext) return report('需要安全页面','请用 Chrome / Edge 打开 http://localhost:5173，当前页面不允许访问 MIDI。');
  if(!navigator.requestMIDIAccess) return report('浏览器不支持 MIDI','请在独立的 Chrome / Edge 窗口打开 http://localhost:5173。');
  const policy=document.permissionsPolicy||document.featurePolicy;
  if(policy?.allowsFeature && !policy.allowsFeature('midi')) return report('页面策略禁止 MIDI','当前页面或内嵌预览禁止 MIDI。请在独立的 Chrome / Edge 标签页打开 http://localhost:5173。');
  $('connect').disabled=true;$('device-label').textContent='等待浏览器授权…';
  try {
    state.midi=state.midi||await navigator.requestMIDIAccess({sysex:false});
    state.midi.onstatechange=updateDevices;updateDevices();
    if([...state.midi.inputs.values()].some(p=>p.state==='connected'))toast('MIDI 访问已开启，请弹一个音试试。');
  } catch(error) {
    const detail=`${error.name||'Error'}${error.message?'：'+error.message:''}`;
    if(['NotAllowedError','SecurityError'].includes(error.name)) {
      report('MIDI 权限被阻止',`请点击地址栏左侧的网站设置，将「MIDI 设备」权限改为允许，刷新后重新连接；若在内嵌预览中，请改用独立浏览器。错误：${detail}`);
    } else {
      report('MIDI 初始化失败',`未能启动 MIDI。可尝试关闭其他使用电钢琴的软件、重新连接 USB 后重试。错误：${detail}`);
    }
    console.warn('MIDI connection failed:',error);
  } finally {$('connect').disabled=false;}
}
function initAudio() {
  try {state.audio ||= new (window.AudioContext||window.webkitAudioContext)();if(state.audio.state==='suspended')state.audio.resume();}catch{}
}
function tone(midi,duration=.3,velocity=.5) {
  if(!state.audio) return;
  const ctx=state.audio, gain=ctx.createGain(),osc=ctx.createOscillator();osc.type='triangle';osc.frequency.value=440*2**((midi-69)/12);
  const now=ctx.currentTime;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.12*velocity,now+.008);gain.gain.exponentialRampToValueAtTime(.001,now+Math.max(.04,duration));osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(now+duration+.03);state.voices.add(osc);osc.onended=()=>{state.voices.delete(osc);gain.disconnect();};
}
function stopSound(){state.voices.forEach(o=>{try{o.stop();}catch{}});state.voices.clear();}
function soundEvent(){const notes=state.events[state.index]?.notes||[];notes.filter(n=>state.hand==='both'||n.staff===state.staffIds[state.hand==='right'?0:1]).forEach(n=>tone(n.midi,Math.min(4,n.duration*60/state.bpm*.85),.65));}
function clickSound(accent=false){if(state.metronomeVolume>0)tone(accent?100:96,.045,(accent?.72:.48)*state.metronomeVolume);}
function setTempo(value) {if(state.running)updateClock(performance.now());state.bpm=Math.max(30,Math.min(200,Math.round(Number(value)||80)));$('tempo').value=state.bpm;$('bpm').textContent=state.bpm;$('metronome-tempo').textContent=`♩ = ${state.bpm} BPM`;replanBacking();}
// Human swing ratio follows the tempo: re-plan, resuming after the notes already handed to the audio clock.
function replanBacking(){const b=state.backing;if(!b?.notes)return;const until=state.running?b.until:null;prepareBacking();if(b.notes&&until!=null){b.until=until;b.next=b.notes.findIndex(n=>n.beat>until+1e-9);if(b.next<0)b.next=b.notes.length;}}
function buildKeyboard() {
  const whites=[];for(let n=36;n<=84;n++)if(![1,3,6,8,10].includes(n%12))whites.push(n);
  for(let n=36;n<=84;n++) {
    const black=[1,3,6,8,10].includes(n%12);const key=document.createElement('button');key.className='key'+(black?' black':'');key.dataset.midi=n;key.setAttribute('aria-label',noteName(n));
    if(black){key.style.left=(whites.filter(w=>w<n).length/whites.length*100)+'%';key.style.width=(60/whites.length)+'%';}
    else key.textContent=noteName(n);
    key.onpointerdown=e=>{e.preventDefault();key.setPointerCapture(e.pointerId);noteOn(n,90,true);};
    key.onpointerup=key.onpointercancel=()=>noteOff(n);key.onlostpointercapture=()=>noteOff(n);
    $('keyboard').append(key);
  }
}
function rerender() {
  if(!state.osmd||state.loading)return;
  pause();state.osmd.Zoom=.9*state.zoom;applySystemLayout(state.osmd);state.osmd.render();positionCursor(state.index);
  cacheCursorPoints();
  bindScoreNotes();state.noteColors.forEach((color,note)=>state.osmd.EngravingRules.GNote(note)?.setColor(color,{applyToNoteheads:true,applyToStem:false,applyToBeams:false}));
  state.markerNodes.forEach(n=>n.remove());state.markerNodes=[];updatePosition();$('zoom-value').textContent=Math.round(state.zoom*100)+'%';$('scale-label').textContent=Math.round(state.zoom*100)+'%';$('score-size').value=Math.round(state.zoom*100);
}
function setZoom(value){state.zoom=Math.max(.7,Math.min(3.5,Math.round(value*10)/10));layout.zoom=state.zoom;saveLayout();rerender();}
async function toggleFullscreen() {
  const workspace=$('practice-workspace');
  if(document.fullscreenElement){await document.exitFullscreen();return;}
  if(workspace.classList.contains('focus-mode')){workspace.classList.remove('focus-mode');syncFullscreen();return;}
  try {await workspace.requestFullscreen();}catch{workspace.classList.add('focus-mode');syncFullscreen();toast('已进入页面内全屏，按 Esc 或再次点击按钮退出。');}
}
function syncFullscreen() {
  const active=!!document.fullscreenElement||$('practice-workspace').classList.contains('focus-mode');
  $('fullscreen').textContent=active?'⛶ 退出全屏':'⛶ 全屏练习';$('fullscreen').setAttribute('aria-pressed',active);
  applyLayout(false);
  clearTimeout(resizeTimer);resizeTimer=setTimeout(rerender,120);
}
function isFullscreen(){return !!document.fullscreenElement||$('practice-workspace').classList.contains('focus-mode');}
function saveLayout(){try{localStorage.setItem('cadence.layout.v1',JSON.stringify(layout));}catch{}}
function applyLayout(render=true) {
  const workspace=$('practice-workspace'),full=isFullscreen(),settings=full?layout.fullscreenSettings:layout.settings,compact=full?layout.fullscreenCompact:layout.compact;
  workspace.classList.toggle('settings-hidden',!settings);workspace.classList.toggle('compact-ui',compact);
  workspace.style.setProperty('--sidebar-width',layout.sidebar+'px');workspace.style.setProperty('--stage-height',layout.height+'px');
  document.querySelector('.keyboard-panel').hidden=!layout.keyboard;
  $('show-settings').checked=settings;$('compact-ui').checked=compact;$('show-keyboard').checked=layout.keyboard;
  $('sidebar-size').value=layout.sidebar;$('sidebar-size-value').textContent=layout.sidebar+' px';$('stage-height').value=layout.height;
  $('show-playhead').checked=layout.playhead;$('live-notes').checked=layout.liveNotes;$('measures-per-line').value=layout.measuresPerLine;$('octave-rule').value=layout.octaveRule;$('backing-enabled').checked=layout.backing;$('backing-bass').checked=layout.backingBass;$('backing-drums').checked=layout.backingDrums;$('backing-volume').value=Math.round(layout.backingVolume*100);$('backing-feel').value=layout.backingFeel;$('backing-volume-value').textContent=Math.round(layout.backingVolume*100)+'%';$('auto-follow').checked=layout.follow;$('follow-style').value=layout.followStyle;$('count-in-bars').value=String(layout.countInBars);$('unroll-repeats').checked=layout.unrollRepeats;renderTimingWindow();
  $('score-size').value=Math.round(state.zoom*100);$('zoom-value').textContent=Math.round(state.zoom*100)+'%';$('scale-label').textContent=Math.round(state.zoom*100)+'%';
  saveLayout();if(render){clearTimeout(resizeTimer);resizeTimer=setTimeout(rerender,120);}
}
// Scores from sheet/ (listed by server.cjs); a fetched .mxl goes through the same unzip path as an imported file.
async function loadSheet(file) {
  try {
    const response=await fetch(file);if(!response.ok)throw new Error(`无法读取 ${file}`);
    const name=file.split('/').pop();
    if(/\.mxl$/i.test(name))await readFile(new File([await response.blob()],name));
    else await loadScore(await response.text(),name);
  } catch(error){toast(error.message);}
  $('score-picker').value=file;
}
async function loadSheetList() {
  try {
    // Live listing from server.cjs; sheet/index.json covers servers without that endpoint.
    let sheets=[];
    for(const url of ['api/sheets','sheet/index.json']){try{const response=await fetch(url,{cache:'no-store'});if(response.ok){sheets=await response.json();if(Array.isArray(sheets)&&sheets.length)break;}}catch{}}
    if(!Array.isArray(sheets)||!sheets.length)return;
    sheets.sort((a,b)=>(b.file===REFERENCE_SCORE)-(a.file===REFERENCE_SCORE));
    const current=$('score-picker').value;
    $('score-picker').replaceChildren(...sheets.map(s=>new Option(s.file===REFERENCE_SCORE?`${s.title} · 参考谱`:s.title,s.file)));
    $('score-picker').value=current;
  } catch {}
}
async function loadReference() {
  try {const response=await fetch(REFERENCE_SCORE);if(!response.ok)throw new Error('无法读取参考谱，请确认 sheet/Waltz_for_Debby_bars_1-40.musicxml 存在。');await loadScore(await response.text(),'Waltz for Debby');}
  catch(error){$('loading').textContent=error.message;toast(error.message);}
}
$('import').onclick=$('library').onclick=()=>$('file').click();$('file').onchange=e=>readFile(e.target.files[0]);
$('demo').onclick=()=>loadScore(makeDemo(),'示例曲',true);$('connect').onclick=connect;
$('play').onclick=()=>start();$('listen').onclick=()=>{if(state.running){pause();return;}reset();start(true);};$('restart').onclick=reset;
$('tempo').oninput=e=>setTempo(e.target.value);$('slower').onclick=()=>setTempo(state.bpm-5);$('faster').onclick=()=>setTempo(state.bpm+5);$('original-tempo').onclick=()=>setTempo(state.originalBpm);
$('metronome').onclick=$('open-metronome').onclick=()=>{renderMetronome();$('metronome-panel').showModal();};
$('close-metronome').onclick=()=>$('metronome-panel').close();
$('metronome-enabled').onchange=e=>{state.metronome=e.target.checked;saveMetronome();renderMetronome();};
document.querySelectorAll('[data-beat-preset]').forEach(button=>button.onclick=()=>{
  const meter=meterAt(state.index),preset=button.dataset.beatPreset;
  state.metronomePatterns[`${meter.beats}/${meter.beatType}`]=Array.from({length:meter.beats},(_,i)=>i+1).filter(n=>preset==='all'||(preset==='first'&&n===1)||(preset==='last'&&n===meter.beats));
  saveMetronome();renderMetronome();
});
function syncMetronomeVolume(){for(const id of ['metronome-volume','metronome-panel-volume']){$(id).value=Math.round(state.metronomeVolume*100);$(id+'-value').textContent=`${Math.round(state.metronomeVolume*100)}%`;}}
syncMetronomeVolume();
try{const saved=JSON.parse(localStorage.getItem('cadence.lastPerformance')||'null');if(saved?.text)$('performance-diagnosis').textContent=`上次记录：${saved.text}`;}catch{}
$('metronome-volume').oninput=$('metronome-panel-volume').oninput=e=>{state.metronomeVolume=Number(e.target.value)/100;syncMetronomeVolume();try{localStorage.setItem('cadence.metronomeVolume',String(state.metronomeVolume));}catch{}};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{state.mode=button.dataset.mode;reset();document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('selected',b===button));$('mode-help').textContent=state.mode==='wait'?'音乐会等你。弹对当前音符，再继续前进。':'跟随固定节拍演奏。错音和漏音也会被记录。';});
$('hand').onchange=e=>{state.hand=e.target.value;reset();if(!state.events.some(event=>activeNotes(event).length)){state.hand='both';$('hand').value='both';updatePosition();toast('乐谱没有独立的第二谱表，已切换为双手。');}};
$('zoom-in').onclick=()=>setZoom(state.zoom+.1);$('zoom-out').onclick=()=>setZoom(state.zoom-.1);
$('score-size').oninput=e=>setZoom(Number(e.target.value)/100);$('zoom-reset').onclick=()=>setZoom(1);
$('fullscreen').onclick=toggleFullscreen;document.addEventListener('fullscreenchange',syncFullscreen);
$('reference-score').onclick=()=>loadSheet(REFERENCE_SCORE);
$('score-picker').onchange=e=>loadSheet(e.target.value);
$('show-settings').onchange=e=>{layout[isFullscreen()?'fullscreenSettings':'settings']=e.target.checked;applyLayout();};
$('compact-ui').onchange=e=>{layout[isFullscreen()?'fullscreenCompact':'compact']=e.target.checked;applyLayout();};
$('show-keyboard').onchange=e=>{layout.keyboard=e.target.checked;applyLayout(false);};
$('sidebar-size').oninput=e=>{layout.sidebar=Number(e.target.value);applyLayout();};
$('stage-height').oninput=e=>{layout.height=Number(e.target.value);applyLayout();};
$('backing-enabled').onchange=e=>{layout.backing=e.target.checked;saveLayout();if(layout.backing){loadBacking();prepareBacking();}else stopBacking();renderBackingStatus();};
$('backing-bass').onchange=e=>{layout.backingBass=e.target.checked;saveLayout();renderBackingStatus();};
$('backing-drums').onchange=e=>{layout.backingDrums=e.target.checked;saveLayout();renderBackingStatus();};
$('backing-feel').onchange=e=>{layout.backingFeel=e.target.value;saveLayout();replanBacking();};
$('backing-volume').oninput=e=>{layout.backingVolume=Number(e.target.value)/100;$('backing-volume-value').textContent=e.target.value+'%';saveLayout();};
$('count-in-bars').onchange=e=>{layout.countInBars=Number(e.target.value)===2?2:1;saveLayout();renderCountInLabel();};
$('octave-rule').onchange=e=>{layout.octaveRule=e.target.value;saveLayout();reset();};
$('measures-per-line').onchange=e=>{layout.measuresPerLine=e.target.value;saveLayout();rerender();};
$('live-notes').onchange=e=>{layout.liveNotes=e.target.checked;saveLayout();renderActualNotes();displayPlayedNotes();};
$('show-playhead').onchange=e=>{layout.playhead=e.target.checked;saveLayout();drawPlayhead();};
$('auto-follow').onchange=e=>{layout.follow=e.target.checked;state.followTarget=null;saveLayout();drawPlayhead();};
$('follow-style').onchange=e=>{layout.followStyle=e.target.value;state.followTarget=null;saveLayout();drawPlayhead();};
// Reloads the current score from its original XML, written out or as notated; the file itself is never changed.
$('unroll-repeats').onchange=e=>{if(state.loading){e.target.checked=layout.unrollRepeats;return toast('正在处理上一份乐谱，请稍候。');}layout.unrollRepeats=e.target.checked;saveLayout();if(state.sourceXml&&!state.loading)loadScore(state.sourceXml,state.sourceName,state.sourceDemo);};
$('reset-layout').onclick=()=>{const unroll=layout.unrollRepeats;layout={...layoutDefaults};state.zoom=layout.zoom;applyLayout();if(unroll!==layout.unrollRepeats&&state.sourceXml)loadScore(state.sourceXml,state.sourceName,state.sourceDemo);};
const resizer=$('panel-resizer');let draggingPanel=false;
resizer.onpointerdown=e=>{pause();draggingPanel=true;resizer.setPointerCapture(e.pointerId);};
resizer.onpointermove=e=>{if(!draggingPanel)return;layout.sidebar=Math.max(200,Math.min(440,Math.round($('practice-workspace').getBoundingClientRect().right-e.clientX)));applyLayout(false);};
resizer.onpointerup=resizer.onpointercancel=()=>{if(draggingPanel){draggingPanel=false;applyLayout();}};
resizer.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();layout.sidebar=Math.max(200,Math.min(440,layout.sidebar+(e.key==='ArrowLeft'?10:-10)));applyLayout();}};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('practice-workspace').classList.contains('focus-mode')){$('practice-workspace').classList.remove('focus-mode');syncFullscreen();}});
$('detection').onchange=$('anchor').onchange=$('rhythm').onchange=changeDetection;
$('anchor').disabled=true;
$('lead-demo').onclick=async()=>{try{const response=await fetch('examples/lead-sheet.musicxml');if(!response.ok)throw new Error('示例读取失败');await loadScore(await response.text(),'Lead Sheet 示例');}catch(error){toast(error.message);}};
$('close-result').onclick=()=>$('result').close();$('again').onclick=()=>{$('result').close();reset();start();};
$('range-start').onchange=$('range-end').onchange=changeRange;
$('whole-score').onclick=()=>{$('range-start').value=1;$('range-end').value=state.osmd.Sheet.SourceMeasures.length;changeRange();};
// Tolerance: presets or any value on the slider (40–400 ms); the matcher reads layout.timingWindow on each pass.
function setTimingWindow(ms,custom=layout.timingCustom){layout.timingCustom=custom;layout.timingWindow=Math.max(40,Math.min(400,Math.round(Number(ms)/10)*10||200));saveLayout();renderTimingWindow();reset();}
function renderTimingWindow(){const ms=layout.timingWindow,preset=!layout.timingCustom&&['200','120','80'].includes(String(ms));$('timing-window').value=preset?String(ms):'custom';$('timing-window-range').value=ms;$('timing-window-value').textContent=`±${ms} ms`;}
// 自定义 stays selected (keeping the slider value) until a preset is chosen; moving the slider counts as custom.
$('timing-window').onchange=e=>{if(e.target.value==='custom'){layout.timingCustom=true;saveLayout();renderTimingWindow();$('timing-window-range').focus();return;}setTimingWindow(e.target.value,false);};
$('timing-window-range').oninput=e=>setTimingWindow(e.target.value,true);
$('calibrate').onclick=calibrateLatency;$('apply-latency').onclick=()=>{setLatency(state.suggestedLatency||0);$('apply-latency').hidden=true;toast(`已应用 ${state.latencyMs} ms 延迟补偿，跟拍判定会提前这段时间。`);};$('clear-latency').onclick=()=>{setLatency(0);toast('已清除延迟补偿。');};
$('allow-accompaniment').onchange=()=>reset();
try{state.calibrationResult=localStorage.getItem('cadence.lastCalibration')||null;if(state.calibrationResult)$('latency-status').textContent=`上次校准：${state.calibrationResult}`;}catch{}latencyLabel();
$('score').onclick=e=>{const target=e.target.closest('[data-event-index]');if(!target)return;const index=Number(target.dataset.eventIndex);if(index<state.startIndex||index>state.endIndex){$('range-start').value=1;$('range-end').value=state.osmd.Sheet.SourceMeasures.length;changeRange();}reset(index);feedback(`从${barLabel(state.events[index].measure)}开始，点击「开始练习」。`);};
const computerKeys={a:60,w:61,s:62,e:63,d:64,f:65,t:66,g:67,y:68,h:69,u:70,j:71,k:72};
document.addEventListener('keydown',e=>{if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)||$('result').open)return;if(e.code==='Space'){e.preventDefault();start();}else if(computerKeys[e.key.toLowerCase()])noteOn(computerKeys[e.key.toLowerCase()],90,true);});
document.addEventListener('keyup',e=>{if(computerKeys[e.key.toLowerCase()])noteOff(computerKeys[e.key.toLowerCase()]);});
window.addEventListener('blur',()=>{state.held.clear();paintKeys();displayPlayedNotes();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.running)pause();});
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(rerender,250);});
let dragDepth=0;document.addEventListener('dragenter',e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files')){dragDepth++;document.body.classList.add('dragging');}});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',()=>{if(--dragDepth<=0)document.body.classList.remove('dragging');});document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('dragging');readFile(e.dataTransfer.files[0]);});
applyLayout(false);buildKeyboard();loadReference();loadSheetList();
