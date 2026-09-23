const round=(value,places=2)=>Math.round((Number(value)||0)*10**places)/10**places;
const finite=value=>value!=null&&Number.isFinite(+value);

function taskShares(stay,linkedOrderIds){
  const source=Array.isArray(stay.task_allocations)
    ? stay.task_allocations
    : stay.service_order_id?[{order_id:stay.service_order_id,share:1}]:[];
  const rows=source.filter(x=>finite(x.share)&&+x.share>0);
  const sum=rows.reduce((n,x)=>n+(+x.share),0);
  if(sum>1.000001)throw new Error('Доли заданий для стоянки превышают 100%.');
  if(rows.some(x=>!linkedOrderIds.has(x.order_id)))throw new Error('Стоянка связана с заданием вне этого выезда.');
  return rows.map(x=>({order_id:x.order_id,share:+x.share}));
}

function segmentTarget(segment,stays){
  const a=Date.parse(segment.fromTs),b=Date.parse(segment.toTs);
  if(!Number.isFinite(a)||!Number.isFinite(b)){
    if(String(segment.why||'').includes('возвращение на финиш'))return stays.at(-1)||null;
    return null;
  }
  const mid=a+(b-a)/2;
  const active=stays.find(s=>mid>=s.from&&mid<=s.to);
  if(active)return active;
  const next=stays.find(s=>s.from>=b);
  if(next)return next;
  const last=stays.at(-1);
  return last&&a>=last.to?last:null;
}

// Builds a reviewable allocation from confirmed source facts. Track sections
// without reliable road/short-hop geometry, missing stops, and unmatched
// odometer distance remain visible as unallocated rows.
export function calculateTripCostAllocation({trip,track,stays=[],taskOrderIds=[]}){
  if(!trip||trip.status!=='done')throw new Error('Распределение доступно после подтверждения выезда.');
  if(!finite(trip.fact_km)||+trip.fact_km<0)throw new Error('Для распределения нужен подтверждённый факт-пробег.');
  const snapshot=trip.econ_snapshot||{},tariffs=trip.tariffs_snapshot||{},costs=tariffs.costs||{};
  if(snapshot.cost_basis!=='fact')throw new Error('В снимке выезда ещё нет подтверждённого факта себестоимости.');
  const linked=new Set(taskOrderIds),rows=[],knownStays=[];
  for(const stay of stays){
    if(stay.status!=='approved'||!stay.stay_from||!stay.stay_to
       ||!['snapshot','manager'].includes(stay.crew_source))continue;
    const shares=taskShares(stay,linked),from=Date.parse(stay.stay_from),to=Date.parse(stay.stay_to);
    knownStays.push({...stay,from,to,task_allocations:shares});
  }
  knownStays.sort((a,b)=>a.from-b.from);

  const factKm=+trip.fact_km,kmTotal=round(snapshot.cKm),kmRate=finite(costs.km)?+costs.km:0;
  const measured=Array.isArray(track?.segments)?track.segments:[];
  const positive=measured.map((segment,index)=>({segment,index,km:+segment.km||0})).filter(x=>x.km>0);
  const reliable=positive.filter(x=>['road','track'].includes(x.segment.kind));
  const unreliable=positive.filter(x=>!['road','track'].includes(x.segment.kind));
  const reliableKm=reliable.reduce((n,x)=>n+x.km,0);
  const scale=reliableKm>factKm&&reliableKm>0?factKm/reliableKm:1;
  if(Math.abs(kmTotal-round(factKm*kmRate))>0.05)throw new Error('Себестоимость пробега не совпадает со снимком тарифа. Пересчитай экономику выезда.');
  let allocatedKm=0,allocatedDistanceCost=0,knownUnallocatedKm=0,knownUnallocatedCost=0,unknownSegments=0;
  for(const item of reliable){
    const target=segmentTarget(item.segment,knownStays);
    const shares=target?target.task_allocations:[];
    const usedKm=item.km*scale;
    if(!shares.length)unknownSegments++;
    let assignedShare=0;
    if(shares.length){
      for(const x of shares){
        const quantity=round(usedKm*x.share,3),amount=round(quantity*kmRate);
        assignedShare+=x.share;allocatedKm+=quantity;allocatedDistanceCost+=amount;
        rows.push({cost_type:'distance',service_order_id:x.order_id,track_segment_index:item.index,
          quantity,unit_rate:kmRate,amount,basis:x.share<1?'подтверждённая доля задания на остановке':'участок до обслуживаемой точки',
          source_ref:item.segment.why||item.segment.kind});
      }
    }
    const residualKm=usedKm*(1-assignedShare);
    const residualAmount=round(residualKm*kmRate);
    if(residualKm>0){
      knownUnallocatedKm+=residualKm;knownUnallocatedCost+=residualAmount;
      rows.push({cost_type:'distance_unallocated',service_order_id:null,track_segment_index:item.index,
        quantity:round(residualKm,3),unit_rate:kmRate,amount:residualAmount,
        basis:!target?'не найдена подтверждённая остановка':'часть доли не назначена',
        source_ref:item.segment.why||item.segment.kind});
    }
  }
  const kmResidual=round(factKm-allocatedKm-knownUnallocatedKm,3);
  if(kmResidual>0.0001){
    rows.push({cost_type:'distance_unallocated',service_order_id:null,track_segment_index:null,
      quantity:kmResidual,unit_rate:kmRate,amount:round(kmResidual*kmRate),
      basis:reliableKm>factKm?'GPS-пробег превышает подтверждённый одометр; часть одометра без надёжного участка':'нет надёжного участка трека для остатка одометра',
      source_ref:'odometer_reconciliation'});
    knownUnallocatedKm+=kmResidual;knownUnallocatedCost+=round(kmResidual*kmRate);
  }
  const costResidual=round(kmTotal-allocatedDistanceCost-knownUnallocatedCost);
  if(Math.abs(costResidual)>0.05)throw new Error('Строки пробега не сходятся со снимком себестоимости выезда.');
  if(Math.abs(costResidual)>=0.01){
    rows.push({cost_type:'distance_unallocated',service_order_id:null,track_segment_index:null,
      quantity:0,unit_rate:0,amount:costResidual,basis:'Округление строк до копеек',source_ref:'rounding_reconciliation'});
  }
  unknownSegments+=unreliable.length;

  const hourRate=finite(costs.hour)?+costs.hour:0;
  const laborFactKnown=snapshot.presence_basis==='person_hours_v1';
  const laborHours=laborFactKnown?knownStays.reduce((sum,stay)=>
    sum+(stay.minutes_mgr!=null&&Array.isArray(stay.crew_ids)?(+stay.minutes_mgr/60)*new Set(stay.crew_ids.filter(Boolean)).size:0),0):0;
  const laborTotal=round(laborHours*hourRate);
  let laborAllocated=0,laborKnownUnallocated=0;
  if(laborFactKnown){
    for(const stay of knownStays){
      if(stay.minutes_mgr==null||!Array.isArray(stay.crew_ids)||!stay.crew_ids.length)continue;
      const hours=(+stay.minutes_mgr/60)*new Set(stay.crew_ids.filter(Boolean)).size;
      let assigned=0;
      for(const x of stay.task_allocations){
        const quantity=round(hours*x.share,4),amount=round(quantity*hourRate);assigned+=x.share;laborAllocated+=amount;
        rows.push({cost_type:'labor',service_order_id:x.order_id,stay_id:stay.id,quantity,unit_rate:hourRate,amount,
          basis:'подтверждённые человеко-часы × доля задания',source_ref:'approved_stay'});
      }
      if(assigned<1){const amount=round(hours*(1-assigned)*hourRate);laborKnownUnallocated+=amount;rows.push({cost_type:'labor_unallocated',service_order_id:null,stay_id:stay.id,quantity:round(hours*(1-assigned),4),
        unit_rate:hourRate,amount,basis:'не вся доля человеко-часов назначена заданию',source_ref:'approved_stay'});}
    }
  }
  const laborResidual=round(laborTotal-laborAllocated-laborKnownUnallocated);
  if(Math.abs(laborResidual)>=0.01)rows.push({cost_type:'labor_unallocated',service_order_id:null,stay_id:null,
    quantity:hourRate?round(laborResidual/hourRate,4):0,unit_rate:hourRate,amount:laborResidual,
    basis:laborFactKnown?'часы без однозначной связи с заданием':'факт человеко-часов не подтверждён',source_ref:'approved_stay'});
  else if(laborResidual!==0)rows.push({cost_type:'labor_unallocated',service_order_id:null,stay_id:null,
    quantity:0,unit_rate:0,amount:laborResidual,basis:'Округление строк до копеек',source_ref:'rounding_reconciliation'});

  const fixed=[['per_diem',snapshot.cDay,'суточные не распределяются по километрам'],['overnight',snapshot.cNight,'ночлег требует отдельного правила']];
  for(const [cost_type,value,basis] of fixed){if(round(value)!==0)rows.push({cost_type,service_order_id:null,quantity:1,unit_rate:round(value),amount:round(value),basis,source_ref:'trip_economics_snapshot'});}
  const costComputed=round(snapshot.costComputed),costTotal=round(snapshot.cost),adjustment=round(costTotal-costComputed);
  if(adjustment!==0)rows.push({cost_type:'manual_adjustment',service_order_id:null,quantity:1,unit_rate:adjustment,amount:adjustment,
    basis:trip.overrides?.cost_reason||'старое ручное переопределение без указанного основания',source_ref:'cost_override'});

  const components={
    distance:{total:kmTotal,assigned:round(allocatedDistanceCost),unallocated:round(knownUnallocatedCost+costResidual)},
    labor:{total:laborTotal,assigned:round(laborAllocated),unallocated:round(laborKnownUnallocated+laborResidual)},
    fixed:{total:round((+snapshot.cDay||0)+(+snapshot.cNight||0)),assigned:0,unallocated:round((+snapshot.cDay||0)+(+snapshot.cNight||0))},
    manual_adjustment:{total:adjustment,assigned:0,unallocated:adjustment}
  };
  for(const [name,part] of Object.entries(components))if(Math.abs(round(part.assigned+part.unallocated-part.total))>0.01)throw new Error(`Не сходится инвариант себестоимости: ${name}.`);
  return {rows,components,diagnostics:{fact_km:factKm,reliable_track_km:round(reliableKm,3),gps_variance_km:round(factKm-reliableKm,3),
    unknown_segments:unknownSegments,stays_used:knownStays.length,source_track_at:track?.at||null,
    source_revision:trip.workbench_revision??null},confirmed_total:round(Object.values(components).reduce((n,x)=>n+x.total,0))};
}
