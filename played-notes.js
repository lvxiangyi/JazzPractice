'use strict';
// Draw actual MIDI pitches over the source score without changing its notation.
window.PlayedNotes={
  cache(osmd,host,points,events,force=false){
    const origin=host.getBoundingClientRect();
    const staves=[...host.querySelectorAll('g.vf-measure')].map(group=>{
      const lines=[...group.querySelectorAll(':scope > path')].map(n=>n.getBoundingClientRect()).filter(r=>r.width>20&&r.height<3).sort((a,b)=>a.top-b.top);
      return {lines:lines.slice(0,5),left:lines[0]?.left-origin.left,right:lines[0]?.right-origin.left};
    }).filter(s=>s.lines.length===5);
    const rows=new Map();
    for(const s of staves){const key=Math.round(s.lines[0].top-origin.top),row=rows.get(key)||{left:Infinity,right:-Infinity,bars:[]};row.left=Math.min(row.left,s.left);row.right=Math.max(row.right,s.right);row.bars.push(s.right);rows.set(key,row);}
    const texts=[...host.querySelectorAll('svg:not(#actual-note-overlay) text')].map(n=>n.getBoundingClientRect()).filter(r=>r.height).map(r=>({top:r.top-origin.top,bottom:r.bottom-origin.top}));
    for(const event of events){
      const point=points[event.cursorIndex];if(!point||(point.staves?.length&&!force))continue;
      const clefs=(osmd.GraphicSheet.MeasureList[event.measure-1]||[]).map(m=>m.InitiallyActiveClef);
      // Staves overlapping the cursor in this column; if the cursor and staff rects disagree (zoom / DPI rounding), use the nearest staff in the column.
      const column=staves.filter(s=>s.left<=point.x+3&&s.right>=point.x-3),top=s=>s.lines[0].top-origin.top,bottom=s=>s.lines[4].top-origin.top;
      let found=column.filter(s=>bottom(s)>=point.y-4&&top(s)<=point.y+point.height+4);
      if(!found.length&&column.length){const centre=point.y+point.height/2,gap=s=>Math.abs((top(s)+bottom(s))/2-centre);found=[column.reduce((a,b)=>gap(b)<gap(a)?b:a)];}
      point.staves=found.sort((a,b)=>a.lines[0].top-b.lines[0].top).map((s,i)=>{
        const clef=clefs[i],type=clef?.ClefType??(i?1:0),line=clef?.Line??(i?4:2),octave=clef?.OctaveOffset||0;
        // Clef reference pitches: G4, F3 and C4; top line is staff line 5.
        return {top:s.lines[0].top-origin.top,step:(s.lines[4].top-s.lines[0].top)/8,topPitch:([32,24,28][type]??32)+(5-line)*2+octave*7};
      });
      // A melody-only score gets a bass staff for the left hand, placed under the line's lyrics (top line A3).
      if(point.staves.length===1) {
        const staff=point.staves[0],bottom=staff.top+8*staff.step,row=rows.get(Math.round(staff.top));
        const lyrics=texts.filter(t=>t.top>bottom-staff.step&&t.top<bottom+12*staff.step).reduce((max,t)=>Math.max(max,t.bottom),bottom+2*staff.step);
        point.bass=row&&{top:lyrics+3*staff.step,step:staff.step,topPitch:26,left:row.left,right:row.right,bars:row.bars,key:Math.round(staff.top),synthetic:true};
      } else delete point.bass;
    }
  },
  drawBassStaff(add,svg,bass,fifths){
    const g=add('g',{class:'bass-staff',stroke:'#7d8a80',fill:'#5c6b60'},svg);
    const title=add('title',{},g);title.textContent='左手 · 低音谱表（为回看添加，原谱只有旋律）';
    for(let k=0;k<5;k++)add('line',{x1:bass.left,x2:bass.right,y1:bass.top+k*2*bass.step,y2:bass.top+k*2*bass.step,'stroke-width':1},g);
    for(const x of [bass.left,...bass.bars])add('line',{x1:x,x2:x,y1:bass.top,y2:bass.top+8*bass.step,'stroke-width':1},g);
    const clef=add('text',{x:bass.left+bass.step*.8,y:bass.top+bass.step*6.2,'font-size':bass.step*7.6,stroke:'none','font-family':'"Segoe UI Symbol","Noto Music","Apple Symbols",serif'},g);clef.textContent='𝄢';
    // Key signature on the bass staff: flats B2 E3 A2 D3 G2 C3 F2, sharps F3 C3 G3 D3 A2 E3 B2 (diatonic step numbers).
    const places=fifths<0?[20,23,19,22,18,21,17]:[24,21,25,22,19,23,20];
    places.slice(0,Math.abs(fifths)).forEach((p,i)=>{const t=add('text',{x:bass.left+bass.step*(7.2+i*1.9),y:bass.top+(26-p)*bass.step+bass.step*1.1,'font-size':bass.step*3.6,stroke:'none'},g);t.textContent=fifths<0?'♭':'♯';});
  },
  // Spell a MIDI pitch as letter + alteration: a score note of the same pitch wins, otherwise the key signature picks sharps or flats.
  spell(midi,fifths=0,hint){
    const semis=[0,2,4,5,7,9,11],pc=midi%12;
    let letter=hint??semis.indexOf(pc);
    if(letter<0)letter=fifths<0?semis.indexOf(pc+1):semis.indexOf(pc-1);
    let alter=pc-semis[letter];if(alter>6)alter-=12;if(alter<-6)alter+=12;
    const octave=(midi-alter-semis[letter])/12-1;
    return {letter,alter,octave,name:'CDEFGAB'[letter]+(['𝄫','♭','','♯','𝄪'][alter+2]??'')+octave};
  },
  // Accidental sign needed against the key signature, or '' when the key already implies it.
  accidental(letter,alter,fifths=0){
    const order=fifths>=0?[3,0,4,1,5,2,6]:[6,2,5,1,4,0,3],keyAlter=order.slice(0,Math.abs(fifths)).includes(letter)?Math.sign(fifths):0;
    return alter===keyAlter?'':(['𝄫','♭','♮','♯','𝄪'][alter+2]);
  },
  // groups: [{point,x,notes:[{midi,color,opacity,status,hint}]}]; notes far outside the staff are labelled instead of drawing many ledger lines.
  render(host,groups,fifths=0){
    host.querySelector('#actual-note-overlay')?.remove();
    groups=groups.filter(g=>g.point?.staves?.length&&g.notes.length);if(!groups.length)return 0;
    const ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg');svg.id='actual-note-overlay';svg.setAttribute('aria-label','实际演奏音符');svg.setAttribute('role','img');
    svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:6';
    const add=(tag,attrs,parent=svg)=>{const n=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))n.setAttribute(key,value);parent.append(n);return n;};
    const bassDrawn=new Set();
    for(const {point,x,notes,shift} of groups){
      const sorted=[...notes].sort((a,b)=>a.midi-b.midi);let below=0,above=0;
      sorted.forEach((note,i)=>{
        // Left-hand notes go to the lower staff: the score's own bass staff, or the added one under a melody-only line.
        const {midi}=note,lower=point.staves.length>1?point.staves.at(-1):point.bass,left=note.hand?note.hand==='left':midi<60;
        const staff=left&&lower?lower:point.staves[0],spelled=this.spell(midi,fifths,note.hint);
        if(staff.synthetic&&!bassDrawn.has(staff.key)){bassDrawn.add(staff.key);this.drawBassStaff(add,svg,staff,fifths);}
        const pitch=spelled.octave*7+spelled.letter,distance=staff.topPitch-pitch;
        const y=staff.top+distance*staff.step,r=Math.max(3,staff.step*1.3);
        const close=i>0&&Math.abs(midi-sorted[i-1].midi)<=2;
        // Live input sits clear of the engraved notehead; the review places it by timing, so an on-time note covers the written one.
        const nx=x+(shift??staff.step*5.5)+(close?r*2.2:0),color=note.color||'#2965b5',group=add('g',{'data-midi':midi,'data-name':spelled.name,'data-status':note.status||'free',fill:color,stroke:color,opacity:note.opacity??1});
        const title=add('title',{},group);title.textContent=`你弹的是 ${spelled.name} · MIDI ${midi}`;
        // Unlabelled review notes always use real ledger lines so the pitch is read from the staff.
        if(note.label!==false&&(distance>20||distance<-12)) {
          const low=distance>0,ty=low?staff.top+(10+2.6*++below)*staff.step:staff.top-(1.6*++above)*staff.step;
          add('circle',{cx:nx,cy:ty-staff.step*.8,r:staff.step*.7},group);
          const t=add('text',{class:'name',x:nx+staff.step*1.2,y:ty,'font-size':staff.step*2.2,stroke:'none'},group);t.textContent=spelled.name;
          return;
        }
        for(let d=distance<0?-2:10;distance<0?d>=distance:d<=distance;d+=distance<0?-2:2)add('line',{x1:nx-r*1.6,x2:nx+r*1.6,y1:staff.top+d*staff.step,y2:staff.top+d*staff.step,'stroke-width':1.2},group);
        const sign=this.accidental(spelled.letter,spelled.alter,fifths);
        if(sign){const a=add('text',{class:'acc',x:nx-r*1.5,y:y+staff.step*.8,'font-size':staff.step*3,stroke:'none','text-anchor':'end'},group);a.textContent=sign;}
        // Hollow noteheads mark generated targets that were not played.
        if(note.hollow){add('ellipse',{cx:nx,cy:y,rx:r,ry:staff.step*.88,transform:`rotate(-20 ${nx} ${y})`,fill:'none','stroke-width':Math.max(1.2,staff.step*.4)},group);return;}
        add('ellipse',{cx:nx,cy:y,rx:r,ry:staff.step*.88,transform:`rotate(-20 ${nx} ${y})`},group);
        add('line',{x1:nx+r*.85,x2:nx+r*.85,y1:y,y2:y-staff.step*6,'stroke-width':1.4},group);
        if(note.label===false)return;
        const label=add('text',{class:'name',x:nx+r*1.4,y:y+staff.step*.7,'font-size':staff.step*1.9,stroke:'#fffefa','stroke-width':staff.step*.6,'paint-order':'stroke','font-weight':600},group);label.textContent=spelled.name;
      });
    }
    host.append(svg);
    return svg.querySelectorAll('g[data-midi]').length;
  }
};
