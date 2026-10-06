// Keep the grabbed point under the pointer. A release or cancelled gesture
// must not turn a preview into a write; a tap opens the same context as a week.
export function wireSchedulePieceDrag({el,canMove,onOpen,onDrop,timeOfY,maxY}){
  const doc=el.ownerDocument;
  let dragging=false;
  el.onclick=e=>{if(!e.target.closest('button,input')&&!canMove()){e.stopPropagation();onOpen();}};
  el.onpointerdown=e=>{
    if(dragging){e.stopPropagation();return;}
    if(e.target.closest('button,input,.vg-cut')||!canMove())return;
    dragging=true;
    e.stopPropagation();
    const startY=e.clientY,top=parseFloat(el.style.top)||0,id=e.pointerId;
    let moved=false,preview=top,active=true;
    const cleanup=()=>{
      if(!active)return;active=false;dragging=false;
      el.style.top=top+'px';el.classList.remove('dragging');
      el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);
      el.removeEventListener('pointercancel',cancel);el.removeEventListener('lostpointercapture',cancel);
      doc.removeEventListener('keydown',escape,true);
      if(el.hasPointerCapture?.(id))el.releasePointerCapture(id);
    };
    const move=ev=>{
      if(ev.pointerId!==id)return;
      const dy=ev.clientY-startY;
      if(Math.abs(dy)>3)moved=true;
      if(!moved)return;
      preview=Math.max(0,Math.min(maxY(),top+dy));
      el.style.top=preview+'px';el.classList.add('dragging');
    };
    const up=ev=>{if(ev.pointerId!==id)return;ev.stopPropagation();cleanup();if(moved)void onDrop(timeOfY(preview));else onOpen();};
    const cancel=ev=>{if(ev.pointerId===id)cleanup();};
    const escape=ev=>{if(ev.key==='Escape'){ev.stopPropagation();cleanup();}};
    el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);
    el.addEventListener('pointercancel',cancel);el.addEventListener('lostpointercapture',cancel);
    doc.addEventListener('keydown',escape,true);
    try{el.setPointerCapture(id);}catch{}
  };
}
