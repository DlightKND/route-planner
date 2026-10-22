export const nativeFieldValue=el=>el?.multiple?[...el.selectedOptions].map(o=>o.value):el?.type==='checkbox'||el?.type==='radio'?el.checked:el?.value;
export function captureNativeForm(root){
 const fields=[...root.querySelectorAll('input,select,textarea')].map(el=>({el,value:nativeFieldValue(el),options:el.tagName==='SELECT'?[...el.options].map(o=>o.cloneNode(true)):null}));
 return {fields,restore(){for(const {el,value,options} of fields){if(options)el.replaceChildren(...options.map(o=>o.cloneNode(true)));if(el.multiple){for(const o of el.options)o.selected=value.includes(o.value);}else if(el.type==='checkbox'||el.type==='radio')el.checked=value;else el.value=value;}}};
}
