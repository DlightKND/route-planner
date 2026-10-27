# Аудит покрытия дизайн-паттернов DLIGHT

Дата исходного инвентаря: 2026-10-24. База инвентаря: `c3fee9258779de525477fa7f17350164483ece4f`. Текущий production-контракт: 0.7; каталог: 0.6.

**Нет, версия 0.2 учитывала не все паттерны.** В реестре 58 семейств. Покрытие спецификации 0.2: полное — 20; частичное — 17; пропуски — 21. Семейств с примерами в каталоге: 58; без отдельного образца: 0.

В 0.3 для всех найденных семейств указан контракт. Это полнота описания относительно данного инвентаря, а не готовая интеграция компонентов во всех рабочих экранах. Отметка «Есть» подтверждает наличие образца в исходниках каталога; сама по себе не означает, что все состояния компонента протестированы. В 0.7 общие токены и финальный слой внешнего вида применяются ко всем существующим рабочим контролам, включая динамические окна. Охват и проверки production описаны в [правилах внедрения](design-system-production.md). Историческая оценка 0.2 ниже не является показателем текущего переноса.

## Как проверено

Просканированы 77 файлов: index.html и production-модули src/**/*.js, кроме демонстрационных модулей каталога (design-system-preview.js, design-system-controls.js, design-system-guidance.js и design-system-comparison.js). Новые компоненты src/ui в сканирование включаются. Собраны явные input types и значения DOM .type (включая button), роли в HTML/JS и роли через setAttribute; затем вручную сопоставлены маршруты, обработчики pointer/keyboard, сохранение, медиа, карта, график, уведомления и offline-очередь с пользовательскими задачами. Для каждой строки проверено существование конкретного маркера в исходном файле. Указатели строк рассчитаны автоматически.

Сканирование не исполняет интерфейс и не понимает произвольную генерацию HTML/ARIA через переменные. Оно не может автоматически обнаружить новый пользовательский сценарий из того же button. Новые режимы, права, сторонние Leaflet-контролы и touch/assistive-tech требуют ручного просмотра. Скриншоты каталога 0.2 и его 60 Chromium-проверок не являются проверкой всех этих семейств на рабочих экранах. В 0.7 отдельные production-проверки измеряют реальные элементы в разделах и окнах; статический реестр дополняет эти проверки.

## Что было описано неверно

1. **Engineer picker** сейчас является popover/dialog с checkbox поверх native select[multiple]. В 0.7 добавлены поиск и внутренний счётчик; выбор по-прежнему выполняется native checkbox и сохраняется в исходном select[multiple]. ARIA combobox/listbox не добавлен, поскольку это другая модель клавиатуры.
2. **FAB уже существует на карте** — «Создать точку», pointToolsFab. Исправлен общий тезис «FAB не вводим»: нужна спецификация существующей кнопки, её позиции над шторкой и конкуренции с основным действием режима.
3. **Описание не равно готовому UI-киту.** Раньше таблица готовности не охватывала загрузку фото, sliders, офлайн, навигацию и сложные манипуляции графика. Теперь эти семейства перечислены явно, с источниками и отдельной отметкой образца.

## Реестр

«0.2» — оценка спецификации до этой проверки. «Частично» включает общие упоминания без отдельного контракта и неточную классификацию. «Пример» — наличие в текущем каталоге 0.6, включая обзорные прототипы; не все состояния. P0 означает риск потери/неверного подтверждения данных, блокировки навигации или недоступной операции; P1 — остальные семейства. Текущее правило находится по ссылке «Контракт».

| ID | Паттерн | Спецификация 0.2 | Пример 0.6 | Приоритет | Источник | Правило 0.3 |
| --- | --- | --- | --- | --- | --- | --- |
| action-button | Кнопка: primary / secondary / tertiary / destructive | Описан | Есть | P1 | [src/entity-actions.js:27](../src/entity-actions.js#L27) | [Контракт](design-system.md#button--iconbutton--link) |
| icon-button | Кнопка с иконкой и доступным именем | Описан | Есть | P1 | [src/journal-route.js:31](../src/journal-route.js#L31) | [Контракт](design-system.md#button--iconbutton--link) |
| navigation-link | Ссылка, переход и browser back | Описан | Есть | P1 | [src/app.js:781](../src/app.js#L781) | [Контракт](design-system.md#button--iconbutton--link) |
| status-badge | Неинтерактивный статус | Описан | Есть | P1 | [src/presence-decision.js:18](../src/presence-decision.js#L18) | [Контракт](design-system.md#badge--filterchip--selectionchip) |
| count-badge | Вложенный счётчик: смысл / 0 / неизвестно | Описан | Есть | P1 | [src/unified-journal.css:400](../src/unified-journal.css#L400) | [Контракт](design-system.md#countbadge-вложенная-мини-пилюля-из-журнала) |
| filter-chip | Фильтры: один или несколько, сброс | Описан | Есть | P1 | [src/unassigned-tracks.js:46](../src/unassigned-tracks.js#L46) | [Контракт](design-system.md#badge--filterchip--selectionchip) |
| view-segment | Сегментированный выбор представления | Описан | Есть | P1 | [src/app.js:3634](../src/app.js#L3634) | [Контракт](design-system.md#segmentedcontrol-переключатели-со-сводки) |
| decision-radio | Radio / взаимоисключающий выбор в черновике | Описан | Есть | P1 | [src/app.js:6098](../src/app.js#L6098) | [Контракт](design-system.md#select--combobox--checkbox--radio--switch--tabs) |
| checkbox-group | Один checkbox и множественный выбор | Описан | Есть | P1 | [src/engineer-picker.js:33](../src/engineer-picker.js#L33) | [Контракт](design-system.md#select--combobox--checkbox--radio--switch--tabs) |
| boolean-switch | Немедленная настройка Вкл / Выкл | Описан | Есть | P1 | [src/app.js:7972](../src/app.js#L7972) | [Контракт](design-system.md#select--combobox--checkbox--radio--switch--tabs) |
| native-select | Одиночный выбор из списка | Описан | Есть | P1 | [index.html:2543](../index.html#L2543) | [Контракт](design-system.md#select--combobox--checkbox--radio--switch--tabs) |
| multi-select-popover | Выбор инженеров: popover с checkbox, без поиска | Частично | Есть | P1 | [src/engineer-picker.js:26](../src/engineer-picker.js#L26) | [Контракт](design-system.md#pattern-selection) |
| search-field | Поиск списка: debounce / clear / пусто / ошибка | Пропуск | Есть | P1 | [src/notifications.js:68](../src/notifications.js#L68) | [Контракт](design-system.md#pattern-selection) |
| search-result-picker | Адресный поиск и выбор результата | Частично | Есть | P1 | [src/app.js:1753](../src/app.js#L1753) | [Контракт](design-system.md#pattern-selection) |
| text-field | Текст / email / телефон / textarea | Описан | Есть | P1 | [index.html:3055](../index.html#L3055) | [Контракт](design-system.md#field--textarea--number--date) |
| number-unit | Количество / деньги / длительность / доля | Частично | Есть | P1 | [src/service-orders.js:227](../src/service-orders.js#L227) | [Контракт](design-system.md#pattern-inputs) |
| date-field | Дата, время, дата со временем, месяц | Описан | Есть | P1 | [src/app.js:281](../src/app.js#L281) | [Контракт](design-system.md#семейство-datecontrol-не-один-универсальный-календарь) |
| date-range | Диапазон дат в черновике | Описан | Есть | P1 | [src/app.js:3283](../src/app.js#L3283) | [Контракт](design-system.md#семейство-datecontrol-не-один-универсальный-календарь) |
| period-navigator | Пресеты, стрелки и календарный период | Описан | Есть | P1 | [src/app.js:3281](../src/app.js#L3281) | [Контракт](design-system.md#семейство-datecontrol-не-один-универсальный-календарь) |
| month-navigator | Месяц журнала и выбор произвольных дат | Описан | Есть | P1 | [src/app.js:3312](../src/app.js#L3312) | [Контракт](design-system.md#семейство-datecontrol-не-один-универсальный-календарь) |
| range-slider | Слайдер расстояния / времени / разрыва | Пропуск | Есть | P0 | [index.html:2451](../index.html#L2451) | [Контракт](design-system.md#pattern-inputs) |
| color-picker | Цвет объекта карты с подписью | Пропуск | Есть | P1 | [index.html:3057](../index.html#L3057) | [Контракт](design-system.md#pattern-inputs) |
| photo-upload | Файлы / фото: выбор, очередь, повтор | Пропуск | Есть | P0 | [src/app.js:4668](../src/app.js#L4668) | [Контракт](design-system.md#pattern-media) |
| image-viewer | Просмотр фото и выход из него | Пропуск | Есть | P1 | [src/app.js:3793](../src/app.js#L3793) | [Контракт](design-system.md#pattern-media) |
| application-navigation | Rail / нижняя навигация / Ещё | Частично | Есть | P1 | [index.html:2319](../index.html#L2319) | [Контракт](design-system.md#pattern-navigation) |
| entity-tabs | Вкладки записи с сохранением состояния панелей | Описан | Есть | P1 | [src/entity-tabs.js:3](../src/entity-tabs.js#L3) | [Контракт](design-system.md#select--combobox--checkbox--radio--switch--tabs) |
| record-card | Карточка, строка списка, доска состояний | Частично | Есть | P1 | [src/service-orders.js:66](../src/service-orders.js#L66) | [Контракт](design-system.md#pattern-data) |
| grouped-list | Группированный справочник, раскрытие уровней | Пропуск | Есть | P1 | [src/app.js:1610](../src/app.js#L1610) | [Контракт](design-system.md#pattern-data) |
| disclosure | Свёрнутый блок / details / accordion | Частично | Есть | P1 | [src/journal-route.js:15](../src/journal-route.js#L15) | [Контракт](design-system.md#pattern-layers) |
| help-popover | Пояснение по нажатию с keyboard-доступом | Пропуск | Есть | P1 | [src/info-hints.js:8](../src/info-hints.js#L8) | [Контракт](design-system.md#pattern-layers) |
| context-panel | Немодальный контекстный popover | Частично | Есть | P1 | [src/context-panels.js:3](../src/context-panels.js#L3) | [Контракт](design-system.md#pattern-layers) |
| modal-editor | Модальный редактор / подтверждение | Описан | Есть | P1 | [src/modal-shell.js:75](../src/modal-shell.js#L75) | [Контракт](design-system.md#menu--dialog--feedback) |
| bottom-sheet | Шторка карты и положения раскрытия | Пропуск | Есть | P0 | [src/app.js:593](../src/app.js#L593) | [Контракт](design-system.md#pattern-layers) |
| action-menu | Другие действия: disclosure / menu / dialog | Описан | Есть | P1 | [src/entity-actions.js:5](../src/entity-actions.js#L5) | [Контракт](design-system.md#menu--dialog--feedback) |
| editable-items | Повторяемые строки работ / материалов | Пропуск | Есть | P0 | [src/service-orders.js:227](../src/service-orders.js#L227) | [Контракт](design-system.md#pattern-workflows) |
| bulk-selection | Массовый выбор и preview объединения | Пропуск | Есть | P0 | [src/unassigned-tracks.js:97](../src/unassigned-tracks.js#L97) | [Контракт](design-system.md#pattern-workflows) |
| reorder | Перестановка маршрута / карточек / панелей | Пропуск | Есть | P0 | [src/app.js:8072](../src/app.js#L8072) | [Контракт](design-system.md#pattern-workflows) |
| schedule-manipulation | Перенос / изменение / разделение графика | Пропуск | Есть | P0 | [src/schedule-interactions.js:2](../src/schedule-interactions.js#L2) | [Контракт](design-system.md#pattern-workflows) |
| map-explorer | Карта / миникарта / маркеры / список | Частично | Есть | P1 | [src/gps-track-map.js:12](../src/gps-track-map.js#L12) | [Контракт](design-system.md#pattern-data) |
| gps-evidence | Измерение / восстановление / принятое решение | Частично | Есть | P0 | [src/presence-review-controls.js:36](../src/presence-review-controls.js#L36) | [Контракт](design-system.md#pattern-data) |
| allocation-editor | Распределение времени / пробега и остаток | Частично | Есть | P0 | [src/presence-review-controls.js:18](../src/presence-review-controls.js#L18) | [Контракт](design-system.md#pattern-workflows) |
| charts-tables | Сопоставимые диаграммы и таблицы | Пропуск | Есть | P1 | [src/dashboard-visuals.js:7](../src/dashboard-visuals.js#L7) | [Контракт](design-system.md#pattern-data) |
| activity-comments | Лента, комментарии, закрепление, доказательства | Пропуск | Есть | P1 | [src/entity-activity.js:54](../src/entity-activity.js#L54) | [Контракт](design-system.md#pattern-data) |
| notifications-inbox | Входящие: прочитано / действия / счётчик | Пропуск | Есть | P1 | [src/notifications.js:56](../src/notifications.js#L56) | [Контракт](design-system.md#pattern-feedback) |
| load-more | Догрузка списка без потери выбора и фокуса | Пропуск | Есть | P1 | [src/notifications.js:56](../src/notifications.js#L56) | [Контракт](design-system.md#pattern-data) |
| push-permission | Push: устройство, разрешение, отказ, timeout | Пропуск | Есть | P1 | [src/app.js:6430](../src/app.js#L6430) | [Контракт](design-system.md#pattern-session) |
| feedback | Toast / постоянный banner / inline error | Описан | Есть | P1 | [src/app.js:255](../src/app.js#L255) | [Контракт](design-system.md#menu--dialog--feedback) |
| loading-progress | Ожидание и прогресс длительной операции | Частично | Есть | P1 | [src/app.js:247](../src/app.js#L247) | [Контракт](design-system.md#pattern-feedback) |
| draft-guard | Несохранённый черновик и связанное действие | Частично | Есть | P0 | [src/entity-draft-resolution.js:2](../src/entity-draft-resolution.js#L2) | [Контракт](design-system.md#pattern-recovery) |
| revision-conflict | Конфликт версии после создания черновика | Пропуск | Есть | P0 | [src/service-orders.js:185](../src/service-orders.js#L185) | [Контракт](design-system.md#pattern-recovery) |
| offline-sync | Локальная очередь / серверная запись / блокировка | Пропуск | Есть | P0 | [src/app.js:4275](../src/app.js#L4275) | [Контракт](design-system.md#pattern-recovery) |
| trash-restore | Корзина: восстановление и удаление навсегда | Частично | Есть | P0 | [src/app.js:1913](../src/app.js#L1913) | [Контракт](design-system.md#pattern-recovery) |
| role-authority | Просмотр, кураторство, передача ответственности | Частично | Есть | P0 | [src/entity-responsibility.js:23](../src/entity-responsibility.js#L23) | [Контракт](design-system.md#pattern-session) |
| auth-session | Вход, потеря сессии и выход | Пропуск | Есть | P0 | [src/app.js:979](../src/app.js#L979) | [Контракт](design-system.md#pattern-session) |
| profile-preferences | Аватар / профиль / preview и сохранение темы | Частично | Есть | P1 | [src/account-profile.js:4](../src/account-profile.js#L4) | [Контракт](design-system.md#pattern-session) |
| responsive-sticky | Адаптация, sticky-footer, safe-area и фокус | Частично | Есть | P1 | [src/visual-system.css:4](../src/visual-system.css#L4) | [Контракт](design-system.md#pattern-navigation) |
| external-copy | Копирование и переход во внешнюю карту | Пропуск | Есть | P1 | [src/app.js:6195](../src/app.js#L6195) | [Контракт](design-system.md#pattern-feedback) |
| floating-action | Существующая FAB «Создать точку» на карте | Частично | Есть | P0 | [index.html:2483](../index.html#L2483) | [Контракт](design-system.md#pattern-navigation) |

## Контроли, которые не следует выдавать за найденные

- Полноценный поисковый combobox для инженеров: не обнаружен в текущем picker. Не добавлять ARIA-роль без реализации поведения.
- Пагинация с номерами страниц: в проверенных очередях используется «Показать ещё». Номера страниц и виртуальный grid не нужны только ради полноты каталога.
- Отдельный wizard/stepper, command palette, rich-text editor, tabular sort header и импорт/экспорт файлов: самостоятельные пользовательские реализации не подтверждены. Наличие библиотечного import/export, внутреннего sort() или Blob не является таким UI.
- Removable SelectionChip, кастомная сетка календаря и компонент ARIA tree: имеются возможные контракты/родственные элементы, но это не доказательство самостоятельного существующего компонента. Создавать только под проверенный сценарий.

## Проверка завершённости пилота

Для выбранной рабочей области нужны: роль и права; источник/черновик/момент записи; default/hover/pressed/focus/disabled/pending/error/readonly; пустое и неизвестное; keyboard/touch; обе темы; 360–1440 px и zoom; сохранение, отмена, повтор, потеря связи/сессии, конфликт версии; одна главная команда. Проверять ещё и вложенные случаи: picker внутри modal, popover возле sticky-footer, диапазон дат на телефоне, счётчик в выбранном сегменте.

В 0.5 для всех 58 семейств добавлены парные схематические примеры, реальные замеры браузера и общие состояния; дополнительно 8 разделов визуальной основы. Рекомендации и ID связаны проверяемым реестром design-review-examples.json. Проверка Material/HIG: [предложения](material-hig-review.md); [геометрия 0.5](design-system-geometry.md). Не помечать семейство «унифицировано» до проверки реального сценария роли.

## Повторяемая проверка

Команда: `npm run qa:design-patterns`. Для обновления только рассчитанного отчёта: `node scripts/audit-design-patterns.mjs --write`. Источник реестра: [design-patterns.json](design-patterns.json). Проверка замечает потерянные маркеры, отсутствующие якоря, несовпадение отчёта и новые явные типы/роли без классификации; семантическую полноту подтверждает ревью сценариев.

### Типы input и программно заданные .type

- `button` → `action-button` (14 файлов)
- `checkbox` → `checkbox-group` (9 файлов)
- `color` → `color-picker` (1 файл)
- `date` → `date-field` (4 файла)
- `email` → `text-field` (1 файл)
- `file` → `photo-upload` (1 файл)
- `number` → `number-unit` (6 файлов)
- `password` → `auth-session` (1 файл)
- `radio` → `decision-radio` (2 файла)
- `range` → `range-slider` (3 файла)
- `search` → `search-field` (6 файлов)
- `tel` → `text-field` (1 файл)
- `text` → `text-field` (3 файла)
- `time` → `date-field` (2 файла)

### Явные ARIA-роли

- `alert` → `feedback` (8 файлов)
- `button` → `action-button` (2 файла)
- `dialog` → `modal-editor`, `context-panel`, `multi-select-popover` (5 файлов)
- `group` → `view-segment`, `checkbox-group`, `filter-chip` (7 файлов)
- `img` → `map-explorer`, `charts-tables` (3 файла)
- `note` → `feedback` (1 файл)
- `region` → `map-explorer`, `record-card` (5 файлов)
- `slider` → `range-slider` (2 файла)
- `status` → `feedback` (15 файлов)
- `tab` → `entity-tabs` (3 файла)
- `tablist` → `entity-tabs` (3 файла)
- `tabpanel` → `entity-tabs` (3 файла)

Связь type/role с ID классифицирует сигнал, а не автоматически распознаёт смысл каждого его вхождения.

Хеш проверенных production-исходников: `b247660ee9b8043b5ce8c94ae1da1008e1cab04cae80bf43fb8a54c307c6b357`. CSS проверен адресно в качестве источника оформления (например, journal count и FAB), не включён в этот JS/HTML-хеш.
