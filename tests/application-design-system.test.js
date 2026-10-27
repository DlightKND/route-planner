import {Window} from 'happy-dom';
import {it,expect,afterEach} from 'vitest';
import {installApplicationDesignSystem,controlKind,controlVariant} from '../src/ui/application-design-system.js';
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

it('keeps journal back controls visible as named icon buttons when the parent changes',async()=>{
 const w=new Window();windows.push(w);const d=w.document;d.body.innerHTML='<button class="btn ghost gps-back">← К журналу</button><details class="presence-stop-filters"><summary aria-label="Фильтры остановок"><svg></svg><span class="sr-only">Фильтры остановок</span></summary></details>';
 controllers.push(installApplicationDesignSystem(d));const back=d.querySelector('button');expect(back.dataset.ui).toBe('icon');expect(back.dataset.uiVariant).toBe('secondary');expect(back.getAttribute('aria-label')).toBe('К журналу');expect(d.querySelector('summary').dataset.ui).toBe('icon');back.textContent='← К остановке';await new Promise(r=>setTimeout(r,10));expect(back.getAttribute('aria-label')).toBe('К остановке');expect(back.querySelector('svg')).not.toBeNull();expect(back.textContent).toBe('');
});

it('reserves primary for the page command while repeated decisions remain independently actionable',()=>{
 const w=new Window();windows.push(w);const d=w.document;d.body.innerHTML='<button class="btn amber" id="create">Создать задание</button><article class="notice-decision-card"><a class="btn amber" href="#/order/1" data-decision-open>Проверить</a></article><div class="kcard"><button class="btn amber" data-tstart="1">Начать выезд</button></div><button class="btn red">Удалить</button>';
 expect([...d.querySelectorAll('button,a')].map(controlVariant)).toEqual(['primary','secondary','secondary','destructive']);
});

it('moves emphasis from opening a catalogue editor to saving it and restores it on cancel',async()=>{
 const w=new Window();windows.push(w);const d=w.document;d.body.innerHTML='<button class="btn amber" id="emShowAdd">Добавить модель</button><div id="emForm" style="display:none"><button class="btn amber" id="emSave">Сохранить модель</button><button id="cancel">Отмена</button></div>';
 const open=d.querySelector('#emShowAdd'),form=d.querySelector('#emForm');open.onclick=()=>{form.style.display='';};d.querySelector('#cancel').onclick=()=>{form.style.display='none';};controllers.push(installApplicationDesignSystem(d));
 expect(open.dataset.uiVariant).toBe('primary');open.click();await new Promise(r=>setTimeout(r,10));expect(open.dataset.uiVariant).toBe('secondary');expect(d.querySelector('#emSave').dataset.uiVariant).toBe('primary');d.querySelector('#cancel').click();await new Promise(r=>setTimeout(r,10));expect(open.dataset.uiVariant).toBe('primary');
});

it('preserves planner timeline geometry and flat semantic tabs',()=>{const w=new Window();windows.push(w);const d=w.document;d.body.innerHTML='<button class="pw-plan">Работа</button><button class="pw-plan-hit"></button><button class="pw-fact-hit"></button><button class="pw-cut-line">Разрез</button><button class="pw-crew">Инженер</button><div class="pw-tabs"><button role="tab" aria-selected="true">График</button></div>';controllers.push(installApplicationDesignSystem(d));expect([...d.querySelectorAll('button')].map(el=>el.dataset.ui)).toEqual(['geometry','geometry','geometry','geometry','geometry','tab']);expect(d.querySelector('.pw-plan').dataset.uiVariant).toBeUndefined();expect(d.querySelector('[role=tab]').getAttribute('aria-selected')).toBe('true');});
