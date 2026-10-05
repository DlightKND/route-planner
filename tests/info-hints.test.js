import {Window} from 'happy-dom';
import {afterEach, expect, it, vi} from 'vitest';
import {infoHint, installInfoHints} from '../src/info-hints.js';
const windows=[];
afterEach(async()=>{await Promise.all(windows.splice(0).map(w=>w.happyDOM.close()));});
function setup(){
  const win=new Window({width:360,height:800});windows.push(win);
  installInfoHints(win.document,win);
  win.document.body.innerHTML=infoHint('Текст','О показателе')+infoHint('Другой текст');
  for(const button of win.document.querySelectorAll('.qm')){
    vi.spyOn(button,'getClientRects').mockReturnValue([{}]);
    vi.spyOn(button,'getBoundingClientRect').mockReturnValue({left:340,top:740,bottom:772});
  }
  for(const body of win.document.querySelectorAll('.qbody'))vi.spyOn(body,'getBoundingClientRect').mockReturnValue({width:320,height:220});
  return win;
}
it('escapes hint text and labels without adding markup',()=>{
  const win=new Window();windows.push(win);win.document.body.innerHTML=infoHint('<img src=x onerror=bad()>','" onclick="bad');
  expect(win.document.querySelector('img')).toBeNull();
  expect(win.document.querySelector('.qm').hasAttribute('onclick')).toBe(false);
  expect(win.document.querySelector('.qbody').textContent).toBe('<img src=x onerror=bad()>');
});
it('opens one hint, keeps content clicks open and closes on outside click',()=>{
  const win=setup(),buttons=win.document.querySelectorAll('.qm');buttons[0].click();
  expect(buttons[0].getAttribute('aria-expanded')).toBe('true');
  expect(win.document.getElementById(buttons[0].getAttribute('aria-controls'))).toBe(buttons[0].nextElementSibling);
  const contentClick=new win.MouseEvent('click',{bubbles:true,cancelable:true});
  buttons[0].nextElementSibling.dispatchEvent(contentClick);
  expect(contentClick.defaultPrevented).toBe(true); // no label activation
  expect(buttons[0].getAttribute('aria-expanded')).toBe('true');
  buttons[1].click();expect(buttons[0].getAttribute('aria-expanded')).toBe('false');expect(win.document.querySelectorAll('.q.on')).toHaveLength(1);
  win.document.body.click();expect(buttons[1].getAttribute('aria-expanded')).toBe('false');
});
it('positions right and bottom edge hints inside the viewport and restores Escape focus',()=>{
  const win=setup(),button=win.document.querySelector('.qm'),body=button.nextElementSibling;button.click();
  expect(body.style.left).toBe('32px');expect(body.style.top).toBe('512px');
  const closeDialog=vi.fn();win.document.addEventListener('keydown',closeDialog);
  win.document.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(button.getAttribute('aria-expanded')).toBe('false');expect(win.document.activeElement).toBe(button);
  expect(closeDialog).not.toHaveBeenCalled();
});
it('supports dynamically inserted hints and closes when their card is hidden',()=>{
  const win=setup();win.document.body.insertAdjacentHTML('beforeend',infoHint('Новая карточка'));
  const button=win.document.querySelector('.q:last-child .qm');vi.spyOn(button,'getClientRects').mockReturnValue([{}]);button.click();
  expect(button.getAttribute('aria-expanded')).toBe('true');
  button.getClientRects.mockReturnValue([]);win.dispatchEvent(new win.Event('resize'));
  expect(button.getAttribute('aria-expanded')).toBe('false');
});
