'use strict';
// Sight-reading view: rewrites a score-partwise document in memory so repeats and 1st / 2nd endings are written out in playback order (the source file is never changed).
window.Unroll=(()=>{
  const numbers=ending=>((ending.getAttribute('number')||'1').match(/\d+/g)||['1']).map(Number);
  const own=(measure,selector)=>[...measure.querySelectorAll(`:scope > barline > ${selector}`)];
  // Playback order of measure indices from forward / backward repeats and numbered endings (no D.C. / D.S. jumps).
  function order(measures){
    const n=measures.length,ranges=[];
    measures.forEach((m,s)=>{for(const start of own(m,'ending[type="start"]')){
      let e=n-1;
      // The ending runs to the first stop / discontinue at or after its start.
      for(let k=s;k<n;k++)if(own(measures[k],'ending').some(x=>['stop','discontinue'].includes(x.getAttribute('type')))){e=k;break;}
      ranges.push({s,e,list:numbers(start)});
    }});
    const rangeAt=i=>ranges.find(r=>r.s===i),inside=i=>ranges.some(r=>i>=r.s&&i<=r.e);
    const result=[],jumps=new Map();let i=0,start=0,pass=1,lastBackward=-1,guard=0;
    while(i<n&&guard++<n*20){
      // Past the repeat and its endings: the next repeat (if it has no forward sign) starts here.
      if(lastBackward>=0&&i>lastBackward&&!inside(i)){pass=1;start=i;lastBackward=-1;jumps.clear();}
      const forward=own(measures[i],'repeat[direction="forward"]').length>0;
      if(forward&&i!==start){start=i;pass=1;jumps.clear();}
      const range=rangeAt(i);
      if(range&&!range.list.includes(pass)){i=range.e+1;continue;}
      result.push(i);
      const backward=own(measures[i],'repeat[direction="backward"]')[0];
      if(backward){
        lastBackward=Math.max(lastBackward,i);
        // Without a times attribute, numbered endings tell how many passes there are (1, 2 / 3 → three).
        let block=i+1;while(rangeAt(block))block=rangeAt(block).e+1;
        const times=Number(backward.getAttribute('times'))||Math.max(2,...ranges.filter(r=>r.s>=start&&r.s<block).flatMap(r=>r.list));
        const done=jumps.get(i)||1;
        if(done<times){jumps.set(i,done+1);pass=done+1;i=start;continue;}
      }
      i++;
    }
    return result;
  }
  const hasJumps=doc=>!!doc.querySelector('sound[dacapo], sound[dalsegno], sound[tocoda], sound[fine]');
  const hasRepeats=doc=>!!doc.querySelector('barline > repeat, barline > ending');
  const flat=node=>node?new XMLSerializer().serializeToString(node).replace(/>\s+</g,'><').trim():'';
  // Returns {doc, unrolled, jumps, labels, order}: labels give each written-out bar its source number and pass; order[i] is its source measure index.
  function expandDoc(doc){
    const parts=[...doc.querySelectorAll('score-partwise > part')];
    const measuresOf=p=>[...p.children].filter(n=>n.tagName==='measure');
    const jumps=hasJumps(doc);
    if(!parts.length||!hasRepeats(doc))return {doc,unrolled:false,jumps,labels:null,order:null};
    // Repeats are shared by all parts, so the first part decides the order.
    const sequence=order(measuresOf(parts[0])),labels=[];
    const visits=new Map();for(const i of sequence){visits.set(i,(visits.get(i)||0)+1);labels.push({number:measuresOf(parts[0])[i]?.getAttribute('number')||String(i+1),pass:visits.get(i)});}
    for(const part of parts){
      const source=measuresOf(part),seen=new Set(),active={key:new Map(),time:'',clef:new Map()};
      const clones=sequence.map((i,position)=>{
        const original=source[i];if(!original)return null;
        const clone=original.cloneNode(true),repeat=seen.has(i);seen.add(i);
        for(const barline of clone.querySelectorAll(':scope > barline')){
          const hadRepeat=!!barline.querySelector('repeat');
          barline.querySelectorAll(':scope > repeat, :scope > ending').forEach(x=>x.remove());
          const style=barline.querySelector(':scope > bar-style');
          // A repeat sign's heavy bar becomes a normal one; a final bar stays only at the very end.
          if(style&&(hadRepeat||style.textContent.trim()==='light-heavy'&&position<sequence.length-1))style.remove();
          if(!barline.children.length)barline.remove();
        }
        // A revisited bar's page / system breaks would split lines oddly; first visits keep the source layout.
        if(repeat)clone.querySelectorAll(':scope > print').forEach(x=>x.remove());
        for(const attributes of clone.querySelectorAll(':scope > attributes')){
          for(const key of attributes.querySelectorAll(':scope > key')){const id=key.getAttribute('number')||'*',text=flat(key);if(repeat&&active.key.get(id)===text)key.remove();else active.key.set(id,text);}
          for(const time of attributes.querySelectorAll(':scope > time')){const text=flat(time);if(repeat&&active.time===text)time.remove();else active.time=text;}
          for(const clef of attributes.querySelectorAll(':scope > clef')){const id=clef.getAttribute('number')||'1',text=flat(clef);if(repeat&&active.clef.get(id)===text)clef.remove();else active.clef.set(id,text);}
          if(!attributes.children.length)attributes.remove();
        }
        return clone;
      }).filter(Boolean);
      source.forEach(m=>m.remove());
      // Measures are the part's only children in partwise MusicXML.
      clones.forEach(m=>part.append(m));
    }
    return {doc,unrolled:true,jumps,labels,order:sequence};
  }
  function expand(xml){
    const doc=new DOMParser().parseFromString(xml,'text/xml');
    if(doc.querySelector('parsererror')||doc.documentElement.tagName!=='score-partwise')return xml;
    return new XMLSerializer().serializeToString(expandDoc(doc).doc);
  }
  return {expand,expandDoc,order,hasJumps,hasRepeats};
})();
