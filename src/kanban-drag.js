// Kanban drag and drop for the dispatcher boards.
// A card can be dropped anywhere in a column (columns run to the bottom of the board) or on
// the status bar that appears at the bottom of the screen while a card is dragged: it lists
// every status, including columns hidden by the filters or scrolled out of view.
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);

function dropBar(doc){
 let bar=doc.getElementById('kanbanDropBar');
 if(!bar){
  bar=doc.createElement('div');bar.id='kanbanDropBar';bar.className='kanban-drop-bar';bar.hidden=true;
  bar.setAttribute('role','group');bar.setAttribute('aria-label','Перетащите карточку на нужный статус');
  doc.body.append(bar);
 }
 return bar;
}

// targets: [[status,label],…] in board order, or a function of the card id returning them;
// defaults to the visible columns.
export function wireKanbanDrag(box,onDrop,mayDrag,targets=null){
 const doc=box.ownerDocument,bar=dropBar(doc);
 let dragged=null;
 const columns=id=>(typeof targets==='function'?targets(id):targets)||[...box.querySelectorAll('.kcol')].map(col=>[col.dataset.kst,col.querySelector('.kcol-h>span')?.textContent||col.dataset.kst]);
 const clear=()=>{box.querySelectorAll('.kcol.over').forEach(col=>col.classList.remove('over'));bar.querySelectorAll('.over').forEach(el=>el.classList.remove('over'));};
 const finish=()=>{dragged?.classList.remove('dragging');dragged=null;clear();bar.hidden=true;bar.innerHTML='';doc.body.classList.remove('kanban-dragging');};
 const drop=async(e,status)=>{
  e.preventDefault();
  let id='';try{id=e.dataTransfer.getData('text/plain');}catch{/* Some browsers hide the payload; fall back to the dragged card. */}
  id=id||dragged?.dataset.kid||'';
  finish();
  if(id&&status&&mayDrag(id))await onDrop(id,status);
 };
 const accept=(e,el)=>{e.preventDefault();try{e.dataTransfer.dropEffect='move';}catch{/* read-only in some browsers */}el.classList.add('over');};
 box.querySelectorAll('.kcard').forEach(card=>{
  if(!mayDrag(card.dataset.kid)){card.removeAttribute('draggable');return;}
  card.setAttribute('draggable','true');
  card.addEventListener('dragstart',e=>{
   dragged=card;card.classList.add('dragging');
   try{e.dataTransfer.setData('text/plain',card.dataset.kid);e.dataTransfer.effectAllowed='move';}catch{/* ignore */}
   const current=card.closest('.kcol')?.dataset.kst;
   bar.innerHTML=columns(card.dataset.kid).map(([status,label])=>`<div class="kanban-drop-target" data-drop-status="${escape(status)}"${status===current?' aria-current="true"':''}>${escape(label)}</div>`).join('');
   bar.querySelectorAll('[data-drop-status]').forEach(target=>{
    if(target.hasAttribute('aria-current'))return;
    target.addEventListener('dragover',e=>accept(e,target));
    target.addEventListener('dragleave',()=>target.classList.remove('over'));
    target.addEventListener('drop',e=>drop(e,target.dataset.dropStatus));
   });
   const pane=box.closest('.pane')||box;bar.style.left=Math.max(0,Math.round(pane.getBoundingClientRect().left))+'px';
   bar.hidden=false;doc.body.classList.add('kanban-dragging');
  });
  card.addEventListener('dragend',finish);
 });
 box.querySelectorAll('.kcol').forEach(col=>{
  col.addEventListener('dragover',e=>accept(e,col));
  col.addEventListener('dragleave',e=>{if(!col.contains(e.relatedTarget))col.classList.remove('over');});
  col.addEventListener('drop',e=>drop(e,col.dataset.kst));
 });
}

// The dispatcher header shrinks to its tabs while the board is scrolled.
export function wireBoardCompact(section,board){
 if(!section||!board||board.dataset.compactWired)return;
 board.dataset.compactWired='';
 board.addEventListener('scroll',()=>{
  const y=board.scrollTop;
  if(section.classList.contains('is-compact')){if(y<4)section.classList.remove('is-compact');return;}
  // Shrinking the header lengthens the board; compact only when the content still overflows
  // after that, so the board never snaps back to the top.
  const header=[...section.children].filter(node=>node!==board&&!node.contains(board)).reduce((n,node)=>n+node.offsetHeight,0);
  if(y>48&&board.scrollHeight-board.clientHeight>header+48)section.classList.add('is-compact');
 },{passive:true});
}
