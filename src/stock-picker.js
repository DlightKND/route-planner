// Подбор позиции из каталога материалов прямо в поле «наименование».
// Поле остаётся обычным текстовым: можно выбрать позицию, а можно написать
// своё — тогда строка уходит как ручная, без связи с каталогом.
//
// Список — listbox под полем (ARIA combobox 1.2): стрелки двигают выбор,
// Enter берёт, Escape закрывает, щелчок по строке тоже берёт.

const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').trim();
let seq=0;

export function stockMatches(items,query,limit=8){
  const q=norm(query),words=q.split(/\s+/).filter(Boolean);
  const scored=[];
  for(const item of items){
    if(item.active===false)continue;
    const name=norm(item.name),sku=norm(item.sku);
    if(words.length&&!words.every(w=>name.includes(w)||sku.includes(w)))continue;
    // Совпадение с началом названия или точный артикул — выше.
    const rank=!q?2:sku===q?0:name.startsWith(q)||sku.startsWith(q)?1:2;
    scored.push({item,rank});
  }
  scored.sort((a,b)=>a.rank-b.rank||String(a.item.name).localeCompare(String(b.item.name),'ru'));
  return scored.slice(0,limit).map(x=>x.item);
}

export function attachStockPicker(input,{items,onPick,money=false,currency='',esc=s=>String(s)}){
  if(!input||input.dataset.stockPicker)return;
  input.dataset.stockPicker='1';
  const id='stockPick'+(++seq),list=document.createElement('ul');
  list.id=id;list.className='stock-pick';list.setAttribute('role','listbox');list.setAttribute('aria-label','Позиции справочника');list.hidden=true;
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',id);
  input.setAttribute('autocomplete','off');
  const host=input.parentElement;host.classList.add('stock-pick-host');host.appendChild(list);
  let shown=[],active=-1;
  const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
  const mark=i=>{active=i;list.querySelectorAll('[role=option]').forEach((li,n)=>li.setAttribute('aria-selected',String(n===i)));
    if(i>=0){input.setAttribute('aria-activedescendant',id+'-'+i);list.children[i]?.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');};
  const open=()=>{
    const all=items()||[];
    shown=stockMatches(all,input.value);
    if(!all.length){list.innerHTML='<li class="stock-pick-empty">Справочник материалов пуст или недоступен</li>';}
    else if(!shown.length){list.innerHTML='<li class="stock-pick-empty">В справочнике не нашлось — строка останется ручной</li>';}
    else list.innerHTML=shown.map((it,i)=>'<li role="option" id="'+id+'-'+i+'" aria-selected="false" data-pick="'+i+'">'
      +'<span class="stock-pick-name">'+esc(it.name)+'</span>'
      +'<span class="stock-pick-meta">'+[it.sku?esc(it.sku):'',esc(it.unit||'шт'),money&&it.price!=null?esc(Number(it.price).toLocaleString('ru-RU'))+(currency?' '+esc(currency):''):''].filter(Boolean).join(' · ')+'</span></li>').join('');
    list.hidden=false;input.setAttribute('aria-expanded','true');mark(-1);
  };
  const pick=i=>{const it=shown[i];if(!it)return;close();onPick(it);};
  input.addEventListener('focus',open);
  input.addEventListener('input',open);
  input.addEventListener('blur',()=>setTimeout(close,120));
  input.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){e.preventDefault();if(list.hidden)open();mark(Math.min(shown.length-1,active+1));}
    else if(e.key==='ArrowUp'){e.preventDefault();mark(Math.max(-1,active-1));}
    else if(e.key==='Enter'&&!list.hidden&&active>=0){e.preventDefault();pick(active);}
    else if(e.key==='Escape'&&!list.hidden){e.stopPropagation();close();}
  });
  // mousedown, а не click: иначе поле теряет фокус и список закрывается раньше.
  list.addEventListener('mousedown',e=>{const li=e.target.closest('[data-pick]');if(!li)return;e.preventDefault();pick(+li.dataset.pick);});
}
