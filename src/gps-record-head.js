import {journalIcon as icon} from './journal-icons.js';
// GPS record header as in mockup v65: crumbs, title with link state, source and link facts, tabs underneath.
export function frameGpsRecordHead(head,{back,linkLabel,openLink,source,status}){
 if(!head||head.querySelector('.workflow-gps-crumbs'))return;
 const doc=head.ownerDocument,el=(tag,cls)=>{const node=doc.createElement(tag);node.className=cls;return node;};
 const crumbs=el('div','workflow-gps-crumbs'),backButton=head.querySelector('[data-ut-back]');
 if(backButton){backButton.classList.add('workflow-back');backButton.setAttribute('aria-label',backButton.textContent.replace(/^←\s*/,'')||'К журналу');backButton.innerHTML=icon('back');crumbs.append(backButton);}
 const label=el('span','workflow-gps-crumb');label.textContent='Журнал GPS';crumbs.append(label);
 const all=el('button','link workflow-crumb-link');all.type='button';all.textContent='Все записи';all.onclick=()=>back?.();crumbs.append(all);
 head.prepend(crumbs);
 const titleBox=[...head.children].find(node=>node.querySelector?.(':scope>h2'));
 if(titleBox){
  titleBox.classList.add('workflow-gps-title');
  const chip=el('span','design-status workflow-stage');chip.textContent=status;titleBox.querySelector('h2').after(chip);
  const facts=el('dl','workflow-metadata workflow-gps-facts');
  facts.innerHTML='<div><dt>Источник</dt><dd></dd></div><div><dt>Связь</dt><dd></dd></div>';
  facts.querySelector('div:first-child dd').textContent=source;
  const link=el('button','link workflow-request-link');link.type='button';link.textContent=linkLabel||'Без выезда';link.disabled=!openLink;if(openLink)link.onclick=openLink;facts.querySelector('div:last-child dd').append(link);
  titleBox.append(facts);
 }
 const tabs=head.querySelector('.journal-trip-tabs');if(tabs){tabs.setAttribute('role','tablist');tabs.classList.add('workflow-gps-tabs');head.append(tabs);}
}
