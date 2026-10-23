// ============================================================
// DLIGHT · ПРОКСИ ДЛЯ OPENROUTESERVICE
// Файл: supabase/functions/ors/index.ts
//
// Зачем: раньше ключ ORS лежал в таблице settings, а её читает любой
// залогиненный пользователь. То есть ключ мог утащить любой инженер
// (и сжечь ваш лимит запросов или засветить его наружу).
// Теперь ключ живёт ТОЛЬКО здесь, в секрете функции, и наружу не отдаётся.
//
// Функция принимает {path, body}, проверяет что зовёт настоящий
// ДЕЙСТВУЮЩИЙ сотрудник, подставляет ключ и передаёт запрос в ORS.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'

const ORS_KEY = Deno.env.get('ORS_KEY') ?? ''
// Presence only: never log, return or download the secret itself. Merely adding
// a Free key does not enable commercial failover or change routing behavior.
console.info('GraphHopper configuration', JSON.stringify({
  key_configured: Boolean(Deno.env.get('GRAPHHOPPER_KEY')?.trim()),
  automatic_fallback: false,
}))

// белый список: наружу можно только эти три эндпоинта ORS, ничего больше
const UPSTREAM = new Map([
  ['v2/directions/driving-car/geojson', 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson'],
  ['v2/isochrones/driving-car', 'https://api.heigit.org/openrouteservice/v2/isochrones/driving-car'],
  ['optimization', 'https://api.heigit.org/vroom/v0'],
])
// A short, per-operation cooldown stops repeated calls during provider outages.
// This is local to a warm function instance, not a global availability guarantee.
const unavailableUntil = new Map<string, number>()

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After',
}

const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, ...headers, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: { message: 'Только POST' } }, 405)
  if (!ORS_KEY) return json({ error: { message: 'Секрет ORS_KEY не задан у функции' } }, 500)

  // Проверяем, что это ДЕЙСТВУЮЩИЙ сотрудник.
  //
  // Раньше здесь стоял auth.getUser(): он подтверждал только факт входа.
  // Этого мало по двум причинам. Во-первых, признак profiles.active
  // проверяется единственным местом — функцией is_staff(), и getUser() до неё
  // не доходил: у сотрудника с active=false пропадал доступ к клиентам,
  // заявкам и выездам, а маршрутизация продолжала работать и жечь квоту.
  // Во-вторых, getUser() — это лишний поход по сети к серверу авторизации
  // перед КАЖДЫМ обращением к ORS, а построение матрицы объездов шлёт
  // до 28 запросов подряд.
  //
  // is_staff() решает обе задачи одним вызовом: он не сможет вернуть true
  // без действительной сессии (auth.uid() внутри него будет null) и заодно
  // смотрит на active. Голый anon-ключ сюда не пройдёт.
  const auth = req.headers.get('Authorization') ?? ''
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    )
    const { data: staff, error } = await sb.rpc('is_staff')
    if (error) {
      console.error('is_staff failed:', error.message)
      return json({ error: { message: 'Не удалось проверить сессию' } }, 401)
    }
    if (staff !== true) {
      return json({ error: { message: 'Нужен вход в систему действующим сотрудником' } }, 403)
    }
  } catch (e) {
    console.error('проверка сессии упала:', e)
    return json({ error: { message: 'Не удалось проверить сессию' } }, 401)
  }

  let payload: { path?: string; body?: unknown }
  try { payload = await req.json() } catch { return json({ error: { message: 'Битый JSON' } }, 400) }

  const path = payload?.path
  if (typeof path !== 'string' || !UPSTREAM.has(path)) {
    return json({ error: { message: 'Эндпоинт не разрешён: ' + path } }, 400)
  }
  const remaining = Math.ceil(((unavailableUntil.get(path) ?? 0) - Date.now()) / 1000)
  if (remaining > 0) {
    return json({ error: { code: 'ORS_TEMPORARILY_UNAVAILABLE', message: 'Сервис построения маршрутов ORS временно недоступен. Повторите попытку позже.', retry_after_seconds: remaining } }, 503, { 'Retry-After': String(remaining) })
  }

  // A rejected upstream fetch previously escaped Deno.serve without CORS.
  // The browser then reported only "Failed to fetch", hiding the ORS failure.
  // Retry a transport failure once; preserve all ORS HTTP errors and quotas.
  for (let attempt = 0; attempt < 2; attempt++) {
    const signal = AbortSignal.timeout(30_000)
    try {
      const r = await fetch(UPSTREAM.get(path)!, {
        method: 'POST',
        signal,
        headers: { 'Authorization': ORS_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.body ?? {}),
      })
      const text = await r.text()
      if ([502, 503, 504].includes(r.status)) unavailableUntil.set(path, Date.now() + 30_000)
      else if (r.ok) unavailableUntil.delete(path)
      // Maintenance pages and gateway HTML are not ORS JSON errors. Never pass
      // them into the UI as raw markup or mistake a 200 HTML page for a route.
      try { JSON.parse(text) } catch {
        if (r.ok) unavailableUntil.set(path, Date.now() + 30_000)
        const maintenance = r.status === 503 && /maintenance/i.test(text)
        const status = r.status >= 400 ? r.status : 502
        return json({ error: {
          code: maintenance ? 'ORS_MAINTENANCE' : 'ORS_INVALID_RESPONSE',
          message: maintenance ? 'В сервисе построения маршрутов ORS технические работы. Повторите попытку позже.' : 'Сервис построения маршрутов ORS временно не может вернуть расчёт. Повторите попытку позже.',
        } }, status)
      }
      return new Response(text, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } })
    } catch (e) {
      const error = e as { name?: string; code?: string } | null
      const timedOut = signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError'
      // Never log keys, session headers, coordinates or the raw exception.
      console.error('ORS transport failed', { path, attempt: attempt + 1, code: timedOut ? 'TIMEOUT' : (error?.code || 'FETCH_ERROR') })
      if (timedOut) {
        unavailableUntil.set(path, Date.now() + 30_000)
        return json({ error: { code: 'ORS_UPSTREAM_TIMEOUT', message: 'Сервис построения маршрутов ORS не ответил за 30 секунд. Повторите попытку позже.' } }, 504)
      }
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 300))
        continue
      }
      unavailableUntil.set(path, Date.now() + 30_000)
      return json({ error: { code: 'ORS_UPSTREAM_UNAVAILABLE', message: 'Нет соединения с сервисом построения маршрутов ORS. Повторите попытку через минуту.' } }, 502)
    }
  }
})
