// Arrange existing controls; their permissions, validation and save handlers
// remain owned by the original screens.
export function installOperationsUI(root=document) {
  for(const toolbar of root.querySelectorAll('.dispatcher-toolbar')) {
    const actions=toolbar.querySelector('.dispatcher-actions'),more=actions?.querySelector('.dispatcher-more');
    if(!actions||!more)continue;
    const filter=more.querySelector('.planner-filter-menu');
    if(filter)actions.insertBefore(filter,more);
    const select=filter?.querySelector('#jobLayout,#orderViewMode,#tripLayout');
    if(select){
      const old=select.closest('label'),label=root.createElement('label');
      label.className='dispatcher-view-mode';
      const caption=root.createElement('span');caption.className='sr-only';caption.textContent='Представление';
      label.append(caption,select);actions.insertBefore(label,more);old?.remove();
      if(toolbar.closest('#plTrips'))label.dataset.tripBoardOnly='';
    }
    const engineer=filter?.querySelector('#jobEngFilter,#orderEngineer,#tripEngFilter');
    if(engineer){
      const chips=root.createElement('div');chips.className='design-filter-chips';chips.setAttribute('aria-label','Активные фильтры');chips.hidden=true;toolbar.after(chips);
      const update=()=>{
        chips.replaceChildren();chips.hidden=!engineer.value;
        if(!engineer.value)return;
        const clear=root.createElement('button');clear.type='button';clear.className='btn sm ghost';
        clear.textContent=(engineer.selectedOptions[0]?.textContent||'Инженер')+' ×';
        clear.setAttribute('aria-label','Убрать фильтр по инженеру');
        clear.onclick=()=>{engineer.value='';engineer.dispatchEvent(new root.defaultView.Event('change',{bubbles:true}));update();};chips.append(clear);
      };
      engineer.addEventListener('change',update);update();
      const Observer=root.defaultView?.MutationObserver;
      if(Observer)new Observer(update).observe(engineer,{childList:true,subtree:true});
      if(toolbar.closest('#plTrips'))chips.dataset.tripBoardOnly='';
    }
  }
}
