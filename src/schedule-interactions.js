// A drag keeps the grabbed point, previews a destination, and writes only on release.
export function wireSchedulePieceDrag({el,canMove,onOpen,onDrop,timeOfY,maxY,resolveDrop,onPreview,onEnd,scrollHost}){
  const doc=el.ownerDocument,win=doc.defaultView;
  let dragging=false;
  el.onclick=e=>{if(!e.target.closest('button,input')&&!canMove()){e.stopPropagation();onOpen();}};
  el.onpointerdown=e=>{
    if(dragging){e.stopPropagation();return;}
    if(e.button>0||e.target.closest('button,input,.vg-cut')||!canMove())return;
    dragging=true;e.stopPropagation();
    const startY=e.clientY,startX=e.clientX,top=parseFloat(el.style.top)||0,id=e.pointerId,initialScroll=scrollHost?.scrollTop||0;
    let moved=false,preview=top,destination=null,active=true,last=e,frame=null;
    const cleanup=()=>{
      if(!active)return;active=false;dragging=false;
      if(frame!=null)win.cancelAnimationFrame(frame);
      el.style.top=top+'px';el.classList.remove('dragging');onEnd?.();
      el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);
      el.removeEventListener('pointercancel',cancel);el.removeEventListener('lostpointercapture',cancel);
      doc.removeEventListener('keydown',escape,true);
      if(el.hasPointerCapture?.(id))el.releasePointerCapture(id);
    };
    const paint=()=>{
      const raw=top+last.clientY-startY+(scrollHost?.scrollTop||0)-initialScroll;
      preview=resolveDrop?raw:Math.max(0,Math.min(maxY(),raw));
      el.style.top=preview+'px';el.classList.add('dragging');
      destination=resolveDrop?resolveDrop({top:preview,event:last}):timeOfY(preview);
      onPreview?.(destination);
    };
    const scroll=()=>{
      frame=null;if(!active||!moved||!scrollHost)return;
      const r=scrollHost.getBoundingClientRect(),edge=36;
      const delta=last.clientY<r.top+edge?-8:last.clientY>Math.min(r.bottom,win.innerHeight)-edge?8:0;
      if(delta){scrollHost.scrollTop+=delta;paint();}
      frame=win.requestAnimationFrame(scroll);
    };
    const move=ev=>{
      if(ev.pointerId!==id)return;last=ev;
      const threshold=e.pointerType==='touch'?6:3;
      if(Math.abs(ev.clientY-startY)>=threshold||Math.abs(ev.clientX-startX)>=threshold)moved=true;
      if(!moved)return;paint();if(scrollHost&&frame==null)frame=win.requestAnimationFrame(scroll);
    };
    const up=ev=>{if(ev.pointerId!==id)return;ev.stopPropagation();if(moved){last=ev;paint();}cleanup();if(moved){if(destination!=null)void onDrop(destination);}else onOpen();};
    const cancel=ev=>{if(ev.pointerId===id)cleanup();};
    const escape=ev=>{if(ev.key==='Escape'){ev.stopPropagation();cleanup();}};
    el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);
    el.addEventListener('pointercancel',cancel);el.addEventListener('lostpointercapture',cancel);
    doc.addEventListener('keydown',escape,true);try{el.setPointerCapture(id);}catch{}
  };
}

// Join only neighbours in the same logical block, across an explicit cut.
export function scheduleJoinCandidate({pieces,cuts,sourceAt,sourceIso,iso,t}){
  const ps=pieces||[],source=ps.find(p=>p.iso===sourceIso&&Math.abs(p.at-sourceAt)<.01);
  if(!source)return null;
  const hasCut=after=>(cuts||[]).some(c=>Math.abs(c.after-after)<.01);
  const prev=ps.find(p=>Math.abs(p.at+p.h-source.at)<.01);
  if(prev&&hasCut(source.at)&&prev.iso===iso&&t>=prev.from-.01&&t<=prev.to+.3)
    return {after:source.at,side:'previous',neighbour:prev};
  const next=ps.find(p=>Math.abs(p.at-(source.at+source.h))<.01);
  if(next&&hasCut(next.at)&&next.iso===iso&&t+source.h>=next.from-.3&&t<next.to)
    return {after:next.at,side:'next',neighbour:next,duration:source.h};
  return null;
}

// Use displacement from the grabbed point: moving the line must never move
// the coordinate system used by the pointer, as a native range input would.
export function wireScheduleCutDrag({el,min,max,getValue,onChange}){
  const snap=value=>Math.max(min,Math.min(max,Math.round(value*4)/4));
  let active=false;
  el.onkeydown=e=>{
    const delta={ArrowDown:.25,ArrowRight:.25,ArrowUp:-.25,ArrowLeft:-.25}[e.key];
    if(delta==null&&!['Home','End'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();onChange(snap(e.key==='Home'?min:e.key==='End'?max:getValue()+delta));
  };
  el.onpointerdown=e=>{
    e.preventDefault();e.stopPropagation();if(active)return;active=true;
    const initial=getValue(),startY=e.clientY,id=e.pointerId,doc=el.ownerDocument;
    const cleanup=()=>{active=false;el.onpointermove=null;el.onpointerup=null;el.onpointercancel=null;el.onlostpointercapture=null;doc.removeEventListener('keydown',escape,true);if(el.hasPointerCapture?.(id))el.releasePointerCapture(id);};
    const cancel=()=>{cleanup();onChange(initial);};
    const escape=ev=>{if(ev.key==='Escape')cancel();};
    el.onpointermove=ev=>{if(ev.pointerId===id)onChange(snap(initial+(ev.clientY-startY)/20));};
    el.onpointerup=ev=>{if(ev.pointerId===id){ev.stopPropagation();cleanup();}};
    el.onpointercancel=ev=>{if(ev.pointerId===id)cancel();};el.onlostpointercapture=cancel;
    doc.addEventListener('keydown',escape,true);try{el.setPointerCapture(id);}catch{}
  };
}
