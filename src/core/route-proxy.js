// Only the ORS function of the connected project may receive the session token.
export function trustedRouteProxy(configured, projectUrl) {
  let proxy, project;
  try { proxy = new URL(configured); project = new URL(projectUrl); }
  catch { throw new Error('Некорректный адрес прокси ORS.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(project.hostname);
  if ((project.protocol !== 'https:' && !(local && project.protocol === 'http:'))
      || proxy.origin !== project.origin || proxy.username || proxy.password
      || proxy.search || proxy.hash || !/^\/functions\/v1\/ors\/?$/.test(proxy.pathname)) {
    throw new Error('Прокси ORS должен указывать на функцию ors подключённого проекта Supabase.');
  }
  return proxy.href;
}

export function requestRouteProxy(configured, projectUrl, token, payload, fetcher = fetch) {
  const endpoint = trustedRouteProxy(configured, projectUrl);
  return fetcher(endpoint, {
    method: 'POST', redirect: 'error', credentials: 'omit',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
