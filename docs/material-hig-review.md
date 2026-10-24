# DLIGHT · проверка Material Design и Apple HIG · предложения 0.4 / визуальная проверка 0.5

24 октября 2026. Проверенная база: `main` 7f3aca9542bd061ee235a221da7ea9f8484909c1; production-источники — реестр 0.3. Это аудит исходников и интерактивный прототип коррекций, не утверждение о полном соответствии всех рабочих экранов нативным платформам.

[Открыть интерактивный кит](https://dlightknd.github.io/route-planner/preview-design-system.html#conventions). Восемь сценарных групп, светлая/тёмная тема, база 0.2 / предложение, сенсорные цели и два варианта группы выбора. Сохранение, ошибка, выбор инженеров и удаление используют только синтетические данные. Новые picker/slider/sheet не имели полного образца «до» в каталоге 0.2; переключатель базы сравнивает прежние стили, а не реконструирует каждый production-экран.

## Полное сравнение 0.5

Каждая рекомендация R01–R12 и все 58 семейств представлены в [полном ките](https://dlightknd.github.io/route-planner/preview-design-system.html#full-kit), рядом с 8 разделами основы. [Геометрия и правила сравнения](design-system-geometry.md). Переключатель 0.4 не был полноценным A/B: некоторые исправления действовали в обеих версиях, а новые сценарии не имели старого образца. В 0.5 базовая и предлагаемая стороны изолированы, параметры измеряются через computed styles и bounding boxes.

Значение «Рабочий сценарий» в исторической таблице ниже обозначает необходимость production-пилота. Теперь визуальный пример имеется для каждого ID; это не означает интеграцию или проверку всех рабочих ролей. Для новых примеров левая сторона использует геометрию базового кита 0.4, а не выдуманный скриншот старой ошибки. Неизменённые решения явно помечены «Сохранено».

## Вывод и границы

Принятую палитру, IBM Plex Sans/Mono, сетку отступов 4/8/12/16/24/32 и роли радиусов 8/12/16/pill сохраняем. Отличие от Roboto, SF, Liquid Glass или системных синих кнопок само по себе не является функциональным нарушением. Не смешиваем физические dp/pt и CSS px: цель 48 CSS px для touch — выбранная веб-адаптация ориентиров Material 48 dp и HIG 44 pt, а не буквальное равенство единиц.

В существующей сводке `src/workspace-ui.css`: пресеты имеют min-height 34 px (36 на мобильном), стрелки шириной 36 px (30 на мобильном). Это конкретный повод расширить сенсорную область, а не обещание, что по одному CSS-размеру измерена вся область попадания. В текущем базовом ките 0.2 некоторые сегменты могут переноситься, switch показан вне полноценной строки, Undo и отдельные сложные контроли не представлены. Ошибки в DOM/семантике отделяем от визуальной адаптации бренда.

Критично различать: навигацию, выбранное представление, фильтр, немедленную настройку и редактирование черновика. Приоритет первой миграции — сводка/даты, picker инженеров и действия сохранения. Доменные протоколы GPS, offline и конфликтов требуют проверки целого рабочего сценария; гайдлайны не определяют момент принятия финансового или GPS-факта.

## Установленные правила и конкретные коррекции

| Код | Наблюдение и коррекция | Основание | Граница адаптации |
| --- | --- | --- | --- |
| R01 | Для touch увеличить кнопки, стрелки, checkbox-строки и поля до цели 48 CSS px; сохранить видимый focus. | [Material accessibility](https://developer.android.com/develop/ui/compose/accessibility/api-defaults), [HIG Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) | 48 CSS px и поле 16 px — политика DLIGHT; native размеры зависят от платформы. |
| R02 | Равный размер соседних команд, разный визуальный вес; loading удерживает ширину, исключает дубликат, сообщает ошибку и повтор. | [HIG Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Material states](https://m3.material.io/foundations/interaction/states/applying-states) | HIG допускает 1–2 заметные кнопки; одна primary в активном сценарии — наше более строгое правило. |
| R03 | Счётчик — вложенная мини-пилюля с неизменным семантическим цветом; selected не превращает опасность в нейтральную. Статус и число не отдельные кнопки. | [Material badges](https://m3.material.io/components/badges/guidelines), [Material chips](https://m3.material.io/components/chips/guidelines) | Журнальный count — собственный паттерн DLIGHT, не точная копия системного notification badge. |
| R04 | Связанные варианты — единый ряд без переноса, стабильные ширины и клавиатура; не смешивать команды с выбором. | [HIG Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls), [M3 button groups](https://m3.material.io/components/button-groups/guidelines), [обзор](https://m3.material.io/components/button-groups/overview) | В Expressive connected group заменяет segmented buttons; HIG сохраняет сегменты. В ките оба варианта. Официальная Expressive Web-реализация в таблице доступности не предоставлена; HTML/CSS — наша адаптация, не официальный компонент. |
| R05 | Switch — немедленная настройка в подписанной строке; pending и откат при ошибке. Radio/checkbox — решение в черновике, если запись требует Save. | [HIG Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles), [Material switches](https://m3.material.io/components/switch/guidelines) | iOS рекомендует switch в list row; для web/macOS не навязываем эту форму любому булеву выбору. |
| R06 | Постоянные labels, native date/number, ошибка рядом. Диапазон редактируется отдельно, Cancel не меняет применённые даты. | [HIG Pickers](https://developer.apple.com/design/human-interface-guidelines/pickers), [Material date pickers](https://m3.material.io/components/date-pickers/guidelines) | Native локаль поля принадлежит ОС/браузеру; итоговый диапазон приложение подписывает явно. Нет самодельной календарной сетки без её клавиатуры. |
| R07 | Picker инженеров: поиск + checkbox-строки, desktop popover, мобильный modal sheet; выбранные имеют stable ID и именованное удаление. | [HIG Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers), [Material lists](https://m3.material.io/components/lists/guidelines) | Поиск — улучшение текущего picker, не найденный ранее combobox. Его роль не присваивается без полного поведения. |
| R08 | Slider показывает заполненный track и число; exact input и ± обеспечивают точный выбор без drag. Preview не запускает запись. | [HIG Sliders](https://developer.apple.com/design/human-interface-guidelines/sliders), [Material sliders](https://m3.material.io/components/sliders/guidelines) | Коридор поиска 0–50 км — синтетический сценарий для проверки механики. Вертикальная ось времени — отдельная доменная адаптация. |
| R09 | Обратимое действие — Undo без лишнего alert; сообщение с действием не исчезает автоматически и не перехватывает фокус; Alt+G переводит к Undo, Esc закрывает сообщение. Необратимое — короткий alert с точным объектом, Cancel/Escape, без default. | [HIG Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts), [Material snackbar accessibility](https://m3.material.io/components/snackbar/accessibility) | HIG не назначает Cancel default; отсутствие default не означает запрет фокуса на Cancel. Для сознательно выбранного destructive у HIG есть исключения по стилю; красная явная команда в DLIGHT — наша консервативная политика. |
| R10 | FAB над нижними контролами; недоступная скрывается. Sheet имеет явные вход/выход и не требует жеста для доступа к содержимому. | [Material FAB](https://m3.material.io/components/floating-action-button/guidelines), [HIG Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) | В ките простая modal-шторка без draggable detents. Геометрия схемы не подтверждает отсутствие перекрытий на реальном Leaflet. |
| R11 | Смысл не только цветом: подпись, состояние, доступное имя; shared tokens и роли поверхностей в обеих темах. | [Material states](https://m3.material.io/foundations/interaction/states/applying-states), связанные HIG-компоненты выше | Палитра, отступы, тени и радиусы — наш единый контракт; не копируем системный визуальный стиль целиком. |
| R12 | Сохранить различия local draft / queued / server / conflict / accepted GPS; отдельно проверить роли и ошибки. | [Контракты DLIGHT 0.3](design-system.md) + общие R02/R09 | Это правила предметной области, не прямые требования Material/HIG. Внешний вид прототипа не доказывает корректность записи в Supabase. |

## Покрытие всех найденных семейств

В таблице все 58 семейств реестра 0.3, каждое ровно один раз. «Рабочий сценарий» означает необходимость отдельного production-пилота, а не обнаруженную ошибку и не реализованный новый образец. Для каждой семьи дано конкретное действие; обоснование находится в R01–R12. Исходник — проверенный источник существующей реализации.

| ID / семейство | Правила | Что сделать или сохранить | Где посмотреть / проверить | Источник |
| --- | --- | --- | --- | --- |
| `action-button` · Кнопка: primary / secondary / tertiary / destructive | R01, R02 | Уравнять размер соседних действий; вес задавать стилем. Удерживать ширину loading и блокировать повтор. | Действия | [src/entity-actions.js](../src/entity-actions.js) |
| `icon-button` · Кнопка с иконкой и доступным именем | R01, R11 | Дать стабильное имя и сенсорную цель 48 CSS px; подсказка не заменяет имя. | Даты, слайдер | [src/journal-route.js](../src/journal-route.js) |
| `navigation-link` · Ссылка, переход и browser back | R11 | Сохранить ссылки для переходов и browser Back; не заменять их кнопками сохранения. | Базовый каталог | [src/app.js](../src/app.js) |
| `status-badge` · Неинтерактивный статус | R03, R11 | Сохранить текстовый статус; убрать состояния нажатия у информационного badge. | Выбор | [src/presence-decision.js](../src/presence-decision.js) |
| `count-badge` · Вложенный счётчик: смысл / 0 / неизвестно | R03 | Сохранить внутреннюю мини-пилюлю журнала, семантический цвет, различие 0/—/…. | Выбор | [src/unified-journal.css](../src/unified-journal.css) |
| `filter-chip` · Фильтры: один или несколько, сброс | R03 | Выбранность обозначать формой/маркером и aria-pressed; цвет счётчика не перекрашивать. | Выбор | [src/unassigned-tracks.js](../src/unassigned-tracks.js) |
| `view-segment` · Сегментированный выбор представления | R04 | Один ряд связанных вариантов, равные доли, клавиатура. Сравнить HIG и M3 connected. | Выбор | [src/app.js](../src/app.js) |
| `decision-radio` · Radio / взаимоисключающий выбор в черновике | R05 | Взаимоисключающее решение оставлять в черновике до явного сохранения. | Настройки | [src/app.js](../src/app.js) |
| `checkbox-group` · Один checkbox и множественный выбор | R05, R07 | Независимый множественный выбор; нажимается подписанная строка целиком. | Инженеры | [src/engineer-picker.js](../src/engineer-picker.js) |
| `boolean-switch` · Немедленная настройка Вкл / Выкл | R05 | Немедленную настройку разместить в строке, показать pending и rollback ошибки. | Настройки | [src/app.js](../src/app.js) |
| `native-select` · Одиночный выбор из списка | R06 | Сохранять нативный одиночный select; не выдавать его за множественный выбор. | Базовый каталог | [index.html](../index.html) |
| `multi-select-popover` · Выбор инженеров: popover с checkbox, без поиска | R07 | Добавить поиск к существующему checkbox-picker; desktop popover, mobile sheet. | Инженеры | [src/engineer-picker.js](../src/engineer-picker.js) |
| `search-field` · Поиск списка: debounce / clear / пусто / ошибка | R07 | Показывать совпадения и пустой результат отдельно от отсутствия выбранных. | Инженеры: локальный поиск | [src/notifications.js](../src/notifications.js) |
| `search-result-picker` · Адресный поиск и выбор результата | R07, R12 | Различать ввод адреса и выбор стабильного результата; проверить async/error/отмену. | Рабочий сценарий | [src/app.js](../src/app.js) |
| `text-field` · Текст / email / телефон / textarea | R01, R06 | Постоянная подпись и ошибка рядом с полем; сенсорный размер ввода 16 CSS px — политика проекта. | Базовый каталог | [index.html](../index.html) |
| `number-unit` · Количество / деньги / длительность / доля | R06, R08 | Явная единица и точное число; пустое не приравнивать к нулю. | Слайдер и базовый каталог | [src/service-orders.js](../src/service-orders.js) |
| `date-field` · Дата, время, дата со временем, месяц | R06 | Оставить нативный ввод и локаль ОС; не подменять его имитацией iOS wheels. | Даты и базовый каталог | [src/app.js](../src/app.js) |
| `date-range` · Диапазон дат в черновике | R06 | Редактировать диапазон в черновике, валидировать порядок, Cancel сохраняет старый период. | Даты | [src/app.js](../src/app.js) |
| `period-navigator` · Пресеты, стрелки и календарный период | R01, R04, R06 | Расширить цель стрелок; удержать пресеты в одном ряду; явно показывать применённый диапазон. | Даты | [src/app.js](../src/app.js) |
| `month-navigator` · Месяц журнала и выбор произвольных дат | R06 | Те же правила периода применить к месяцу журнала; отдельно проверить переходы года. | Рабочий сценарий | [src/app.js](../src/app.js) |
| `range-slider` · Слайдер расстояния / времени / разрыва | R08 | Добавить заполненную шкалу, видимое число, exact input и ± без перетаскивания. | Слайдер | [index.html](../index.html) |
| `color-picker` · Цвет объекта карты с подписью | R11 | Сохранить имя/код выбранного цвета и preview; не передавать смысл одним swatch. | Рабочий сценарий | [index.html](../index.html) |
| `photo-upload` · Файлы / фото: выбор, очередь, повтор | R02, R09, R12 | Указать этап/ошибку по каждому файлу и повтор; не выдавать local preview за загрузку. | Рабочий сценарий | [src/app.js](../src/app.js) |
| `image-viewer` · Просмотр фото и выход из него | R10, R11 | Явный выход, Escape и возврат фокуса; проверить zoom и жесты на устройстве. | Рабочий сценарий | [src/app.js](../src/app.js) |
| `application-navigation` · Rail / нижняя навигация / Ещё | R04, R10 | Основные разделы — navigation, не сегменты. Проверить safe-area и выделение текущего. | Рабочий сценарий | [index.html](../index.html) |
| `entity-tabs` · Вкладки записи с сохранением состояния панелей | R04, R11 | Вкладки — связанные панели сущности, tab semantics и стрелки; не смешивать с командами. | Навигация самого кита | [src/entity-tabs.js](../src/entity-tabs.js) |
| `record-card` · Карточка, строка списка, доска состояний | R02, R11 | Различать открытие карточки и вложенные команды, без конкурирующих primary в списке. | Рабочий сценарий | [src/service-orders.js](../src/service-orders.js) |
| `grouped-list` · Группированный справочник, раскрытие уровней | R07, R11 | Сохранить иерархию подписанных групп; раскрытие не меняет выбранность записей. | Рабочий сценарий | [src/app.js](../src/app.js) |
| `disclosure` · Свёрнутый блок / details / accordion | R11 | Явная кнопка/details, aria-expanded, целевая область; не роль menu для простого раскрытия. | Рабочий сценарий | [src/journal-route.js](../src/journal-route.js) |
| `help-popover` · Пояснение по нажатию с keyboard-доступом | R07, R11 | Открытие по нажатию/клавиатуре; важная причина недоступности видна и без hover. | Рабочий сценарий | [src/info-hints.js](../src/info-hints.js) |
| `context-panel` · Немодальный контекстный popover | R07, R10 | Немодальная панель не блокирует фон и не теряет anchor/фокус при закрытии. | Механика picker; отдельный пилот | [src/context-panels.js](../src/context-panels.js) |
| `modal-editor` · Модальный редактор / подтверждение | R06, R09, R10 | Настоящая модальность, Cancel/Escape, focus return; опасный alert без default. | Даты, обратная связь | [src/modal-shell.js](../src/modal-shell.js) |
| `bottom-sheet` · Шторка карты и положения раскрытия | R10 | Явные открыть/закрыть, безопасный низ, доступный контент без обязательного drag. | Карта: простой sheet | [src/app.js](../src/app.js) |
| `action-menu` · Другие действия: disclosure / menu / dialog | R02, R11 | Редкие команды раскрывать отдельно; не навязывать menu semantics без его клавиатуры. | Базовый каталог | [src/entity-actions.js](../src/entity-actions.js) |
| `editable-items` · Повторяемые строки работ / материалов | R06, R12 | Подписать повторяемые поля, управлять фокусом добавления/удаления и ошибками строки. | Рабочий сценарий | [src/service-orders.js](../src/service-orders.js) |
| `bulk-selection` · Массовый выбор и preview объединения | R09, R12 | Показать число и область выбранного; preview объединения до записи, отмена без потерь. | Рабочий сценарий | [src/unassigned-tracks.js](../src/unassigned-tracks.js) |
| `reorder` · Перестановка маршрута / карточек / панелей | R08, R12 | Дать точный способ перестановки помимо drag; сохранение и отмену не смешивать с preview. | Рабочий сценарий | [src/app.js](../src/app.js) |
| `schedule-manipulation` · Перенос / изменение / разделение графика | R08, R12 | Точные время/длительность помимо resize/drag; Escape откатывает, split требует preview. | Рабочий сценарий | [src/schedule-interactions.js](../src/schedule-interactions.js) |
| `map-explorer` · Карта / миникарта / маркеры / список | R10, R12 | Проверить перекрытие Leaflet-контролов/шторок; список — доступная альтернатива геометрии. | Только схема компоновки, не MapExplorer | [src/gps-track-map.js](../src/gps-track-map.js) |
| `gps-evidence` · Измерение / восстановление / принятое решение | R11, R12 | Сохранить измеренное/восстановленное/принятое отдельно; зелёный speed ramp и оранжевый пунктир. | Доменный контракт, не мигрирован | [src/presence-review-controls.js](../src/presence-review-controls.js) |
| `allocation-editor` · Распределение времени / пробега и остаток | R02, R06, R12 | Видимый остаток, объяснение блокировки, валидный ноль отдельно от пустого, явный commit. | Базовый сценарий сверки, не полный редактор | [src/presence-review-controls.js](../src/presence-review-controls.js) |
| `charts-tables` · Сопоставимые диаграммы и таблицы | R04, R11 | Одинаковые данные в chart/table; единицы и подписи не передавать только цветом. | Базовый каталог | [src/dashboard-visuals.js](../src/dashboard-visuals.js) |
| `activity-comments` · Лента, комментарии, закрепление, доказательства | R02, R12 | Сохранить авторство/время, pending и ошибку публикации; действия рядом с записью. | Рабочий сценарий | [src/entity-activity.js](../src/entity-activity.js) |
| `notifications-inbox` · Входящие: прочитано / действия / счётчик | R03, R09 | Счётчик непрочитанного не путать с числом ошибок; открытия и действия разделены. | Рабочий сценарий | [src/notifications.js](../src/notifications.js) |
| `load-more` · Догрузка списка без потери выбора и фокуса | R02, R11 | Прогресс рядом с кнопкой, повторы блокировать, существующий выбор/фокус сохранять. | Рабочий сценарий | [src/notifications.js](../src/notifications.js) |
| `push-permission` · Push: устройство, разрешение, отказ, timeout | R09, R12 | Сначала объяснить пользу в контексте, затем запрос ОС; отказ и timeout не успешное включение. | Рабочий сценарий | [src/app.js](../src/app.js) |
| `feedback` · Toast / постоянный banner / inline error | R09 | Одно сообщение с Undo; actionable не исчезает само; постоянная ошибка остаётся в контексте. | Обратная связь | [src/app.js](../src/app.js) |
| `loading-progress` · Ожидание и прогресс длительной операции | R02 | Показать занятость операции и результат; краткое ожидание без ложного процента. | Действия, настройки | [src/app.js](../src/app.js) |
| `draft-guard` · Несохранённый черновик и связанное действие | R09, R12 | Подтверждать уход только при реальных несохранённых изменениях; сохранить/отбросить/остаться. | Рабочий сценарий | [src/entity-draft-resolution.js](../src/entity-draft-resolution.js) |
| `revision-conflict` · Конфликт версии после создания черновика | R09, R12 | Не перезаписывать новую версию молча; явно показать конфликт и сохранённый черновик. | Рабочий сценарий | [src/service-orders.js](../src/service-orders.js) |
| `offline-sync` · Локальная очередь / серверная запись / блокировка | R09, R12 | Локально в очереди и записано на сервере — разные состояния; ошибки не только toast. | Рабочий сценарий | [src/app.js](../src/app.js) |
| `trash-restore` · Корзина: восстановление и удаление навсегда | R09 | Обычное перемещение в корзину с Undo; необратимое удаление с объектом и последствиями. | Обратная связь | [src/app.js](../src/app.js) |
| `role-authority` · Просмотр, кураторство, передача ответственности | R02, R12 | Видимые границы полномочий и причина запрета; UI-скрытие не заменяет серверную проверку. | Только демонстрация FAB | [src/entity-responsibility.js](../src/entity-responsibility.js) |
| `auth-session` · Вход, потеря сессии и выход | R09, R12 | Потерю сессии отличать от сетевого сбоя; возврат после входа без ложного success. | Рабочий сценарий | [src/app.js](../src/app.js) |
| `profile-preferences` · Аватар / профиль / preview и сохранение темы | R05, R12 | Preview темы отличать от сохранения профиля; не объявлять немедленный switch, если нужен Save. | Тема кита, не профиль | [src/account-profile.js](../src/account-profile.js) |
| `responsive-sticky` · Адаптация, sticky-footer, safe-area и фокус | R01, R10 | Проверить 360–1440, обе темы, низ sheet и незакрытый фокус/CTA; затем zoom/клавиатуру ОС. | Все восемь групп | [src/visual-system.css](../src/visual-system.css) |
| `external-copy` · Копирование и переход во внешнюю карту | R09, R11 | Ясный внешний переход и результат копирования; ошибка clipboard не success. | Рабочий сценарий | [src/app.js](../src/app.js) |
| `floating-action` · Существующая FAB «Создать точку» на карте | R10 | Скрывать недоступную FAB, поднять над нижними контролами; одна главная команда режима. | Карта | [index.html](../index.html) |

## Исправлено после просмотра скриншотов Chromium

На 360 px дата в общей строке с двумя стрелками получалась слишком мелкой: в предложении диапазон теперь занимает свою полную строку, навигация — следующую. Соседние Save/Cancel на узком экране стали двумя одинаковыми полноширинными строками вместо разной высоты из-за переноса подписи. Desktop popover инженеров получил прозрачный backdrop без размытия фона; мобильный modal sheet сохраняет затемнение. Статус операции отделён от кнопки отступом 16 px. Undo объявляется без автоматического переноса фокуса.

## Реализация и внедрение

Изолированные файлы прототипа: [design-system-guidance.js](../src/ui/design-system-guidance.js), [design-system-guidance.css](../src/ui/design-system-guidance.css). Они используют существующие theme roles, production-утилиты периода, `TRACK_STYLE` и контроллер вкладок. Новые примеры не импортируются в production-приложение. Сначала согласовывается поведение и форма в ките, затем компоненты извлекаются в общую библиотеку и подключаются к одному целому сценарию. Не заменять все локальные стили глобальным селектором.

```css
/* Пример выбранной веб-политики, не пересчёт dp/pt. */
[data-touch-preview=true] .control { min-block-size:48px; }
.connected { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(0,1fr); }
/* Цвет счётчика определяется смыслом, не состоянием внешнего chip. */
.count[data-tone=danger] { color:var(--red); background:var(--danger-bg); }
```

```js
// Необратимое действие не назначается default через submit/Enter.
trigger.onclick=()=>{ dialog.showModal(); title.focus(); };
cancel.onclick=()=>dialog.close();
dialog.addEventListener('close',()=>trigger.focus());
// Реальный запрос запускает только явная команда подтверждения.
```

## Проверка и оставшиеся границы

Автоматизация: `npx playwright test tests/visual/design-system-catalogue.spec.mjs tests/visual/material-hig-review.spec.mjs --retries=0`. Базовые 60 проверок плюс 90 новых случаев: 9 сценариев × 5 ширин × 2 темы. Новая проверка снимает восемь панелей и Expressive-вариант, а также date editor, picker и map sheet; проверяет цель 48 px, ширины, клавиатуру, ошибку и повтор, фокус, черновик дат, поиск/снятие выбора, exact slider, Undo, отсутствие default-delete и скрытие FAB.

Сборка и lint проверяются отдельно. Скриншоты и журнал Chromium публикуются как Actions artifact `design-system-catalogue-*`. Результат прогона нужно смотреть у конкретного PR/коммита; сам перечень проверок не является доказательством прохождения.

Дальше для production: экранная клавиатура и увеличение текста на реальных устройствах, VoiceOver/TalkBack, 200% zoom, большие списки/длинные имена, backdrop/фокус при вложенных редакторах, сетевые ошибки и права реальных ролей. Это не выполненный usability/A/B-тест. Карта в ките — схема компоновки, не тест GPS/Leaflet. 58 контрактов не объявляются 58 готовыми унифицированными компонентами.
