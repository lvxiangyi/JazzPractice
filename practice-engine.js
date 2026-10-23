'use strict';
// Timing and pitch matching are independent of rendering and input hardware.
class PracticeMatcher {
  constructor(events, {windowMs=200, exactMs=80, same=(note,target,played)=>target===played}={}) {
    this.events=events;
    this.same=same;
    this.windowMs=windowMs;
    this.exactMs=Math.min(exactMs,windowMs);
    this.hits=new Map();
    this.closed=new Set();
  }
  hitsAt(index) {
    if(!this.hits.has(index))this.hits.set(index,new Set());
    return this.hits.get(index);
  }
  target(index,midi,notesFor) {
    const notes=notesFor(this.events[index]),hits=this.hitsAt(index),open=n=>!hits.has(n.key??n.midi);
    // The exact pitch wins; an octave-free rule may then accept the same pitch class.
    for(const same of [(n,t,p)=>t===p,this.same]){
      const found=notes.find(n=>!n.accepts&&same(n,n.midi,midi)&&open(n))||notes.find(n=>n.accepts?.some(a=>same(n,a,midi))&&open(n));
      if(found)return found;
    }
    return undefined;
  }
  matchAt(index,midi,notesFor) {
    if(this.closed.has(index))return null;
    const target=this.target(index,midi,notesFor);if(!target)return null;
    const key=target.key??target.midi;this.hitsAt(index).add(key);return {index,key};
  }
  match(midi, beat, bpm, start, end, notesFor, allowClosed=false) {
    let best=null;
    // Binary search limits matching to the onset window, including either side of a barline.
    const radius=this.windowMs*bpm/60000;
    let low=start,high=end+1;
    while(low<high){const mid=(low+high)>>1;if(this.events[mid].beat<beat-radius)low=mid+1;else high=mid;}
    for(let i=low;i<=end&&this.events[i].beat<=beat+radius;i++) {
      const target=this.target(i,midi,notesFor);
      if((this.closed.has(i)&&!allowClosed)||!target)continue;
      const offset=(beat-this.events[i].beat)*60000/bpm;
      if(!best||Math.abs(offset)<Math.abs(best.offset))best={index:i,offset,key:target.key??target.midi};
    }
    if(best){best.wasClosed=this.closed.has(best.index);this.hitsAt(best.index).add(best.key);best.rating=Math.abs(best.offset)<=this.exactMs?'exact':best.offset<0?'early':'late';}
    return best;
  }
  expire(index,notesFor) {
    if(this.closed.has(index))return [];
    this.closed.add(index);
    return [...new Set(notesFor(this.events[index]).map(n=>n.key??n.midi))].filter(n=>!this.hitsAt(index).has(n));
  }
}
if(typeof module!=='undefined')module.exports={PracticeMatcher};
