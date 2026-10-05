// Mounted panels retain their values and listeners when navigation changes.
const mounted = new WeakMap();
export function createEntityTabs(root, {
  tabSelector = '[data-entity-tab]', panelSelector = '[data-entity-panel]',
  tabKey = 'entityTab', panelKey = 'entityPanel', initial, onChange, scrollOnChange = true
} = {}) {
  mounted.get(root)?.destroy();
  let value = null;
  const tabs = () => [...root.querySelectorAll(tabSelector)];
  const enabled = () => tabs().filter(tab => !tab.disabled && !tab.hidden);
  const select = (name, {focus = false} = {}) => {
    const available = enabled();
    const chosen = available.find(tab => tab.dataset[tabKey] === name) || available[0];
    if (!chosen) return false;
    const previous = value;
    value = chosen.dataset[tabKey];
    for (const tab of tabs()) {
      const selected = tab === chosen;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of root.querySelectorAll(panelSelector)) panel.hidden = panel.dataset[panelKey] !== value;
    if (focus) {
      chosen.focus({preventScroll: true});
      chosen.scrollIntoView?.({block: 'nearest', inline: 'nearest', behavior: 'auto'});
    }
    if (previous !== null && previous !== value) {
      const panel = [...root.querySelectorAll(panelSelector)].find(el => el.dataset[panelKey] === value);
      const scroller = root.closest('.pane.scrollp') || root.querySelector('.pane.scrollp');
      const toolbar = root.querySelector('.entity-toolbar');
      if (scrollOnChange && panel && scroller && toolbar) {
        const height = toolbar.getBoundingClientRect().height;
        root.style.setProperty('--entity-toolbar-h', height + 'px');
        const styles = el => root.ownerDocument.defaultView.getComputedStyle(el);
        const inset = parseFloat(styles(scroller).paddingTop) || 0;
        const gap = parseFloat(styles(toolbar).marginBottom) || 16;
        root.style.setProperty('--entity-toolbar-inset', inset + 'px');
        scroller.scrollTop = Math.max(0, scroller.scrollTop + panel.getBoundingClientRect().top - scroller.getBoundingClientRect().top - height - gap);
      }
      onChange?.(value, {previous});
    }
    return true;
  };
  const click = event => {
    const tab = event.target.closest?.(tabSelector);
    if (tab && root.contains(tab) && !tab.disabled && !tab.hidden) select(tab.dataset[tabKey]);
  };
  const keydown = event => {
    const tab = event.target.closest?.(tabSelector);
    if (!tab || !root.contains(tab)) return;
    const available = enabled(), index = available.indexOf(tab);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = available[(index + 1) % available.length];
    else if (event.key === 'ArrowLeft') next = available[(index + available.length - 1) % available.length];
    else if (event.key === 'Home') next = available[0];
    else if (event.key === 'End') next = available.at(-1);
    else return;
    event.preventDefault();
    select(next.dataset[tabKey], {focus: true});
  };
  const controller = {select, get value() {return value;}, destroy() {
    root.removeEventListener('click', click);
    root.removeEventListener('keydown', keydown);
    if (mounted.get(root) === controller) mounted.delete(root);
  }};
  root.addEventListener('click', click);
  root.addEventListener('keydown', keydown);
  mounted.set(root, controller);
  select(initial);
  return controller;
}
