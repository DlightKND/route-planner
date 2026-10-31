// View-only filters. Empty values remain distinct from numeric zero.
export const catalogValues=(row,column)=>{
 const value=column.value(row),values=Array.isArray(value)?value:[value];
 return [...new Set((values.length?values:[null]).map(v=>v==null||v===''?null:v))];
};
export const catalogValueKey=value=>value==null?'empty:':'value:'+String(value);
export function catalogFilterActive(filter){return !!filter&&(filter.values!=null||filter.min!=null||filter.max!=null||filter.emptyOnly);}
export function catalogMatches(row,columns,filters,except=null){
 return columns.every(column=>{
  const filter=filters[column.key];if(column.key===except||!catalogFilterActive(filter))return true;
  return catalogValues(row,column).some(value=>{
   if(filter.values!=null&&!filter.values.includes(catalogValueKey(value)))return false;
   if(filter.min!=null||filter.max!=null||filter.emptyOnly){
    if(value==null)return !!filter.includeEmpty;
    if(filter.emptyOnly)return false;
    if(column.type==='number'&&!Number.isFinite(Number(value)))return false;
    const n=column.type==='number'?Number(value):String(value);
    return (filter.min==null||n>=filter.min)&&(filter.max==null||n<=filter.max);
   }return true;
  });
 });
}
export function filterCatalogRows(rows,columns,filters={},sort=null){
 const result=rows.filter(row=>catalogMatches(row,columns,filters));
 const column=columns.find(c=>c.key===sort?.key);if(!column)return result;
 const collator=new Intl.Collator('ru',{numeric:true,sensitivity:'base'});
 return result.map((row,index)=>({row,index})).sort((a,b)=>{
  const av=catalogValues(a.row,column).filter(v=>v!=null),bv=catalogValues(b.row,column).filter(v=>v!=null);
  if(!av.length||!bv.length)return av.length?-1:bv.length?1:a.index-b.index;
  const order=column.type==='number'?Number(av[0])-Number(bv[0]):collator.compare(av.join(', '),bv.join(', '));
  return order*(sort.direction==='desc'?-1:1)||a.index-b.index;
 }).map(x=>x.row);
}
export function catalogFacets(rows,columns,filters,key){
 const column=columns.find(c=>c.key===key),options=new Map();
 for(const row of rows)for(const value of catalogValues(row,column))options.set(catalogValueKey(value),{value,count:0});
 for(const row of rows.filter(r=>catalogMatches(r,columns,filters,key)))for(const value of catalogValues(row,column))options.get(catalogValueKey(value)).count++;
 return [...options.entries()].map(([key,option])=>({key,...option})).sort((a,b)=>a.value==null?1:b.value==null?-1:String(a.value).localeCompare(String(b.value),'ru',{numeric:true}));
}
