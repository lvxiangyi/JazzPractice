'use strict';
// Rule-based backing (walking bass + brush drums) generated from the score's chord symbols, played from bundled FluidR3_GM samples.
window.Backing=(()=>{
  const pc=n=>((n%12)+12)%12;
  const drumFiles={ride:'ride.wav',ride2:'ride2.wav',foot:'hihat-foot.wav',kick:'kick.wav',tap:'brush-tap.wav',swirl:'brush-swirl.wav'};
  const BASS_LOW=26,BASS_HIGH=60,BASS_RANGE=[28,52];
  let buffers=null,loading=null;

  async function decode(ctx,url){const response=await fetch(url);if(!response.ok)throw new Error(`无法读取伴奏音色 ${url}`);return ctx.decodeAudioData(await response.arrayBuffer());}
  function load(ctx){
    loading||=(async()=>{
      const result={drums:{},bass:{}};
      await Promise.all([
        ...Object.entries(drumFiles).map(async([key,file])=>{result.drums[key]=await decode(ctx,`vendor/accompaniment/drums/${file}`);}),
        ...Array.from({length:BASS_HIGH-BASS_LOW+1},(_,i)=>BASS_LOW+i).map(async midi=>{result.bass[midi]=await decode(ctx,`vendor/accompaniment/bass/${midi}.mp3`);}),
      ]);
      buffers=result;return result;
    })().catch(error=>{loading=null;throw error;});
    return loading;
  }
  const ready=()=>!!buffers;

  // Measure visits in playback order (repeats already enrolled), each with the chords that apply inside it.
  function timeline(base,meta){
    const visits=[];
    for(const e of base){
      const start=(e.straightBeat??e.beat)-e.relativeBeat,last=visits.at(-1);
      if(last&&last.measure===e.measure&&Math.abs(last.start-start)<1e-5)continue;
      const meter=meta.meters[e.measure-1]||{beats:4,beatType:4};
      // A short first bar is a pickup (on every visit, as in app.js pickupPad): its beats are the last ones of a full bar.
      const unit=4/meter.beatType,pad=e.measure===1&&e.measureDuration<meter.beats*unit-1e-6?meter.beats*unit-e.measureDuration:0;
      visits.push({measure:e.measure,start,duration:e.measureDuration,pad,beats:meter.beats,unit,chords:meta.harmonies.filter(h=>h.measure===e.measure&&!h.error).map(h=>({at:start+h.relative,chord:h}))});
    }
    return visits;
  }

  function random(seed){let a=seed>>>0||1;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
  // Octave of a pitch class near the previous bass note, gently pulled toward the middle of the range so the line does not sink or climb.
  function near(pitchClass,previous){
    let best=null,score=Infinity;
    for(let n=BASS_RANGE[0];n<=BASS_RANGE[1];n++){
      if(pc(n)!==pitchClass)continue;
      const cost=Math.abs(n-previous)+.45*Math.abs(n-40);
      if(cost<score){score=cost;best=n;}
    }
    return best;
  }

  // The pickup bar the session starts in is the soloist's lead-in: the band stays out and enters on the next downbeat (a pickup reached later, e.g. on a repeat, is played through).
  const leadIn=(visit,from)=>!!visit.pad&&from>=visit.start-1e-6&&from<visit.start+visit.duration-1e-6;

  // Feel 'simple' (the original rules) or 'human' / 'human-2feel' (target-directed walking, micro-timing, phrase-aware brushes).
  function plan(visits,from,to,seed=1,options={}){
    return (options.feel||'simple')==='simple'?planSimple(visits,from,to,seed):planHuman(visits,from,to,seed,options);
  }

  // Medium swing: walking bass in the meter's beat unit and a brush ride pattern with the skip note on the swung (2/3) eighth.
  function planSimple(visits,from,to,seed=1){
    const rnd=random(seed),notes=[],slots=[];
    let current=null;
    for(const visit of visits){
      // Slots sit on the bar's beat grid: a pickup starting off the beat (e.g. on 4-and) gets its first slot on the next whole beat, if any.
      const pad=visit.pad||0,offset=(visit.unit-pad%visit.unit)%visit.unit,first=Math.round((pad+offset)/visit.unit),lead=leadIn(visit,from);
      for(let i=0;offset+i*visit.unit<visit.duration-1e-6;i++){
        const beat=visit.start+offset+i*visit.unit;
        for(const c of visit.chords)if(c.at<=beat+1e-6)current=c.chord;
        if(lead||beat<from-1e-6||beat>=to-1e-6)continue;
        slots.push({beat,unit:visit.unit,index:(first+i)%visit.beats,beats:visit.beats,chord:current});
      }
      for(const c of visit.chords)if(c.at<=visit.start+visit.duration-1e-6)current=c.chord;
    }
    // Consecutive beats under one chord symbol form a span: root first, approach note last.
    const spans=[];
    for(const slot of slots){
      const last=spans.at(-1);
      if(last&&last.chord===slot.chord)last.slots.push(slot);else spans.push({chord:slot.chord,slots:[slot]});
    }
    const rootOf=ch=>ch&&!ch.none?pc(ch.bass??ch.root):null;
    let previous=40;
    spans.forEach((span,s)=>{
      const ch=span.chord;if(!ch||ch.none||!ch.degrees)return;
      const tone=d=>Number.isFinite(ch.degrees[d])?pc(ch.root+ch.degrees[d]):pc(ch.root);
      const n=span.slots.length,waltz=span.slots[0].beats===3;
      span.slots.forEach((slot,k)=>{
        const step=waltz?k%3:k%4,following=span.slots[k+1]??spans[s+1]?.slots[0];
        // Lead into every downbeat (and every chord change) from a half step or the fifth of the note that follows.
        const nextRoot=following&&(following.index===0||!span.slots[k+1])?rootOf(following.chord):null;
        let target;
        if(k===0||slot.index===0)target=near(rootOf(ch),previous);
        else if(nextRoot!==null){
          // Approach the next chord's bass note by a half step, or occasionally from its fifth.
          const goal=near(nextRoot,previous),r=rnd();
          target=r<.2?near(pc(goal+7),previous):Math.min(BASS_RANGE[1],Math.max(BASS_RANGE[0],goal+(r<.6?-1:1)));
        } else if(waltz)target=near(step===1?tone(5):tone(3),previous);
        else target=near(step===1?tone(3):step===2?tone(5):step===3?(rnd()<.5?tone(7):tone(3)):pc(ch.bass??ch.root),previous);
        if(target===null)return;
        previous=target;
        notes.push({beat:slot.beat,kind:'bass',midi:target,length:slot.unit*.92,gain:slot.index===0?1:.88});
      });
    });
    for(const slot of slots){
      const {beat,unit,index,beats}=slot,even=index%2===1,swing=beat+unit*2/3;
      if(beats===3){
        notes.push({beat,kind:'drum',sample:'ride',gain:index===0?.55:.48});
        if(index===1)notes.push({beat:swing,kind:'drum',sample:'ride',gain:.34});
        if(index>0)notes.push({beat,kind:'drum',sample:'foot',gain:.42});
        if(index===0)notes.push({beat,kind:'drum',sample:'kick',gain:.22});
      } else {
        notes.push({beat,kind:'drum',sample:'ride',gain:even?.58:.5});
        if(even)notes.push({beat:swing,kind:'drum',sample:'ride',gain:.34},{beat,kind:'drum',sample:'foot',gain:.5});
        notes.push({beat,kind:'drum',sample:'kick',gain:.13});
        if(rnd()<.14)notes.push({beat:swing,kind:'drum',sample:'tap',gain:.28});
      }
      if(index===0&&rnd()<.12)notes.push({beat,kind:'drum',sample:'swirl',gain:.18});
    }
    return notes.filter(n=>n.beat<to-1e-6).sort((a,b)=>a.beat-b.beat);
  }

  // Ride skip note position: a lazier triplet feel at slow tempi, straighter toward fast ones (0.68 at ≤90 BPM → 0.60 at ≥220 BPM).
  const swingRatio=bpm=>Math.max(.6,Math.min(.68,.68-(bpm-90)*.08/130));
  const inRange=n=>n>=BASS_RANGE[0]&&n<=BASS_RANGE[1];
  // Nearest in-range pitch (never `from` itself) whose pitch class is in pcs; dir 1 / -1 searches only above / below.
  function toward(pcs,from,dir=0){
    if(from==null)return null;
    for(let d=1;d<=12;d++)for(const s of dir?[dir]:from>40?[-1,1]:[1,-1]){const n=from+s*d;if(inRange(n)&&pcs.includes(pc(n)))return n;}
    return null;
  }
  // Chord scale for scale walks: dorian / mixolydian / ionian / locrian-like, read from the chord's own 3rd, 5th and 7th.
  function chordScale(ch){
    const d=ch.degrees,third=d[3]??4,fifth=d[5]??7,sixthChord=/sixth/.test(ch.kind||'');
    const seventh=sixthChord?11:d[7]??(third===3?10:11),second=d[9]===13?1:2,sixth=sixthChord?9:fifth===6?8:9;
    return [0,second,third,5,fifth,sixth,seventh].map(x=>pc(ch.root+x));
  }
  // A line is playable when it stays in range, never repeats a pitch and leaps at most a sixth (an octave only where the pattern allows it).
  function playable(seq,jumpAt=-1){
    for(let i=1;i<seq.length;i++){const a=seq[i-1],b=seq[i];if(a==null||b==null||!inRange(b)||a===b)return false;const leap=Math.abs(a-b);if(leap>9&&!(leap===12&&i===jumpAt))return false;}
    return true;
  }

  function planHuman(visits,from,to,seed,options){
    const bassRnd=random(seed),drumRnd=random((seed*7919+13)>>>0),notes=[],slots=[];
    const bpm=options.bpm||120,ratio=swingRatio(bpm),twoFeel=options.feel==='human-2feel';
    const sectionSet=new Set(options.sections||[]),useSections=sectionSet.size>0;
    let current=null;
    // Same beat grid as the simple feel (pickup slots indexed as the end of a bar), plus the bar each slot belongs to.
    visits.forEach((visit,v)=>{
      const pad=visit.pad||0,offset=(visit.unit-pad%visit.unit)%visit.unit,first=Math.round((pad+offset)/visit.unit),lead=leadIn(visit,from);
      for(let i=0;offset+i*visit.unit<visit.duration-1e-6;i++){
        const beat=visit.start+offset+i*visit.unit;
        for(const c of visit.chords)if(c.at<=beat+1e-6)current=c.chord;
        if(lead||beat<from-1e-6||beat>=to-1e-6)continue;
        slots.push({beat,unit:visit.unit,index:(first+i)%visit.beats,beats:visit.beats,chord:current,bar:v});
      }
      for(const c of visit.chords)if(c.at<=visit.start+visit.duration-1e-6)current=c.chord;
    });
    if(!slots.length)return notes;
    // Bars in playback order from the start of the range (pickup excluded); phrases are 4-bar groups restarted at each section.
    const bars=new Map();
    for(const slot of slots)if(!bars.has(slot.bar))bars.set(slot.bar,{visit:visits[slot.bar],slots:[]});
    for(const slot of slots)bars.get(slot.bar).slots.push(slot);
    const order=[...bars.values()];let ordinal=0,inSection=0,twoFeelOpen=twoFeel;
    for(const bar of order){
      if(bar.visit.pad){bar.ordinal=-1;continue;}
      bar.ordinal=ordinal;bar.sectionStart=ordinal===0||(useSections?sectionSet.has(bar.visit.measure):ordinal%8===0);
      if(bar.sectionStart&&ordinal>0){inSection=0;twoFeelOpen=false;}
      bar.inSection=inSection;bar.phraseBar=inSection%4;bar.twoFeel=twoFeelOpen;ordinal++;inSection++;
    }
    order.forEach((bar,i)=>{
      const next=order[i+1];if(bar.ordinal<0)return;
      const nextStarts=!!next&&next.ordinal>0&&next.sectionStart;
      bar.phraseEnd=bar.phraseBar===3||nextStarts;bar.bigEnd=nextStarts||bar.inSection%8===7;
      if(bar.bigEnd&&next)next.accent=true;
    });
    for(const bar of order)if(bar.ordinal<0)bar.twoFeel=twoFeel;

    // Bass: cells are the beats of one bar under one chord symbol; each cell walks from its root to the next cell's chosen pitch.
    const rnd=bassRnd,cells=[];
    for(const slot of slots){const last=cells.at(-1);if(last&&last.chord===slot.chord&&last.bar===slot.bar&&slot.index!==0)last.slots.push(slot);else cells.push({chord:slot.chord,bar:slot.bar,slots:[slot]});}
    const rootOf=ch=>pc(ch.bass??ch.root),usable=ch=>ch&&!ch.none&&ch.degrees;
    const pick=list=>{let total=list.reduce((s,x)=>s+x.weight,0),r=rnd()*total;for(const x of list){r-=x.weight;if(r<=0)return x;}return list.at(-1);};
    const jitter=(base,spread)=>base*(1+(rnd()*2-1)*spread);
    const bassOffset=()=>-6+(rnd()*2-1)*5;
    let start=null,lastPitch=40,previousId=null,barIds=[],previousBarId=null,currentBar=null;
    const finalCell=cells.at(-1);
    cells.forEach((cell,c)=>{
      const ch=cell.chord,n=cell.slots.length,beats=cell.slots[0].beats,bar=bars.get(cell.bar);
      if(cell.bar!==currentBar){if(currentBar!==null)previousBarId=barIds.join('+');barIds=[];currentBar=cell.bar;}
      if(!usable(ch)){start=null;return;}
      const S=start??near(rootOf(ch),lastPitch);if(S===null)return;
      const lastSlot=cell.slots.at(-1),barEnd=bar.visit.start+bar.visit.duration;
      // Ending: the last cell of the range holds its root to the end of the bar.
      if(cell===finalCell){
        notes.push({beat:cell.slots[0].beat,kind:'bass',midi:S,length:Math.min(barEnd,to)-cell.slots[0].beat,gain:1,offsetMs:bassOffset(),role:'end',pattern:'end'});
        return;
      }
      const nextCell=cells[c+1];
      let T=null;
      if(nextCell&&usable(nextCell.chord)){
        // Choose the arrival pitch first: the next chord's bass (or, on a new bar of the same chord, sometimes its 3rd / 5th).
        let target=rootOf(nextCell.chord);
        if(nextCell.chord===ch&&nextCell!==finalCell&&nextCell.slots[0].index===0&&nextCell.slots.length>=3&&rnd()<.2){const d=rnd()<.5?3:5;if(Number.isFinite(ch.degrees[d]))target=pc(ch.root+ch.degrees[d]);}
        T=near(target,S);
        // A one-beat cell or a held 2-feel note cannot walk away first: take the fifth under the same chord, otherwise change octave (the pitch class stays the chord's bass).
        if((n===1||bar.twoFeel)&&T===S)T=nextCell.chord===ch&&nextCell!==finalCell&&Number.isFinite(ch.degrees[5])?near(pc(ch.root+ch.degrees[5]),S):inRange(S+12)&&S<40?S+12:inRange(S-12)?S-12:S+12;
      }
      const third=[Number.isFinite(ch.degrees[3])?pc(ch.root+ch.degrees[3]):pc(ch.root+4)],fifth=[Number.isFinite(ch.degrees[5])?pc(ch.root+ch.degrees[5]):pc(ch.root+7)];
      const seventh=[Number.isFinite(ch.degrees[7])?pc(ch.root+ch.degrees[7]):pc(ch.root+10)],tones=[pc(ch.root),third[0],fifth[0],seventh[0]],scale=chordScale(ch);
      const dir=T===null?(S<40?1:-1):T>S?1:T<S?-1:(rnd()<.5?1:-1);
      // Approach the arrival note by a half step (usually from the side the line comes from) or from its fifth.
      const approach=prev=>{if(T===null||prev==null)return null;if(rnd()<.3)return toward([pc(T+7)],prev);const side=(prev<T?-1:1)*(rnd()<.25?-1:1);return T+side;};
      const closingTone=prev=>toward(tones,prev,dir);
      // Only a half step or a fifth (either way) into the arrival note counts as an approach note.
      const approaches=x=>T!==null&&x!=null&&[1,5,7].includes(Math.abs(x-T));
      const isLastInBar=!nextCell||nextCell.bar!==cell.bar;
      let line,id,approachLast=false;
      if(bar.twoFeel){
        // 2-feel: half notes (root on 1, fifth or approach on 3); 3/4 holds a dotted-half root.
        const half=beats%2===0?beats/2:null,second=cell.slots.findIndex((s,k)=>k>0&&s.index===half);
        let p=null,role='walk';
        if(second>0){
          const fifthNote=toward(fifth,S),near5=rnd()<.5,options=(near5?[fifthNote,approach(S)]:[approach(S),fifthNote]).filter(x=>x!=null&&playable(T===null?[S,x]:[S,x,T]));
          if(options.length){p=options[0];role=approaches(p)?'approach':'walk';}
        }
        const emits=p===null?[0]:[0,second];
        emits.forEach((k,e)=>{
          const slot=cell.slots[k],endBeat=e+1<emits.length?cell.slots[emits[e+1]].beat:lastSlot.beat+lastSlot.unit,midi=e===0?S:p;
          notes.push({beat:slot.beat,kind:'bass',midi,length:(endBeat-slot.beat)*.92,gain:jitter(e===0?1:.9,.08),offsetMs:bassOffset(),role:e===0?'root':role,pattern:'2feel'});
          lastPitch=midi;
        });
        previousId='2feel';barIds.push('2feel');start=T;return;
      }
      const makers=[];
      const add=(name,weight,make,opts={})=>makers.push({id:name,weight,make,...opts});
      if(n===4){
        add('arp',2,()=>{const a=toward(third,S,1),b=toward(fifth,a,1);return [a,b,toward(seventh,b,1)];});
        add('arp35',1,()=>{const a=toward(third,S,1),b=toward(fifth,a,1);return [a,b,toward(third,b,-1)];});
        add('scale',2,()=>{const a=toward([scale[1]],S,1),b=toward([scale[2]],a,1);return [a,b,toward([scale[4]],b,1)];});
        add('scaleDown',1,()=>{const a=toward([scale[6]],S,-1),b=toward([scale[5]],a,-1);return [a,b,toward([scale[4]],b,-1)];});
        if(T!==null){
          add('chromatic',3,()=>{const a=closingTone(S),b=closingTone(a);return [a,b,b==null?null:T+(b<T?-1:1)];},{approach:true});
          add('dominant',2,()=>{const a=closingTone(S),b=closingTone(a);return [a,b,toward([pc(T+7)],b)];},{approach:true});
          add('enclosure',1.5,()=>{const a=closingTone(S),above=rnd()<.5;return above?[a,T+(rnd()<.5?1:2),T-1]:[a,T-1,T+1];},{approach:true});
          add('octave',.4,()=>{const up=inRange(S+12)?S+12:S-12,b=toward(fifth,up,T<up?-1:1);return [up,b,b==null?null:T+(b<T?-1:1)];},{approach:true,jumpAt:1});
        }
      } else if(n===3){
        add('r5a',2,()=>{const a=toward(fifth,S);return [a,T===null?closingTone(a):approach(a)];},{approach:T!==null});
        add('r3a',2,()=>{const a=toward(third,S);return [a,T===null?closingTone(a):approach(a)];},{approach:T!==null});
        add('rsa',1.5,()=>{const a=dir>0?toward([scale[1]],S,1):toward([scale[6]],S,-1);return [a,T===null?closingTone(a):approach(a)];},{approach:T!==null});
      } else if(n===2){
        if(T!==null){add('ra-below',2,()=>[T-1],{approach:true});add('ra-above',1.5,()=>[T+1],{approach:true});add('ra-fifth',1.5,()=>[toward([pc(T+7)],S)],{approach:true});}
        else add('r5',1,()=>[toward(fifth,S)]);
      } else if(n===1)add('r',1,()=>[],{jumpAt:1});
      else{
        add('arpWalk',1,()=>{const out=[];let p=S;for(let k=1;k<n-1;k++){p=toward(tones,p,dir);out.push(p);}out.push(T===null?toward(tones,p,-dir):approach(p));return out;});
        add('scaleWalk',1,()=>{const out=[];let p=S;for(let k=1;k<n-1;k++){p=toward(scale,p,dir);out.push(p);}out.push(T===null?toward(scale,p,-dir):approach(p));return out;});
      }
      // Fallback for any length: chord-scale steps toward the arrival pitch, finishing on a half step or fifth into it when one fits.
      const walk=()=>{
        const out=[];let p=S;
        for(let k=1;k<n;k++){
          const left=n-k,goal=T===null?p+dir*2:S+(T-S)*k/n,options=[];
          for(let m=p-9;m<=p+9;m++)if(inRange(m)&&m!==p&&scale.includes(pc(m)))options.push(m);
          if(left===1&&T!==null)options.push(T-1,T+1);
          if(left===1&&T!==null)options.push(T-5,T+7);
          const rank=m=>left===1&&approaches(m)?0:1;
          const ok=options.filter(m=>inRange(m)&&m!==p&&Math.abs(m-p)<=9&&(T===null||Math.abs(T-m)<=9*left&&(left>1||m!==T))).sort((a,b)=>rank(a)-rank(b)||Math.abs(a-goal)-Math.abs(b-goal)||a-b);
          if(!ok.length)return null;p=ok[0];out.push(p);
        }
        return out;
      };
      add('walk',makers.length&&n<5?0:1,walk);
      const candidates=makers.map(m=>({...m,line:m.make()})).filter(m=>m.line&&playable(T===null?[S,...m.line]:[S,...m.line,T],m.jumpAt??-1));
      // Never the same pattern twice in a row, and never the same bar figure as the bar before.
      const fresh=candidates.filter(m=>m.weight>0&&m.id!==previousId&&!(isLastInBar&&[...barIds,m.id].join('+')===previousBarId));
      const chosen=fresh.length?pick(fresh):candidates.find(m=>m.id==='walk'&&m.id!==previousId)||(candidates.length?pick(candidates.map(m=>({...m,weight:m.weight||1}))):null);
      line=chosen?chosen.line:Array(n-1).fill(null);id=chosen?.id??'none';
      const full=[S,...line];
      // Ornament: an occasional ghosted triplet pickup into the next bar, a half step from the arrival note.
      let ghost=null;
      if(isLastInBar&&T!==null&&n>=2&&lastSlot.index===beats-1&&nextCell.slots[0].index===0&&rnd()<.08){
        const g=[T+1,T-1].find(p=>inRange(p)&&p!==full.at(-1)&&Math.abs(p-full.at(-1))<=9);
        if(g!==undefined)ghost=g;
      }
      // The last note leads into the next bar's pitch; with a ghost note in between it is an ordinary (shortened) walking note.
      approachLast=n>1&&ghost===null&&approaches(full.at(-1));
      cell.slots.forEach((slot,k)=>{
        const midi=full[k];if(midi==null)return;
        const strong=beats===3?slot.index===0:slot.index%2===0,last=k===n-1,approachNote=last&&approachLast;
        let length=slot.unit*(approachNote?.75:.85+rnd()*.1);
        if(last&&ghost!==null)length=slot.unit*2/3*.85;
        notes.push({beat:slot.beat,kind:'bass',midi,length,gain:jitter(strong?1:.85,.08),offsetMs:bassOffset(),role:k===0?'root':approachNote?'approach':'walk',pattern:id});
        lastPitch=midi;
      });
      if(ghost!==null){notes.push({beat:lastSlot.beat+lastSlot.unit*2/3,kind:'bass',midi:ghost,length:lastSlot.unit/3*.8,gain:jitter(.45,.08),offsetMs:bassOffset(),role:'ghost',pattern:id});lastPitch=ghost;}
      previousId=id;barIds.push(id);start=T;
    });

    // Drums: humanized ride / hi-hat foot / feathered kick, brush comping that grows toward the end of each phrase, fills and accents.
    const d=drumRnd,human=(g,p)=>g*(1+(d()*2-1)*p),off=a=>(d()*2-1)*a;
    const push=(beat,sample,gain,offsetMs,role)=>notes.push(role?{beat,kind:'drum',sample,gain,offsetMs,role}:{beat,kind:'drum',sample,gain,offsetMs});
    for(const bar of order){
      const beats=bar.slots[0].beats,waltz=beats===3,regular=bar.ordinal>=0;
      const skipBeats=waltz?[1]:Array.from({length:beats},(_,i)=>i).filter(i=>i%2===1);
      const drop=regular&&d()<.1?skipBeats[Math.floor(d()*skipBeats.length)]:-1;
      const extra=regular&&d()<.08?(d()<.5?0:2):-1;
      const tapChance=regular?[.04,.08,.13,.2][bar.phraseBar]:.04;
      const fillFrom=regular&&bar.bigEnd?beats-2:regular&&bar.phraseEnd?beats-1:beats;
      bar.slots.forEach(slot=>{
        const {beat,unit,index}=slot,skip=beat+unit*ratio;
        const accent=bar.accent&&index===0;
        if(accent){push(beat,'ride2',human(.62,.06),off(4),'accent');push(beat,'kick',human(.36,.06),off(3),'accent');}
        else push(beat,'ride',human(waltz?(index===0?.55:.48):(index%2===1?.58:.5),.1),off(5));
        if((skipBeats.includes(index)&&index!==drop)||index===extra)push(skip,'ride',human(.34,.1),off(5));
        if(waltz?index>0:index%2===1)push(beat,'foot',human(waltz?.42:.5,.05),off(3));
        if(!accent)push(beat,'kick',human(waltz&&index===0?.2:.11,.15),off(3));
        if(index>=fillFrom){
          // Fill on the triplet grid: a short pickup on the last beat, or rising taps over the last two beats before a new 8-bar phrase / section.
          if(bar.bigEnd){const step=index-fillFrom;[0,1/3,2/3].forEach((t,j)=>{const k=step*3+j;push(beat+unit*t,'tap',.2+.25*k/5,off(6),'fill');});}
          else{const pos=d()<.5?[1/3,2/3]:[0,1/3,2/3];pos.forEach((t,j)=>push(beat+unit*t,'tap',human(.24+.06*j,.08),off(6),'fill'));}
        } else if(d()<tapChance)push(d()<.7?skip:beat,'tap',human(.26,.15),off(8),'comp');
        if(index===0&&bar.sectionStart&&d()<.4)push(beat,'swirl',human(.2,.1),0,'swirl');
      });
    }
    return notes.filter(n=>n.beat<to-1e-6).sort((a,b)=>a.beat-b.beat);
  }

  // Schedules one planned note; returns the source so a pause can stop it.
  function play(ctx,destination,note,when,bpm){
    const buffer=note.kind==='bass'?buffers.bass[note.midi]:buffers.drums[note.sample];if(!buffer)return null;
    const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;
    gain.gain.value=note.gain;source.connect(gain);gain.connect(destination);
    source.start(Math.max(ctx.currentTime,when));
    if(note.kind==='bass'){const end=when+note.length*60/bpm;gain.gain.setValueAtTime(note.gain,end);gain.gain.linearRampToValueAtTime(0,end+.06);source.stop(end+.08);}
    source.onended=()=>gain.disconnect();
    return source;
  }
  return {load,ready,timeline,plan,play,swingRatio};
})();
