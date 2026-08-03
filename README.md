# DLIGHT

Учёт выездного сервиса спецтехники. Supabase + браузерное приложение.

## Разработка

Нужен Node.js 20+.

```
npm install      # один раз
npm test         # тесты ядра (должно быть 17 passed)
npm run dev      # локальный просмотр, http://localhost:5173
npm run build    # сборка в dist/
```

## Как устроено

- `src/core/` — чистые вычисления (геометрия, формат, тарифы), покрыты тестами
- `tests/` — юнит-тесты и смоук-стенд загрузки
- `.github/workflows/deploy.yml` — сборка и выкат на GitHub Pages из main

Приложение переносится в модули постепенно. Карта и порядок — в `MODULES.md`.
Пока перенос не завершён, в проде живёт единый `index.html` из корня проекта.

## Выкат

Push в `main` → GitHub Action собирает, гоняет тесты и смоук, публикует на Pages.
Один раз включить: Settings → Pages → Source → GitHub Actions.
