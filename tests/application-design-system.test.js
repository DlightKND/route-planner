import {Window} from 'happy-dom';
import {it,expect,afterEach} from 'vitest';
import {installApplicationDesignSystem,controlKind} from '../src/ui/application-design-system.js';
const windows=[],controllers=[];
afterEach(async()=>{for(const c of controllers.splice(0))c.destroy();for(const w of windows.splice(0))await w.happyDOM.close();});
it('covers native controls, semantic tabs, filters and duration-bound data without opt-in classes',()=>{
 const w=new Window();windows.push(w);const d=w.document;d.body.innerHTML='<button>Сохранить</button><input type="date"><div class="seg"><button>Список</button></div><button class="chip">Все</button><button role="tab">История</button><div role="button" class="vg-piece"></div><button class="vg-plan-tools">⋯</button>';
 expect([...d.querySelectorAll('button,input,[role=button]')].map(controlKind)).toEqual(['button','field','segment','chip','tab','geometry','icon']);
});
it('hydrates existing and subsequently inserted controls and preserves screen-owned handlers',async()=>{
 const w=new Window();windows.push(w);const d=w.document;d.body.innerHTML='<button class="btn amber">Сохранить</button><button class="btn ghost" id="cancel">Отмена</button>';let clicks=0;d.querySelector('button').onclick=()=>clicks++;controllers.push(installApplicationDesignSystem(d));d.querySelector('button').click();expect(clicks).toBe(1);expect(d.querySelector('button').dataset.uiVariant).toBe('primary');expect(d.querySelector('#cancel').dataset.uiVariant).toBe('secondary');
 const dialog=d.createElement('dialog');dialog.innerHTML='<input type="month"><button aria-label="Закрыть">×</button>';d.body.append(dialog);await new Promise(r=>setTimeout(r,10));expect(dialog.querySelector('input').dataset.ui).toBe('field');expect(dialog.querySelector('button').dataset.ui).toBe('icon');
});
it('keeps semantic numeric pills independent of filter selection and neutralizes a known zero',async()=>{
 const w=new Window();windows.push(w);const d=w.document;d.body.innerHTML='<button class="chip" data-os="review">На проверке<b class="chip-n">3</b></button>';controllers.push(installApplicationDesignSystem(d));const count=d.querySelector('b');expect(count.dataset.uiTone).toBe('danger');d.querySelector('button').classList.add('on');await new Promise(r=>setTimeout(r,10));expect(count.dataset.uiTone).toBe('danger');expect(d.querySelector('button').getAttribute('aria-pressed')).toBe('true');count.textContent='0';await new Promise(r=>setTimeout(r,10));expect(count.dataset.uiEmpty).toBe('true');
});
it('segment keyboard navigation calls the real screen action and retains native form values',()=>{
 const w=new Window();windows.push(w);const d=w.document;d.body.innerHTML='<div class="seg"><button>Список</button><button>Доска</button></div><input value="Черновик">';let calls=0;const target=d.querySelectorAll('button')[1];target.onclick=()=>calls++;controllers.push(installApplicationDesignSystem(d));d.querySelector('button').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));expect(calls).toBe(1);expect(d.activeElement).toBe(target);expect(d.querySelector('input').value).toBe('Черновик');
});
