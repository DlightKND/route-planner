const names=new WeakMap();
export function setButtonBusy(button,busy){
 if(!button)return;
 if(busy){if(!names.has(button))names.set(button,button.getAttribute('aria-label'));button.setAttribute('aria-label',button.getAttribute('aria-label')||button.textContent.trim());button.setAttribute('aria-busy','true');}
 else{button.removeAttribute('aria-busy');if(names.has(button)){const old=names.get(button);if(old===null)button.removeAttribute('aria-label');else button.setAttribute('aria-label',old);names.delete(button);}}
}
