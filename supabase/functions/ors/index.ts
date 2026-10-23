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

// белый список: наружу можно только эти три эндпоинта ORS, ничего больше
const ALLOWED = new Set([
  'v2/directions/driving-car/geojson',
  'v2/isochrones/driving-car',
  'optimization',
])

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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
  if (typeof path !== 'string' || !ALLOWED.has(path)) {
    return json({ error: { message: 'Эндпоинт не разрешён: ' + path } }, 400)
  }

  // A rejected upstream fetch previously escaped Deno.serve without CORS.
  // The browser then reported only "Failed to fetch", hiding the ORS failure.
  // Retry a transport failure once; preserve all ORS HTTP errors and quotas.
  for (let attempt = 0; attempt < 2; attempt++) {
    const signal = AbortSignal.timeout(30_000)
    try {
      const r = await fetch('https://api.openrouteservice.org/' + path, {
        method: 'POST',
        signal,
        headers: { 'Authorization': ORS_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.body ?? {}),
      })
      const text = await r.text()
      return new Response(text, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } })
    } catch (e) {
      const error = e as { name?: string; code?: string } | null
      const timedOut = signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError'
      // Never log keys, session headers, coordinates or the raw exception.
      console.error('ORS transport failed', { path, attempt: attempt + 1, code: timedOut ? 'TIMEOUT' : (error?.code || 'FETCH_ERROR') })
      if (timedOut) {
        return json({ error: { code: 'ORS_UPSTREAM_TIMEOUT', message: 'Сервис построения маршрутов ORS не ответил за 30 секунд. Повторите попытку позже.' } }, 504)
      }
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 300))
        continue
      }
      return json({ error: { code: 'ORS_UPSTREAM_UNAVAILABLE', message: 'Нет соединения с сервисом построения маршрутов ORS. Повторите попытку через минуту.' } }, 502)
    }
  }
})
