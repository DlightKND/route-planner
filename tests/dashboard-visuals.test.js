import {it,expect} from 'vitest';
import {Window} from 'happy-dom';
import {comparisonChartHTML} from '../src/dashboard-visuals.js';
function render(rows,opts){const w=new Window();w.document.body.innerHTML=comparisonChartHTML(rows,opts);return w.document;}
it('distinguishes missing values from measured zero and uses separate scales for mixed units',()=>{
  const d=render([{label:'Работы',unit:'ч',plan:10,fact:null},{label:'Пробег',unit:'км',plan:100,fact:0},{label:'Загрузка',unit:'%',plan:20,fact:40}]);
  const groups=[...d.querySelectorAll('.comparison-group')];
  expect(groups[0].querySelector('.comparison-line:last-of-type .fact')).toBeNull();
  expect(groups[0].textContent).toContain('—');expect(groups[1].querySelector('.fact').style.width).toBe('0%');
  expect(groups[2].querySelector('.fact').style.width).toBe('40%');
  expect(groups[0].querySelector('.plan').style.width).toBe('100%');
});
it('compares money on the same axis, including negative components',()=>{
  const d=render([{label:'A',unit:'грн',plan:100,fact:50},{label:'B',unit:'грн',plan:0,fact:-100}],{commonScale:true});
  const bars=[...d.querySelectorAll('.comparison-track i')];
  expect(bars.map(b=>b.style.width)).toEqual(['50%','25%','0%','50%']);
  expect(bars.map(b=>b.style.left)).toEqual(['50%','50%','50%','0%']);
  expect([...d.querySelectorAll('.comparison-zero')].every(b=>b.style.left==='50%')).toBe(true);
});
it('escapes labels and keeps all bar geometry finite when values are invalid or empty',()=>{
  const d=render([{label:'<img src=x onerror=alert(1)>',unit:'<script>',plan:NaN,fact:Infinity},{label:'Ноль',unit:'%',plan:0,fact:0}]);
  expect(d.querySelector('img,script')).toBeNull();
  expect(d.body.innerHTML).not.toMatch(/(?:width|left):(?:NaN|Infinity)/);
  expect(d.querySelectorAll('.comparison-track i')).toHaveLength(2);
});
