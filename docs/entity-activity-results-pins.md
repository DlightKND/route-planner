# Единая лента: результаты и закреплённые комментарии

## Миграции и совместимость

- `20261009144527_entity_activity_results_pins.sql`: атомарное событие результата и закрепления.
- `20261009145440_entity_activity_pin_actor_indexes.sql`: покрывающие частичные индексы трёх FK `pinned_by`.
- `20261009202442_entity_result_parent_purge_cascade.sql`: удаление новых событий вместе с авторизованно удаляемым заданием.

Все файлы созданы Supabase CLI `migration new`. Старые RPC и таблицы остаются совместимы. Нет backfill фиктивных результатов по старым историям; старые количества, статусы, финансы и телеметрия не изменяются.

## Запись результата

`service_order_record_result(p_id uuid, p_expected integer, p_items jsonb, p_note text, p_actual_date date, p_operation_id uuid, p_basis text default null)` → `{revision,event_id}`.

- `p_items`: прежний массив `{id,done_qty,result_note}`. `done_qty` — **выполнено всего**, не прибавка за текущую дату; форма показывает сохранённое ранее и остаток.
- `p_actual_date`: дата результата не позднее сегодняшнего дня по Киеву. Она не задаёт временной интервал присутствия и не меняет бухгалтерскую дату накопленного объёма.
- `p_operation_id`: UUID одной отправки, сохраняемый в черновике при неизвестном сетевом исходе. Повторить тот же UUID и содержимое.
- `p_basis`: основание исторического факта; canonical historical RPC проверяет импортированный черновик закрытой заявки и права. Историческому черновику без основания выдаётся ошибка основания; обычному заданию основание не позволяет обойти начало работы.

Implementation проверяет активную авторизацию/current `order_access`, блокирует заявку перед заданием, сравнивает повторный токен с автором/заданием/SHA256 тела. `p_expected` исключён из digest; остальные параметры включены, порядок массива значим. Повтор проверяется **перед** ожидаемой версией и возвращает исходные `{revision,event_id}`. Нельзя использовать UUID с другим текстом, объёмом, заданием или автором.

Затем вызывается **существующий** `service_order_result` или `service_order_historical_result` с прежними правами, статусными и количественными ограничениями. AFTER-снимок вставляется в той же транзакции. Ошибка вставки откатывает факт, revision и предыдущую историю. Unique operation ID предотвращает параллельное использование одного токена для разных заданий.

`service_order_result_events` клиенту доступна только на чтение по существующему `order_access`. INSERT/UPDATE/DELETE не разрешены. Public-wrapper SECURITY INVOKER; guarded implementation — SECURITY DEFINER в закрытой схеме. Anonymous EXECUTE отозван.

## Чтение связанных результатов

`entity_activity_results(p_kind text,p_id uuid)` → массив максимум 100 последних событий. `p_kind` = `order`, `job`, `trip`.

SECURITY INVOKER сначала проверяет активный профиль и фактическую SELECT/RLS-доступность родителя. Далее чтение идёт через RLS заданий и результатов:

| Родитель | Связь |
| --- | --- |
| Задание | `service_order_result_events.order_id = p_id` |
| Заявка | `service_orders.job_id = p_id` |
| Выезд | текущие `trip_service_orders.trip_id = p_id` |

Доступ к ребёнку не даёт доступа к чужому родителю. Legacy-карточка без новых событий получает `[]`.

Событие содержит `{id,order_id,actor_id,recorded_at,actual_date,snapshot}`. Snapshot: `{number,title,status,note,basis,items}`. Строки: `{id,kind,title,unit,planned_qty,done_qty,transferred_qty,result_note}`. Это суммарный AFTER-снимок активных строк; аннулированные строки исключены. Allow-list не включает prices/costs/revenue/tariffs/legacy JSON. Read RPC не возвращает operation ID, digest и служебную revision. История canonical RPC по-прежнему хранит предыдущие состояния; новая запись не переписывает более ранние результаты.

## Закрепления

`entity_activity_pin(p_kind text,p_id uuid,p_comment uuid,p_pinned boolean)` → `{comment_id,pinned_at,pinned_by}`. **ID комментария UUID** во всех трёх таблицах; bigint ID истории не подходит.

После блокировки родителя проверяются active profile, существующий/доступный parent, `responsibility_access`, `responsibility_manager` и точная принадлежность комментария. Общий пин меняют admin/logist либо owner/curator сущности, включая инженера с такой ответственностью. Обычный инженер-автор не меняет общий приоритет команды.

Повторное закрепление сохраняет исходного закрепившего и timestamp; снятие обнуляет обе колонки. UPDATE-grants не выдаются. BEFORE INSERT сбрасывает pin metadata, поэтому существующий INSERT комментария не позволяет самовольно закрепить его. Текст, автор и время immutable для клиента. Парный CHECK защищает согласованность колонок.

UI загружает закреплённые комментарии отдельно от latest100, иначе старый важный комментарий пропадёт. После потери полномочий действие исчезает, сервер сохраняет окончательную проверку прав.

## Удаление родителей

Третья миграция меняет **только новую** `service_order_result_events.order_id` связь с RESTRICT на CASCADE. Снимки нельзя редактировать/удалять напрямую клиентом, но они исчезают вместе с заданием при разрешённой серверной очистке родителя.

Это **не исправление всего механизма очистки корзины**. Live QA показала существующие барьеры: `service_orders.job_id`/`seed_request_id` → jobs RESTRICT, history/items → order NO ACTION, `trip_service_orders.order_id` → order RESTRICT. Их изменение вне scope. Тест намеренно снимает эти прежние зависимости перед privileged DELETE задания и убеждается, что новая связь не добавляет блокировку и каскадно удаляет только его result events/comments.

`pinned_by` → profiles остаётся RESTRICT: код приложения не содержит hard-delete профилей; существующие employee hierarchy и финансовый аудит уже имеют RESTRICT ссылки на профили. Выключение `profiles.active` остаётся допустимым, сохраняя атрибуцию пина. Возможный отдельный workflow физического удаления учётки требует самостоятельного решения по всей истории.

## Верификация

`tests/entity-result-events-db.test.js`: 15 meaningful PGlite tests с опубликованными canonical/access/responsibility функциями. Проверены atomic AFTER/history, отсутствие финансового leak, retry до revision-check, чужие операции/авторы/строки/родители, полный rollback при отказе event insert, quantity/status/inactive guards, историческое основание, агрегированные RLS-ленты, immutable ранний snapshot, пины трёх сущностей, spoofed INSERT, старые пины внеlatest100, anonymous/direct-write privileges и privileged parent cleanup.

До восстановления workspace: два QA BEGIN/ROLLBACK сценария подтвердили canonical qty1/revision1/event1, stale retry999, request/trip feeds, отсутствие финансовых ключей, engineer pin denial, logist pin, чужой comment/parent/read denial и RLS. После rollback число синтетических jobs/orders/trips/events — 0. Security advisors не нашли новых замечаний по добавленным объектам; performance FK warnings закрываются второй миграцией. Все три миграции применены в QA и production. Подтверждены наличие RPC, RLS событий, отсутствие прямых клиентских записей и anonymous EXECUTE, CASCADE новой связи и три покрывающих индекса pinned_by. Security advisor не нашёл новых замечаний по добавленным объектам.
