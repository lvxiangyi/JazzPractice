'use strict';
const LeadSheet = (()=>{
  const pc=n=>((n%12)+12)%12;
  const steps={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
  const kinds={major:[4,7,11],minor:[3,7,10],dominant:[4,7,10],'major-seventh':[4,7,11],'minor-seventh':[3,7,10],diminished:[3,6,9],'diminished-seventh':[3,6,9],'half-diminished':[3,6,10],augmented:[4,8,11],'augmented-seventh':[4,8,10],'augmented-major-seventh':[4,8,11],'major-minor':[3,7,11],'dominant-ninth':[4,7,10],'major-ninth':[4,7,11],'minor-ninth':[3,7,10],'dominant-11th':[4,7,10],'major-11th':[4,7,11],'minor-11th':[3,7,10],'dominant-13th':[4,7,10],'major-13th':[4,7,11],'minor-13th':[3,7,10],
    // Sixth chords have no written 7th; the 6th takes the 7th's role as the guide tone.
    'major-sixth':[4,7,9],'minor-sixth':[3,7,9]};
  const text=(node,path)=>node.querySelector(path)?.textContent?.trim();
  function chord(node) {
    const kind=text(node,'kind');
    if(kind==='none')return {none:true,label:'N.C.'};
    const step=text(node,'root > root-step'),alter=Number(text(node,'root > root-alter')||0);
    const quality=kinds[kind];
    if(steps[step]===undefined||!Number.isInteger(alter)||!quality)return {error:`暂不支持和弦类型 ${kind||'未标明'}（需要明确的 3、7 音）`};
    if(node.querySelectorAll('root').length!==1)return {error:'暂不支持叠置和弦'};
    const root=pc(steps[step]+alter),degrees={1:0,3:quality[0],5:quality[1],7:quality[2],9:14};
    const defaults={1:0,2:2,3:4,4:5,5:7,6:9,7:11,9:14,11:17,13:21};
    for(const d of node.querySelectorAll(':scope > degree')) {
      const value=Number(text(d,'degree-value')),delta=Number(text(d,'degree-alter')||0),type=text(d,'degree-type');
      if(!Number.isInteger(delta))return {error:'暂不支持微分音和弦'};
      if(type==='subtract')delete degrees[value];
      else if(type==='alter')degrees[value]=(degrees[value]??defaults[value])+delta;
      else if(type==='add')degrees[value]=(defaults[value]??0)+delta;
    }
    const label=step+(alter===1?'♯':alter===-1?'♭':alter?'('+alter+')':'')+' '+(node.querySelector('kind')?.getAttribute('text')||kind);
    // Slash-chord bass (e.g. Fmaj7/A) is kept for the backing bass line; detection still voices the chord without it.
    const bassStep=text(node,'bass > bass-step'),bass=steps[bassStep]===undefined?undefined:pc(steps[bassStep]+Number(text(node,'bass > bass-alter')||0));
    return {root,kind,degrees,label,bass,implied:['major','minor','diminished','augmented'].includes(kind)};
  }
  function parse(doc) {
    const part=doc.querySelector('score-partwise > part');
    let divisions=1,beats=4,beatType=4,id=0;const harmonies=[],meters=[],marks=new Set(),laterEndings=new Set();
    const measures=[...part.children].filter(n=>n.tagName==='measure');
    for(const [measureIndex,measure] of measures.entries()) {
      let cursor=0;
      // Section starts for the backing's phrasing: rehearsal marks, double / final barlines and repeat signs (measure numbers by position).
      if(measure.querySelector('direction rehearsal'))marks.add(measureIndex+1);
      // A 2nd (or later) ending replaces the 1st-ending bars in playback, so it continues the phrase instead of starting a section.
      for(const ending of measure.querySelectorAll(':scope > barline > ending[type="start"]'))if(!((ending.getAttribute('number')||'1').match(/\d+/g)||['1']).includes('1'))laterEndings.add(measureIndex+1);
      for(const barline of measure.querySelectorAll(':scope > barline')) {
        const right=(barline.getAttribute('location')||'right')==='right',style=text(barline,'bar-style'),repeat=barline.querySelector('repeat')?.getAttribute('direction');
        if(['light-light','light-heavy'].includes(style)||repeat)marks.add(measureIndex+1+(right?1:0));
      }
      for(const node of measure.children) {
        if(node.tagName==='attributes') {
          const groups=(text(node,'time > beats')||'').split('+').map(Number);
          divisions=Number(text(node,'divisions'))||divisions;if(groups.every(n=>Number.isFinite(n)&&n>0))beats=groups.reduce((a,b)=>a+b,0);beatType=Number(text(node,'time > beat-type'))||beatType;
        } else if(node.tagName==='backup')cursor-=Number(text(node,'duration')||0)/divisions;
        else if(node.tagName==='forward')cursor+=Number(text(node,'duration')||0)/divisions;
        else if(node.tagName==='note'&&!node.querySelector('chord')&&!node.querySelector('grace'))cursor+=Number(text(node,'duration')||0)/divisions;
        else if(node.tagName==='harmony')harmonies.push({measure:measureIndex+1,relative:cursor+Number(text(node,'offset')||0)/divisions,id:++id,...chord(node)});
      }
      meters.push({beats,beatType});
    }
    harmonies.sort((a,b)=>a.measure-b.measure||a.relative-b.relative||a.id-b.id);
    const sections=[...marks].filter(m=>m>=1&&m<=measures.length&&!laterEndings.has(m)).sort((a,b)=>a-b);
    return {harmonies,meters,sections};
  }
  function nearestVoicing(ch,level,previous=[],max=59,melodies=[]) {
    const degrees=level===1?[3,7]:[3,5,7,9];
    if(degrees.some(d=>!Number.isFinite(ch.degrees[d])))throw new Error(`${ch.label} 缺少所需的 ${degrees.join('、')} 音`);
    const pcs=degrees.map(d=>pc(ch.root+ch.degrees[d]));
    if(new Set(pcs).size!==pcs.length)throw new Error(`${ch.label} 的指定和弦音重合，暂无法生成独立声部`);
    const candidates=[];
    function visit(i,notes) {
      if(i===pcs.length){const sorted=notes.slice().sort((a,b)=>a-b);if(sorted.at(-1)-sorted[0]>12)return;
        if(level===3&&melodies.some(m=>rightOptions(ch,m,sorted).length===0))return;
        const motion=previous.length===sorted.length?sorted.reduce((sum,n,j)=>sum+Math.abs(n-previous[j]),0):sorted.reduce((sum,n)=>sum+Math.abs(n-50),0);
        candidates.push({notes:sorted,score:motion});return;}
      for(let n=36;n<=max;n++)if(pc(n)===pcs[i])visit(i+1,[...notes,n]);
    }
    visit(0,[]);candidates.sort((a,b)=>a.score-b.score||a.notes.at(-1)-b.notes.at(-1));
    if(!candidates.length)throw new Error(`${ch.label} 没有可用的紧密排列；旋律可能过低`);
    return candidates[0].notes;
  }
  function rightOptions(ch,melody,left) {
    const guides=[ch.degrees[3],ch.degrees[7]].filter(Number.isFinite).map(d=>pc(ch.root+d));
    const result=[];
    for(let n=Math.max(36,melody-12,(left.at(-1)||35)+1);n<melody;n++)if(guides.includes(pc(n))&&pc(n)!==pc(melody))result.push(n);
    return result;
  }
  function compile(base,meta,level,anchor='chord') {
    if(!meta.harmonies.length)throw new Error('该乐谱没有 MusicXML 和弦标记。请导入带和弦符号的 Lead Sheet，或使用「原谱检测」。');
    const events=base.map(e=>({...e}));
    // Insert harmony-only positions without altering the displayed score or its cursor iterator.
    const visits=[];
    base.forEach(e=>{const start=e.beat-e.relativeBeat;const last=visits.at(-1);if(!last||last.measure!==e.measure||Math.abs(last.start-start)>1e-5)visits.push({measure:e.measure,start,duration:e.measureDuration});});
    const beatKeys=new Set(events.map(e=>e.beat.toFixed(6)));
    const byMeasure=new Map();for(const h of meta.harmonies){if(!byMeasure.has(h.measure))byMeasure.set(h.measure,[]);byMeasure.get(h.measure).push(h);}
    for(const visit of visits)for(const h of byMeasure.get(visit.measure)||[]) {
      if(h.relative<0||h.relative>=visit.duration)throw new Error(`第 ${h.measure} 小节的和弦偏移超出小节，暂不支持`);
      const beat=visit.start+h.relative;
      if(!beatKeys.has(beat.toFixed(6))) {
        let lo=0,hi=base.length;while(lo<hi){const mid=(lo+hi)>>1;if(base[mid].beat<=beat)lo=mid+1;else hi=mid;}
        const prior=base[Math.max(0,lo-1)];
        events.push({...prior,beat,relativeBeat:h.relative,measure:visit.measure,notes:[],duration:0,eighth:false});
        beatKeys.add(beat.toFixed(6));
      }
    }
    events.sort((a,b)=>a.beat-b.beat);
    let previousId=null,previousMeasure=0,previousRelative=-1,segment=-1;const segments=[];
    const melodyStaff=Math.min(...base.flatMap(e=>e.notes.map(n=>n.staff)));
    for(const event of events) {
      let lo=0,hi=meta.harmonies.length;
      while(lo<hi){const mid=(lo+hi)>>1,h=meta.harmonies[mid];if(h.measure<event.measure||h.measure===event.measure&&h.relative<=event.relativeBeat+1e-6)lo=mid+1;else hi=mid;}
      // A pickup before the first chord symbol is melody only, like N.C.
      const h=meta.harmonies[lo-1]??{none:true,label:'N.C.',id:0};
      const melody=event.notes.filter(n=>n.staff===melodyStaff).sort((a,b)=>b.midi-a.midi)[0];
      if(h.error)throw new Error(h.error);
      // Repeated visits re-articulate the harmony, even when a repeat uses the same symbol.
      const changed=h.id!==previousId||event.measure<previousMeasure||event.measure===previousMeasure&&event.relativeBeat<=previousRelative;
      previousMeasure=event.measure;previousRelative=event.relativeBeat;
      if(changed){segment++;segments.push({h,events:[]});previousId=h.id;}
      const meter=meta.meters[event.measure-1]||{beats:4,beatType:4};
      // Pickup bars are right-aligned in their meter before judging strong beats.
      const bar=meter.beats*4/meter.beatType,position=event.relativeBeat+(event.measure===1&&event.measureDuration<bar-1e-6?bar-event.measureDuration:0);
      const strong=meter.beatType===8&&meter.beats%3===0?position%1.5<1e-6:position<1e-6||(meter.beats===4&&Math.abs(position-2)<1e-6);
      const firstMelody=!segments[segment].events.some(e=>e.lead.melody);
      event.lead={chord:h,melody,leftAttack:changed,anchor:!!melody&&(anchor==='all'||anchor==='strong'&&strong||anchor==='chord'&&firstMelody)};
      segments[segment].events.push(event);
    }
    let previous=[];
    for(const seg of segments) {
      const ch=seg.h;
      const melodies=seg.events.filter(e=>e.lead.anchor).map(e=>e.lead.melody.midi);
      const upper=Math.min(59,...seg.events.filter(e=>e.lead.melody).map(e=>e.lead.melody.midi-1));
      const left=ch.none?[]:nearestVoicing(ch,level,previous,upper,melodies);
      if(left.length)previous=left;
      for(const event of seg.events) {
        const melody=event.lead.melody;
        event.lead.left=left;
        event.lead.targets=[];
        if(melody)event.lead.targets.push({...melody,hand:'right'});
        if(event.lead.leftAttack)left.forEach(midi=>event.lead.targets.push({midi,hand:'left',duration:1}));
        if(level===3&&event.lead.anchor&&!ch.none) {
          const accepts=rightOptions(ch,melody.midi,left);
          if(!accepts.length)throw new Error(`第 ${event.measure} 小节旋律过低，无法在旋律下加入独立的 3 / 7 音`);
          event.lead.targets.push({key:'guide',midi:accepts.at(-1),accepts,hand:'right',duration:melody.duration});
        }
      }
    }
    events.forEach((e,i)=>e.end=events[i+1]?.beat??base.at(-1).end);
    return events;
  }
  function swing(events,base,enabled,meters=[]) {
    const pairs=new Set();
    if(enabled) {
      const groups=new Map();
      for(const e of base){const q=Math.floor(e.beat+1e-6);if(!groups.has(q))groups.set(q,[]);groups.get(q).push(e);}
      for(const [q,group] of groups) {
        const meter=meters[group[0].measure-1];
        if(meter?.beatType===8&&meter.beats%3===0)continue;
        if(group.some(e=>e.swingBlocked||Math.abs(e.beat-q)>.00001&&Math.abs(e.beat-q-.5)>.00001))continue;
        if(group.some(e=>Math.abs(e.beat-q)<1e-6&&e.eighth)&&group.some(e=>Math.abs(e.beat-q-.5)<1e-6&&e.eighth))pairs.add(q);
      }
    }
    const warp=beat=>{const q=Math.floor(beat+1e-7),f=beat-q;if(!pairs.has(q))return beat;return q+(f<=.5?f*4/3:2/3+(f-.5)*2/3);};
    return events.map(e=>({...e,straightBeat:e.beat,beat:warp(e.beat),end:warp(e.end),notes:e.notes.map(n=>({...n,duration:warp(e.beat+n.duration)-warp(e.beat)}))}));
  }
  return {parse,chord,compile,nearestVoicing,rightOptions,swing};
})();
if(typeof module!=='undefined')module.exports={LeadSheet};
