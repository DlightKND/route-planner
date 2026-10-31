import {it,expect} from 'vitest';
import {filterCatalogRows,catalogValueKey,catalogFacets} from '../src/core/catalog-filter.js';
const columns=[{key:'brand',value:r=>r.brand},{key:'hours',type:'number',value:r=>r.hours},{key:'date',type:'date',value:r=>r.date},{key:'models',value:r=>r.models}];
const rows=[{id:1,brand:'PALMS',hours:0,date:'2026-10-01',models:['A','B']},{id:2,brand:'HIAB',hours:24,date:'2026-10-10',models:['B']},{id:3,brand:'Hatz',hours:null,date:null,models:[]},{id:4,brand:'PALMS',hours:12,date:'2026-10-31',models:['C']}];
it('combines OR values with AND ranges and dates without mutating source rows',()=>{
 const filters={brand:{values:['PALMS','HIAB'].map(catalogValueKey)},hours:{min:12,max:24},date:{max:'2026-10-15'}};
 expect(filterCatalogRows(rows,columns,filters).map(r=>r.id)).toEqual([2]);expect(rows.map(r=>r.id)).toEqual([1,2,3,4]);
 expect(filterCatalogRows(rows,columns,{brand:{values:[]}})).toEqual([]);
});
it('distinguishes empty from zero, includes empty explicitly and handles multi-value cells',()=>{
 expect(filterCatalogRows(rows,columns,{hours:{min:0,max:0}}).map(r=>r.id)).toEqual([1]);
 expect(filterCatalogRows(rows,columns,{hours:{min:0,max:0,includeEmpty:true}}).map(r=>r.id)).toEqual([1,3]);
 expect(filterCatalogRows(rows,columns,{hours:{emptyOnly:true,includeEmpty:true}}).map(r=>r.id)).toEqual([3]);
 expect(filterCatalogRows(rows,columns,{models:{values:[catalogValueKey('B')]}}).map(r=>r.id)).toEqual([1,2]);
});
it('computes facets against other columns and sorts numeric values with empty last',()=>{
 const facets=catalogFacets(rows,columns,{hours:{min:12},brand:{values:[catalogValueKey('PALMS')]}},'brand');
 expect(facets.find(x=>x.value==='HIAB').count).toBe(1);expect(facets.find(x=>x.value==='PALMS').count).toBe(1);
 expect(filterCatalogRows(rows,columns,{}, {key:'hours',direction:'desc'}).map(r=>r.id)).toEqual([2,4,1,3]);
 expect(filterCatalogRows(rows,columns,{}, {key:'hours',direction:'asc'}).map(r=>r.id)).toEqual([1,4,2,3]);
});
