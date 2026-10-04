// Starting, finishing and confirming a trip use their dedicated RPCs. A plan
// save may only switch between planned and assigned before execution begins.
export function configureTripPlanStatus(select,trip,mayWrite){
  const status=trip?.status||'planned';
  const labels={planned:'план',assigned:'назначен',in_progress:'в работе',finished:'на проверке',done:'подтверждён',cancelled:'отменён'};
  select.replaceChildren();
  for(const value of new Set(['planned','assigned',status])){
    const option=select.ownerDocument.createElement('option');
    option.value=value;option.textContent=labels[value]||value;
    select.append(option);
  }
  select.value=status;
  select.disabled=!mayWrite||!!trip?.started_at||!['planned','assigned'].includes(status);
}
