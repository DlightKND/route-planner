const paths={
 back:'<path d="M20 12H4m7-7-7 7 7 7"/>',
 car:'<path d="M2 7a2 2 0 0 1 2-2h10l7 7v6h-3a3 3 0 0 0-6 0H9a3 3 0 0 0-6 0H2z" fill="currentColor"/><path d="M14 7v5h5z" fill="var(--panel)" stroke="none"/><circle cx="6" cy="18" r="2"/><circle cx="15" cy="18" r="2"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 filters:'<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 warning:'<path d="m12 3 10 18H2zM12 9v4m0 3v1"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
 file:'<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h6m-6 4h6"/>',
 crew:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5v2"/>',
 tasks:'<path d="M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1"/>',
 route:'<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M5 16V8a3 3 0 0 1 6 0v8a3 3 0 0 0 6 0V8"/>',
 trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 edit:'<path d="m15 4 5 5M4 20l4-1L21 6l-5-5L3 14z"/>'
};
export const journalIcon=name=>'<svg class="journal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.file)+'</svg>';
