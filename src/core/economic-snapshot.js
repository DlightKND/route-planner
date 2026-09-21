import { econCompute } from './economics.js';

export function economicSnapshot(jobs, km, driveH, T, ov = {}, ctx = {}, jobCount = jobs.length, profs = [], turf = null){
  const plan=econCompute(jobs,km,driveH,T,ov,
    Object.assign({},ctx,{factKm:null,factWorkH:null}),profs,turf);
  const hasKm=ctx.factKm!=null&&Number.isFinite(+ctx.factKm)&&+ctx.factKm>=0;
  const hasHours=ctx.factWorkH!=null&&Number.isFinite(+ctx.factWorkH)&&+ctx.factWorkH>=0;
  const hasFact=hasKm||hasHours, completeFact=hasKm&&hasHours;
  const fact=hasFact?econCompute(jobs,km,driveH,T,ov,ctx,profs,turf):null;
  const best=fact||plan;
  return {
    // Разбивка выручки должна складываться в revenue. Появились запчасти —
    // значит в снимке им нужна своя строка, иначе rWork+rTravel+rPerDiem
    // тихо не сходится с итогом ровно на сумму проданного.
    revenue:plan.rev, rWork:plan.rWork, rParts:plan.rParts, rTravel:plan.rTravel, rPerDiem:plan.rPerDiem,
    cParts:(fact||plan).cParts,
    warrantyHours:plan.wh, workH:plan.workH, km:plan.km, driveH:plan.driveH,
    totalHours:plan.totalH, days:plan.days, nights:plan.nights,
    cLabor:best.cLabor, cKm:best.cKm, cDay:best.cDay, cNight:best.cNight,
    // cost/profit/margin — лучшее известное: факт, если он есть, иначе план.
    // Оба пути записи дают теперь одно и то же, поэтому дашборд складывает
    // сопоставимые величины.
    cost:best.cost, profit:best.profit, margin:best.margin,
    cost_basis:completeFact?'fact':(fact?'partial':'plan'),
    presence_basis:hasHours?'person_hours_v1':null,
    cost_plan:plan.cost, profit_plan:plan.profit, margin_plan:plan.margin,
    cost_fact:completeFact?fact.cost:null,
    profit_fact:completeFact?fact.profit:null,
    margin_fact:completeFact?fact.margin:null,
    factKm:fact?fact.factKm:null, factWorkH:fact?fact.factWorkH:null,
    jobCount:jobCount
  };
}
