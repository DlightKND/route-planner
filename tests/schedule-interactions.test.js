import {Window} from 'happy-dom';
import {it,expect,vi} from 'vitest';
import {wireSchedulePieceDrag} from '../src/schedule-interactions.js';
function fixture(canMove=true){
  const win=new Window(),el=win.document.createElement('div');win.document.body.append(el);el.style.top='160px';
  const onOpen=vi.fn(),onDrop=vi.fn();
  wireSchedulePieceDrag({el,canMove:()=>canMove,onOpen,onDrop,timeOfY:y=>y/20,maxY:()=>440});
  const pointer=(type,y,id=1)=>el.dispatchEvent(new win.PointerEvent(type,{bubbles:true,pointerId:id,clientY:y}));
  return {win,el,onOpen,onDrop,pointer};
}
it('preserves the grab offset when moving a day piece and ignores a second pointer',async()=>{
  const f=fixture();try{
    f.pointer('pointerdown',190);f.pointer('pointerdown',280,2);f.pointer('pointermove',300,2);f.pointer('pointerup',300,2);
    expect(f.el.style.top).toBe('160px');expect(f.onDrop).not.toHaveBeenCalled();expect(f.onOpen).not.toHaveBeenCalled();
    f.pointer('pointermove',210);f.pointer('pointerup',210);
    expect(f.onDrop).toHaveBeenCalledWith(9); // 08:00 + one hour, not cursor time 10:30.
    expect(f.el.style.top).toBe('160px');expect(f.onOpen).not.toHaveBeenCalled();
  }finally{await f.win.happyDOM.close();}
});
it.each(['pointercancel','lostpointercapture','Escape'])('cancels a %s gesture without saving or opening',async mode=>{
  const f=fixture();try{
    f.pointer('pointerdown',190);f.pointer('pointermove',230);
    if(mode==='Escape')f.win.document.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));else f.pointer(mode,230);
    f.pointer('pointerup',230);expect(f.el.style.top).toBe('160px');expect(f.onDrop).not.toHaveBeenCalled();expect(f.onOpen).not.toHaveBeenCalled();
  }finally{await f.win.happyDOM.close();}
});
it('opens on a tap and keeps readonly pieces free of drag writes',async()=>{
  const tap=fixture(),readonly=fixture(false);try{
    tap.pointer('pointerdown',190);tap.pointer('pointerup',190);expect(tap.onOpen).toHaveBeenCalledOnce();expect(tap.onDrop).not.toHaveBeenCalled();
    readonly.pointer('pointerdown',190);readonly.pointer('pointermove',230);readonly.pointer('pointerup',230);readonly.el.click();
    expect(readonly.onOpen).toHaveBeenCalledOnce();expect(readonly.onDrop).not.toHaveBeenCalled();
  }finally{await tap.win.happyDOM.close();await readonly.win.happyDOM.close();}
});
