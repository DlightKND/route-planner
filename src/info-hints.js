const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function infoHint(text, label = 'Пояснение') {
  return `<span class="q"><button class="qm" type="button" aria-label="${esc(label)}" aria-expanded="false">?</button><span class="qbody">${esc(text)}</span></span>`;
}

// Delegation also covers hints inserted when cards and charts are rendered.
export function installInfoHints(doc = document, win = window) {
  let current = null, sequence = 0;
  const close = () => {
    if (!current) return;
    current.classList.remove('on', 'flip');
    current.querySelector('.qm').setAttribute('aria-expanded', 'false');
    current = null;
  };
  const position = () => {
    if (!current) return;
    const button = current.querySelector('.qm'), body = current.querySelector('.qbody');
    if (!button.getClientRects().length) { close(); return; }
    const rect = button.getBoundingClientRect(), gap = 8;
    body.style.maxHeight = `${Math.max(0, win.innerHeight - gap * 2)}px`;
    const box = body.getBoundingClientRect();
    body.style.left = `${Math.max(gap, Math.min(rect.left, win.innerWidth - box.width - gap))}px`;
    const below = rect.bottom + gap;
    const top = below + box.height <= win.innerHeight - gap ? below : rect.top - gap - box.height;
    body.style.top = `${Math.max(gap, Math.min(top, win.innerHeight - box.height - gap))}px`;
  };
  doc.addEventListener('click', event => {
    const button = event.target.closest('.qm');
    if (!button) {
      // A hint inside a label must not activate its associated input/button.
      if (current?.querySelector('.qbody').contains(event.target)) event.preventDefault();
      if (!current?.contains(event.target)) close();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const hint = button.closest('.q');
    if (current === hint) { close(); return; }
    close();
    const body = hint?.querySelector('.qbody');
    if (!body) return;
    current = hint;
    body.id ||= `info-hint-${++sequence}`;
    button.setAttribute('aria-controls', body.id);
    button.setAttribute('aria-expanded', 'true');
    current.classList.add('on');
    position();
  });
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !current) return;
    const button = current.querySelector('.qm');
    close();
    button.focus();
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  doc.addEventListener('scroll', position, true);
  win.addEventListener('resize', position);
}
