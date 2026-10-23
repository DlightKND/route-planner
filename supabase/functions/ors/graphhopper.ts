// Development adapter only. Not connected to automatic routing: GraphHopper
// Free requires a separate production agreement and cannot honor avoid areas.
// Start with one road leg; never split a larger request or discard constraints.
type Point = [number, number]

function point(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2
    && value.every(n => typeof n === 'number' && Number.isFinite(n))
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90
}

export function graphhopperRequest(input: unknown) {
  const body = input as Record<string, unknown> | null
  if (!body || Array.isArray(body) || typeof body !== 'object'
    || Object.keys(body).some(k => !['coordinates', 'preference'].includes(k))
    || (body.preference !== undefined && body.preference !== 'fastest')) {
    throw new Error('Тестовый резерв поддерживает только быстрый маршрут без дополнительных ограничений.')
  }
  const coords = body.coordinates
  if (!Array.isArray(coords) || coords.length !== 2 || !coords.every(point)) {
    throw new Error('Для тестового расчёта нужны две корректные точки.')
  }
  return { points: coords, profile: 'car', points_encoded: false, instructions: false, calc_points: true }
}

export function graphhopperResponse(input: unknown, calculatedAt: string) {
  const result = input as { paths?: Array<{ distance?: number; time?: number; points?: { type?: string; coordinates?: unknown[] }; points_order?: unknown }> } | null
  const path = result?.paths?.[0]
  if (!path || typeof path.distance !== 'number' || !Number.isFinite(path.distance) || path.distance <= 0
    || typeof path.time !== 'number' || !Number.isFinite(path.time) || path.time <= 0
    || path.points?.type !== 'LineString' || !Array.isArray(path.points.coordinates)
    || path.points.coordinates.length < 2 || !path.points.coordinates.every(point)
    || (path.points_order !== undefined && JSON.stringify(path.points_order) !== '[0,1]')) {
    throw new Error('GraphHopper вернул неполный или некорректный дорожный расчёт.')
  }
  const summary = { distance: path.distance, duration: path.time / 1000 }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: path.points.coordinates }, properties: {
      summary, segments: [{ ...summary }],
      routing: { provider: 'graphhopper', profile: 'car', calculated_at: calculatedAt, mode: 'development', cached: false },
    } }],
  }
}

export async function testGraphhopperRoute(input: unknown, key: string, fetcher = fetch) {
  const body = graphhopperRequest(input)
  if (!key.trim()) throw new Error('Серверный ключ GraphHopper не задан.')
  const endpoint = new URL('https://graphhopper.com/api/1/route')
  endpoint.searchParams.set('key', key)
  let response: Response
  let data: unknown
  try {
    response = await fetcher(endpoint.href, {
      method: 'POST', redirect: 'error', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    // Do not forward provider messages: they may contain URLs with the key.
    if (!response.ok) throw new Error('upstream')
    data = await response.json()
  } catch {
    throw new Error('Тестовый расчёт GraphHopper недоступен. Проверьте ключ, лимиты и доступность сервиса.')
  }
  return graphhopperResponse(data, new Date().toISOString())
}
