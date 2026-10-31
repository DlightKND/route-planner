import {catalogFilterActive,filterCatalogRows,catalogFacets} from './core/catalog-filter.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name)=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({down:'<path d="m6 9 6 6 6-6"/>',filter:'<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'})[name]}</svg>`;
const tables=new WeakMap();let serial=0;
export function renderCatalogTable(host,options){
 let table=tables.get(host);if(!table){table=new CatalogTable(host);tables.set(host,table);}
 table.update(options);return table;
}
class CatalogTable{
 constructor(host){this.host=host;this.filters={};this.sort=null;this.id='catalog-grid-'+(++serial);}
 update(options){if(this.options?.scope!==options.scope){this.filters={};this.sort=null;}this.options=options;this.paint();}
 close(){this.popupAbort?.abort();if(!this.popup)return;const trigger=this.trigger;this.popup.remove();this.popup=null;this.trigger=null;trigger?.setAttribute('aria-expanded','false');if(trigger?.isConnected)trigger.focus({preventScroll:true});}
 paint(){
  this.close();const {rows,columns,label,rowClass='',empty='Ничего не найдено.'}=this.options,visible=filterCatalogRows(rows,columns,this.filters,this.sort),count=Object.values(this.filters).filter(catalogFilterActive).length;
  this.host.innerHTML=`<div class="catalog-table-status"><span role="status" aria-live="polite">Показано ${visible.length} из ${rows.length}</span><button type="button" class="btn ghost" data-catalog-reset ${!count&&!this.sort?'hidden':''}>Сбросить фильтры${count?' · '+count:''}</button></div><div class="catalog-table-scroll" tabindex="0" role="region" aria-label="${escape(label)}"><table class="catalog-table"><caption class="sr-only">${escape(label)}</caption><thead><tr>${columns.map(c=>{const active=catalogFilterActive(this.filters[c.key]),sorted=this.sort?.key===c.key;return `<th scope="col" ${sorted?`aria-sort="${this.sort.direction==='asc'?'ascending':'descending'}"`:''} class="${c.type==='number'?'catalog-numeric':''}"><button type="button" data-column="${escape(c.key)}" aria-haspopup="dialog" aria-expanded="false" aria-label="Фильтр столбца: ${escape(c.label)}${active?' · применён':''}"><span>${escape(c.label)}</span><span class="catalog-column-icon ${active?'is-filtered':''}">${sorted?`<span aria-hidden="true">${this.sort.direction==='asc'?'↑':'↓'}</span>`:''}${icon(active?'filter':'down')}</span></button></th>`;}).join('')}<th scope="col"><span class="sr-only">Действия</span></th></tr></thead><tbody>${visible.map(row=>`<tr class="catalog-record ${rowClass}" data-catalog-id="${escape(row.id)}">${columns.map(c=>`<td class="${c.type==='number'?'catalog-numeric':''}" data-label="${escape(c.label)}">${c.render?c.render(row):escape(c.value(row)??'—')}</td>`).join('')}<td class="catalog-record-actions">${this.actions(row)}</td></tr>`).join('')||`<tr><td colspan="${columns.length+1}" class="catalog-empty">${escape(empty)} ${count||this.sort?'<button type="button" class="btn ghost" data-catalog-reset>Сбросить фильтры</button>':''}</td></tr>`}</tbody></table></div>`;
  for(const action of this.options.actions||[])this.host.querySelectorAll('['+action.attribute+']').forEach(button=>button.onclick=()=>action.run(button.getAttribute(action.attribute)));
  this.host.querySelectorAll('[data-column]').forEach(button=>button.onclick=()=>this.open(button.dataset.column,button));
  this.host.querySelectorAll('.catalog-row-actions').forEach(menu=>{menu.addEventListener('toggle',()=>{if(!menu.open)return;for(const other of document.querySelectorAll('.catalog-row-actions[open]'))if(other!==menu)other.open=false;const panel=menu.querySelector('div'),r=menu.querySelector('summary').getBoundingClientRect();panel.style.left=Math.max(12,Math.min(r.right-210,window.innerWidth-222))+'px';panel.style.top=Math.max(12,Math.min(r.bottom+4,window.innerHeight-panel.offsetHeight-12))+'px';});});
  this.host.querySelectorAll('[data-catalog-reset]').forEach(button=>button.onclick=()=>{this.filters={};this.sort=null;this.paint();});
 }
 actions(row){const {actions=[],rowLabel}=this.options;return actions.length?`<details class="catalog-row-actions"><summary aria-label="Действия · ${escape(rowLabel(row))}">${icon('more')}</summary><div>${actions.map(a=>`<button type="button" class="btn ghost ${a.danger?'catalog-danger':''}" ${a.attribute}="${escape(row.id)}">${escape(a.label)}</button>`).join('')}</div></details>`:'';}
 open(key,trigger){
  this.close();const column=this.options.columns.find(c=>c.key===key),filter=this.filters[key]||{},popup=document.createElement('div'),titleId=this.id+'-title',range=['number','date'].includes(column.type);
  this.popup=popup;this.trigger=trigger;popup.className='catalog-column-popup';popup.setAttribute('popover','auto');popup.setAttribute('role','dialog');popup.setAttribute('aria-labelledby',titleId);trigger.setAttribute('aria-expanded','true');
  const sortLabels=column.type==='number'?['По возрастанию','По убыванию']:column.type==='date'?['Сначала ранние','Сначала поздние']:['А → Я','Я → А'];
  popup.innerHTML=`<form><header><h3 id="${titleId}">${escape(column.label)}</h3><button type="button" class="btn icon ghost" data-close aria-label="Закрыть фильтр">${icon('close')}</button></header><div class="catalog-column-body"><div class="catalog-sort">${sortLabels.map((s,i)=>`<button type="button" class="btn ghost" data-sort="${i?'desc':'asc'}">${i?'↓':'↑'} ${s}</button>`).join('')}</div>${range?`<fieldset><legend>${column.type==='date'?'Период':'Диапазон'}</legend><div class="catalog-range"><label>От<input name="min" type="${column.type==='date'?'date':'number'}" ${column.type==='number'?'step="any"':''} value="${escape(filter.min??'')}"></label><label>До<input name="max" type="${column.type==='date'?'date':'number'}" ${column.type==='number'?'step="any"':''} value="${escape(filter.max??'')}"></label></div><label class="catalog-filter-option"><input type="checkbox" name="empty" ${filter.includeEmpty?'checked':''}>Не задано</label></fieldset>`:`<label class="sr-only" for="${this.id}-search">Найти значение</label><input id="${this.id}-search" type="search" placeholder="Найти значение" autocomplete="off"><label class="catalog-filter-option"><input type="checkbox" data-all> <span data-all-label>Выбрать все</span></label><div class="catalog-value-list"></div><p class="catalog-values-empty" hidden>Ничего не найдено</p>`}</div><footer><button type="button" class="btn ghost" data-reset>Сбросить</button><button type="submit" class="btn catalog-filter-apply">Применить</button></footer></form>`;
  document.body.append(popup);popup.querySelector('[data-close]').onclick=()=>this.close();
  popup.querySelector('[data-reset]').onclick=()=>{delete this.filters[key];if(this.sort?.key===key)this.sort=null;this.paint();this.host.querySelector(`[data-column="${key}"]`)?.focus();};
  popup.querySelectorAll('[data-sort]').forEach(button=>button.onclick=()=>{this.sort={key,direction:button.dataset.sort};this.paint();this.host.querySelector(`[data-column="${key}"]`)?.focus();});
  let selected,facets;
  if(!range){
   facets=catalogFacets(this.options.rows,this.options.columns,this.filters,key);selected=new Set(filter.values??facets.map(v=>v.key));
   const search=popup.querySelector('input[type=search]'),all=popup.querySelector('[data-all]');
   const matching=()=>facets.filter(v=>String(v.value??'Не задано').toLocaleLowerCase('ru').includes(search.value.toLocaleLowerCase('ru')));
   const syncAll=()=>{const values=matching(),count=values.filter(v=>selected.has(v.key)).length;all.checked=values.length>0&&count===values.length;all.indeterminate=count>0&&count<values.length;all.disabled=!values.length;popup.querySelector('[data-all-label]').textContent=search.value?'Выбрать найденные':'Выбрать все';};
   const paintValues=()=>{const values=matching();popup.querySelector('.catalog-value-list').innerHTML=values.map(v=>`<label class="catalog-filter-option"><input type="checkbox" value="${escape(v.key)}" ${selected.has(v.key)?'checked':''}><span>${escape(v.value??'Не задано')}</span><small>${v.count}</small></label>`).join('');popup.querySelector('.catalog-values-empty').hidden=!!values.length;popup.querySelectorAll('.catalog-value-list input').forEach(input=>input.onchange=()=>{if(input.checked)selected.add(input.value);else selected.delete(input.value);syncAll();});syncAll();};
   all.onchange=()=>{for(const v of matching())if(all.checked)selected.add(v.key);else selected.delete(v.key);paintValues();};search.oninput=paintValues;paintValues();
  }
  popup.querySelectorAll('.catalog-range input').forEach(input=>input.oninput=()=>popup.querySelector('[name=max]').setCustomValidity(''));
  popup.querySelector('form').onsubmit=event=>{
   event.preventDefault();if(range){const min=popup.querySelector('[name=min]'),max=popup.querySelector('[name=max]'),parse=input=>input.value===''?null:column.type==='number'?Number(input.value):input.value,a=parse(min),b=parse(max);max.setCustomValidity(a!=null&&b!=null&&a>b?'Конец диапазона должен быть не меньше начала.':'');if(!popup.querySelector('form').reportValidity())return;const includeEmpty=popup.querySelector('[name=empty]').checked;this.filters[key]={min:a,max:b,includeEmpty,emptyOnly:a==null&&b==null&&includeEmpty};}
   else this.filters[key]={values:facets.every(v=>selected.has(v.key))?null:[...selected]};
   this.paint();this.host.querySelector(`[data-column="${key}"]`)?.focus();
  };
  const position=()=>{if(!popup.isConnected)return;const r=trigger.getBoundingClientRect(),width=Math.min(336,window.innerWidth-24);popup.style.width=width+'px';popup.style.left=Math.max(12,Math.min(r.left,window.innerWidth-width-12))+'px';const h=popup.getBoundingClientRect().height;popup.style.top=Math.max(12,r.bottom+h+8>window.innerHeight?Math.min(r.top-h-8,window.innerHeight-h-12):r.bottom+8)+'px';};
  popup.addEventListener('toggle',event=>{if(event.newState==='closed'){trigger.setAttribute('aria-expanded','false');popup.remove();if(this.popup===popup){this.popup=null;this.trigger=null;}}});
  popup.showPopover();position();popup.querySelector('input')?.focus({preventScroll:true});
  const abort=new window.AbortController();this.popupAbort=abort;window.addEventListener('resize',()=>this.close(),{signal:abort.signal});document.addEventListener('scroll',event=>{if(!popup.contains(event.target))position();},{capture:true,signal:abort.signal});popup.addEventListener('toggle',event=>{if(event.newState==='closed')abort.abort();});
 }
}
export {escape as escapeCatalog};

if(typeof document!=='undefined'){
 document.addEventListener('pointerdown',event=>document.querySelectorAll('.catalog-row-actions[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;}));
 document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.catalog-row-actions[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();});});
 document.addEventListener('scroll',event=>document.querySelectorAll('.catalog-row-actions[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;}),true);
}
