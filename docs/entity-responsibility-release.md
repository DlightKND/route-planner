# Завершение перехода ответственности

Контрольная точка: `entity-responsibility.md`. PR: https://github.com/DlightKND/route-planner/pull/129.

**Статус 04.10.2026: выпуск завершён.** Production migration 20261004180339, push-send v10, merge f9f82f6e7a7fa80aa3883c4c98a8084df703ad34, успешные Actions #490 и Pages build b1a2110. QA fixture очищены, исходные 2 заявки/3 задания сохранены. Шаги ниже — исторический runbook, не инструкция повторного применения. Итоговые доказательства и границы проверки находятся в последнем разделе entity-responsibility.md.

## QA push

Подготовка выполняется в checkout QA, используя отдельные тестовые ключи. Генератор не печатает секреты, не заменяет существующий каталог и создаёт файлы с правами 0600. `VAPID_KEYS` использует формат publicKey/privateKey JWK библиотеки @negrel/webpush. Источник формата: https://jsr.io/@negrel/webpush/doc.

1. Выполнить `node scripts/qa-push-config.mjs mailto:ВАШ_EMAIL` в QA checkout. Не запускать повторно для уже созданной подписки.
2. В среде с авторизованным Supabase CLI проверить `supabase secrets set --help`, затем загрузить `.qa-push/edge-secrets.env` только в проект `cbwgqimrnogoahuqvrrw`: `supabase secrets set --project-ref cbwgqimrnogoahuqvrrw --env-file .qa-push/edge-secrets.env`. Альтернатива — Edge Function Secrets в Dashboard QA. Не отправлять значения в чат, не добавлять в git.
3. Добавить строку VITE_VAPID_PUBLIC из `.qa-push/vite.env` в локальный `.env.local` QA checkout и перезапустить предпросмотр. Frontend без этой переменной сохраняет существующий production public key; CI production не использует локальный QA файл.
4. Создать настоящую браузерную подписку через приложение и разрешить уведомления. Приватный JWK остаётся только у Edge Function; public key в frontend должен соответствовать ему.
5. Для разового вызова QA `push-send?kind=entity` использовать PUSH_SECRET из файла локально, не выводя URL/секрет в историю или логи. Проверить фактическое уведомление текущего куратора и журнал доставки, затем передачу и исключение прежнего куратора. В QA ещё нет cron отправщика: разовый вызов проверяет доставку, не доказывает работу расписания.

Настройка секретов: https://supabase.com/docs/guides/functions/secrets. Доступный MCP не содержит управления секретами; CLI токен в агентском окружении отсутствует. Эти шаги нельзя заменить hardcoded приватными ключами в исходниках Edge Function.

## Выпуск после QA

1. Повторить `scripts/migration-audit.sql` и `scripts/qa-responsibility-release-preflight.sql` против production `anqfbljgfimoaziztdxe`. 03.10 оба прогона прошли: historical_backfill_consistent=true, все восемь legacy guard блоков совпали. Проверить, что migration ответственности ещё не установлена.
2. Зафиксировать доступную резервную копию production и её способ восстановления. Backup пока не выполнен агентом. Восстановление после записей нового интерфейса должно сохранять новые данные, поэтому откат колонок/таблиц с DROP не является допустимым автоматическим rollback.
3. Применить `supabase/migrations/20260929110000_entity_responsibility.sql` один раз. QA corrective migrations повторно в production не применять: они уже включены в исходную миграцию.
4. Проверить grants/RLS, assignment RPC, исторические записи без фиктивных назначений, аудит владельца и обратную совместимость старых RPC. Повторить финансовый аудит.
5. Обновить production push-send из ветки. Существующие production PUSH_SECRET/VAPID не менять. Проверить cron `entity-curator-push`: исходное расписание trip-today-push активное, */15, его команда содержит kind=trip_today; миграция выводит отдельное kind=entity каждые две минуты.
6. Слить PR после успешных проверок. Обычный merge не публикует Pages: workflow требует workflow_dispatch или сообщения [deploy]. Выполнить публикацию после проверки production миграции и sender.
7. Проверить опубликованную версию и настоящую доставку. Удалить только синтетические QA fixture a3100300 и дочерние записи; исходные 2 заявки и 3 задания QA сохранить. Записать head SHA, migration version и Pages deployment в контрольную точку.

При проблеме после SQL, до публикации: остановить выпуск frontend, сохранить диагностику, исправлять совместимость вперёд. При проблеме после публикации: вернуть предыдущую сборку frontend, приостановить новый entity cron, сохранить новые назначения/историю и выполнять проверенное восстановление. Не выполнять destructive SQL отката без отдельной оценки данных.
