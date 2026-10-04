import {describe,it,expect} from 'vitest';
import {loadChartHTML} from '../src/dashboard-chart.js';
import {Window} from 'happy-dom';
const cells=[{key:'2026-10-05',label:'5',v:8,f:0,cap:8,known:false},{key:'2026-10-06',label:'6',v:12,f:0,cap:8,known:true},{key:'2026-10-07',label:'7',v:2,f:1.5,cap:0,known:true}];
function documentOf(data=cells){const w=new Window();w.document.body.innerHTML=loadChartHTML(data);return w.document;}
describe('accessible load chart',()=>{
 it('distinguishes unknown presence from a confirmed zero',()=>{const d=documentOf(),rows=d.querySelectorAll('tbody tr');expect(rows[0].children[3].textContent).toBe('—');expect(rows[1].children[3].textContent).toBe('0');expect(d.querySelectorAll('.rb-fact')).toHaveLength(1);});
 it('marks overload including work outside available capacity',()=>{const d=documentOf(),rows=d.querySelectorAll('tbody tr');expect(rows[0].children[4].textContent).toBe('В пределах фонда');expect(rows[1].children[4].textContent).toBe('Перегрузка');expect(rows[2].children[4].textContent).toBe('Перегрузка');});
 it('provides exact keyboard/touch readable data with distinct units',()=>{const d=documentOf();expect(d.querySelector('details summary').textContent).toBe('Данные по дням');expect(d.querySelector('thead').textContent).toContain('Присутствие, чел.-ч');expect(d.body.textContent).toContain('не означает выполнение работ');expect(d.body.textContent).not.toContain('факт работ');});
 it('escapes period labels and renders weekly data without invented completeness',()=>{const w=new Window();w.document.body.innerHTML=loadChartHTML([{...cells[0],key:'<script>bad</script>'}],{weekly:true});expect(w.document.querySelector('script')).toBeNull();expect(w.document.querySelector('summary').textContent).toBe('Данные по неделям');expect(w.document.body.textContent).toContain('покрытие периода может быть неполным');});
});
