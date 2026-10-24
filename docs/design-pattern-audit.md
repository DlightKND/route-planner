# Аудит покрытия дизайн-паттернов DLIGHT

Дата: 2026-10-24. База кода: `c3fee9258779de525477fa7f17350164483ece4f`. Спецификация: 0.3; каталог: 0.6.

**Нет, версия 0.2 учитывала не все паттерны.** В реестре 58 семейств. Покрытие спецификации 0.2: полное — 20; частичное — 17; пропуски — 21. Семейств с примерами в каталоге: 58; без отдельного образца: 0.

В 0.3 для всех найденных семейств указан контракт. Это полнота описания относительно данного инвентаря, а не готовая интеграция компонентов во всех рабочих экранах. Отметка «Есть» подтверждает наличие образца в исходниках каталога; сама по себе не означает, что все состояния компонента протестированы. Все рабочие реализации пока локальные; их соответствие новому контракту требует пилота.

## Как проверено

Просканированы 67 файлов: index.html и production-модули src/**/*.js, кроме демонстрационных модулей каталога (design-system-preview.js, design-system-controls.js, design-system-guidance.js и design-system-comparison.js). Новые компоненты src/ui в сканирование включаются. Собраны явные input types и значения DOM .type (включая button), роли в HTML/JS и роли через setAttribute; затем вручную сопоставлены маршруты, обработчики pointer/keyboard, сохранение, медиа, карта, график, уведомления и offline-очередь с пользовательскими задачами. Для каждой строки проверено существование конкретного маркера в исходном файле. Указатели строк рассчитаны автоматически.

Сканирование не исполняет интерфейс и не понимает произвольную генерацию HTML/ARIA через переменные. Оно не может автоматически обнаружить новый пользовательский сценарий из того же button. Новые режимы, права, сторонние Leaflet-контролы и touch/assistive-tech требуют ручного просмотра. Скриншоты каталога 0.2 и его 60 Chromium-проверок не являются проверкой всех этих семейств на рабочих экранах.

## Что было описано неверно

1. **Engineer picker** сейчас является popover/dialog с checkbox поверх native select[multiple]. Поиска и combobox/listbox-клавиатуры в нём нет. Исправлено описание текущего состояния; searchable combobox оставлен будущим вариантом, а не существующей реализацией.
2. **FAB уже существует на карте** — «Создать точку», pointToolsFab. Исправлен общий тезис «FAB не вводим»: нужна спецификация существующей кнопки, её позиции над шторкой и конкуренции с основным действием режима.
3. **Описание не равно готовому UI-киту.** Раньше таблица готовности не охватывала загрузку фото, sliders, офлайн, навигацию и сложные манипуляции графика. Теперь эти семейства перечислены явно, с источниками и отдельной отметкой образца.

## Реестр

«0.2» — оценка спецификации до этой проверки. «Частично» включает общие упоминания без отдельного контракта и неточную классификацию. «Пример» — наличие в текущем каталоге 0.6, включая обзорные прототипы; не все состояния. P0 означает риск потери/неверного подтверждения данных, блокировки навигации или недоступной операции; P1 — остальные семейства. Текущее правило находится по ссылке «Контракт».

| ID | Паттерн | Спецификация 0.2 | Пример 0.6 | Приоритет | Источник | Правило 0.3 |
| --- | --- | --- | --- | --- | --- | --- |
| action-button | Кнопка: primary / secondary / tertiary / destructive | Описан | Есть | P1 | [src/entity-actions.js:26](../src/entity-actions.js#L26) | [Контракт](design-system.md#button--iconbutton--link) |
| icon-button | Кнопка с иконкой и доступным именем | Описан | Есть | P1 | [src/journal-route.js:30](../src/journal-route.js#L30) | [Контракт](design-system.md#button--iconbutton--link) |
| navigation-link | Ссылка, переход и browser back | Описан | Есть | P1 | [src/app.js:788](../src/app.js#L788) | [Контракт](design-system.md#button--iconbutton--link) |
| status-badge | Неинтерактивный статус | Описан | Есть | P1 | [src/presence-decision.js:18](../src/presence-decision.js#L18) | [Контракт](design-system.md#badge--filterchip--selectionchip) |
| count-badge | Вложенный счётчик: смысл / 0 / неизвестно | Описан | Есть | P1 | [src/unified-journal.css:400](../src/unified-journal.css#L400) | [Контракт](design-system.md#countbadge-вложенная-мини-пилюля-из-журнала) |
| filter-chip | Фильтры: один или несколько, сброс | Описан | Есть | P1 | [src/unassigned-tracks.js:44](../src/unassigned-tracks.js#L44) | [Контракт](design-system.md#badge--filterchip--selectionchip) |
| view-segment | Сегментированный выбор представления | Описан | Есть | P1 | [src/app.js:3638](../src/app.js#L3638) | [Контракт](design-system.md#segmentedcontrol-переключатели-со-сводки) |
| decision-radio | Radio / взаимоисключающий выбор в черновике | Описан | Есть | P1 | [src/app.js:6101](../src/app.js#L6101) | [Контракт](design-system.md#select--combobox--checkbox--radio--switch--tabs) |
| checkbox-group | Один checkbox и множественный выбор | Описан | Есть | P1 | [src/engineer-picker.js:32](../src/engineer-picker.js#L32) | [Контракт](design-system.md#select--combobox--checkbox--radio--switch--tabs) |
| boolean-switch | Немедленная настройка Вкл / Выкл | Описан | Есть | P1 | [src/app.js:7975](../src/app.js#L7975) | [Контракт](design-system.md#select--combobox--checkbox--radio--switch--tabs) |
| native-select | Одиночный выбор из списка | Описан | Есть | P1 | [index.html:2543](../index.html#L2543) | [Контракт](design-system.md#select--combobox--checkbox--radio--switch--tabs) |
| multi-select-popover | Выбор инженеров: popover с checkbox, без поиска | Частично | Есть | P1 | [src/engineer-picker.js:26](../src/engineer-picker.js#L26) | [Контракт](design-system.md#pattern-selection) |
| search-field | Поиск списка: debounce / clear / пусто / ошибка | Пропуск | Есть | P1 | [src/notifications.js:68](../src/notifications.js#L68) | [Контракт](design-system.md#pattern-selection) |
| search-result-picker | Адресный поиск и выбор результата | Частично | Есть | P1 | [src/app.js:1757](../src/app.js#L1757) | [Контракт](design-system.md#pattern-selection) |
| text-field | Текст / email / телефон / textarea | Описан | Есть | P1 | [index.html:3055](../index.html#L3055) | [Контракт](design-system.md#field--textarea--number--date) |
| number-unit | Количество / деньги / длительность / доля | Частично | Есть | P1 | [src/service-orders.js:226](../src/service-orders.js#L226) | [Контракт](design-system.md#pattern-inputs) |
| date-field | Дата, время, дата со временем, месяц | Описан | Есть | P1 | [src/app.js:262](../src/app.js#L262) | [Контракт](design-system.md#семейство-datecontrol-не-один-универсальный-календарь) |
| date-range | Диапазон дат в черновике | Описан | Есть | P1 | [src/app.js:3287](../src/app.js#L3287) | [Контракт](design-system.md#семейство-datecontrol-не-один-универсальный-календарь) |
| period-navigator | Пресеты, стрелки и календарный период | Описан | Есть | P1 | [src/app.js:3285](../src/app.js#L3285) | [Контракт](design-system.md#семейство-datecontrol-не-один-универсальный-календарь) |
| month-navigator | Месяц журнала и выбор произвольных дат | Описан | Есть | P1 | [src/app.js:3316](../src/app.js#L3316) | [Контракт](design-system.md#семейство-datecontrol-не-один-универсальный-календарь) |
| range-slider | Слайдер расстояния / времени / разрыва | Пропуск | Есть | P0 | [index.html:2451](../index.html#L2451) | [Контракт](design-system.md#pattern-inputs) |
| color-picker | Цвет объекта карты с подписью | Пропуск | Есть | P1 | [index.html:3057](../index.html#L3057) | [Контракт](design-system.md#pattern-inputs) |
| photo-upload | Файлы / фото: выбор, очередь, повтор | Пропуск | Есть | P0 | [src/app.js:4671](../src/app.js#L4671) | [Контракт](design-system.md#pattern-media) |
| image-viewer | Просмотр фото и выход из него | Пропуск | Есть | P1 | [src/app.js:3797](../src/app.js#L3797) | [Контракт](design-system.md#pattern-media) |
| application-navigation | Rail / нижняя навигация / Ещё | Частично | Есть | P1 | [index.html:2320](../index.html#L2320) | [Контракт](design-system.md#pattern-navigation) |
| entity-tabs | Вкладки записи с сохранением состояния панелей | Описан | Есть | P1 | [src/entity-tabs.js:3](../src/entity-tabs.js#L3) | [Контракт](design-system.md#select--combobox--checkbox--radio--switch--tabs) |
| record-card | Карточка, строка списка, доска состояний | Частично | Есть | P1 | [src/service-orders.js:65](../src/service-orders.js#L65) | [Контракт](design-system.md#pattern-data) |
| grouped-list | Группированный справочник, раскрытие уровней | Пропуск | Есть | P1 | [src/app.js:1614](../src/app.js#L1614) | [Контракт](design-system.md#pattern-data) |
| disclosure | Свёрнутый блок / details / accordion | Частично | Есть | P1 | [src/journal-route.js:14](../src/journal-route.js#L14) | [Контракт](design-system.md#pattern-layers) |
| help-popover | Пояснение по нажатию с keyboard-доступом | Пропуск | Есть | P1 | [src/info-hints.js:8](../src/info-hints.js#L8) | [Контракт](design-system.md#pattern-layers) |
| context-panel | Немодальный контекстный popover | Частично | Есть | P1 | [src/context-panels.js:3](../src/context-panels.js#L3) | [Контракт](design-system.md#pattern-layers) |
| modal-editor | Модальный редактор / подтверждение | Описан | Есть | P1 | [src/modal-shell.js:75](../src/modal-shell.js#L75) | [Контракт](design-system.md#menu--dialog--feedback) |
| bottom-sheet | Шторка карты и положения раскрытия | Пропуск | Есть | P0 | [src/app.js:574](../src/app.js#L574) | [Контракт](design-system.md#pattern-layers) |
| action-menu | Другие действия: disclosure / menu / dialog | Описан | Есть | P1 | [src/entity-actions.js:4](../src/entity-actions.js#L4) | [Контракт](design-system.md#menu--dialog--feedback) |
| editable-items | Повторяемые строки работ / материалов | Пропуск | Есть | P0 | [src/service-orders.js:226](../src/service-orders.js#L226) | [Контракт](design-system.md#pattern-workflows) |
| bulk-selection | Массовый выбор и preview объединения | Пропуск | Есть | P0 | [src/unassigned-tracks.js:93](../src/unassigned-tracks.js#L93) | [Контракт](design-system.md#pattern-workflows) |
| reorder | Перестановка маршрута / карточек / панелей | Пропуск | Есть | P0 | [src/app.js:8075](../src/app.js#L8075) | [Контракт](design-system.md#pattern-workflows) |
| schedule-manipulation | Перенос / изменение / разделение графика | Пропуск | Есть | P0 | [src/schedule-interactions.js:2](../src/schedule-interactions.js#L2) | [Контракт](design-system.md#pattern-workflows) |
| map-explorer | Карта / миникарта / маркеры / список | Частично | Есть | P1 | [src/gps-track-map.js:12](../src/gps-track-map.js#L12) | [Контракт](design-system.md#pattern-data) |
| gps-evidence | Измерение / восстановление / принятое решение | Частично | Есть | P0 | [src/presence-review-controls.js:36](../src/presence-review-controls.js#L36) | [Контракт](design-system.md#pattern-data) |
| allocation-editor | Распределение времени / пробега и остаток | Частично | Есть | P0 | [src/presence-review-controls.js:18](../src/presence-review-controls.js#L18) | [Контракт](design-system.md#pattern-workflows) |
| charts-tables | Сопоставимые диаграммы и таблицы | Пропуск | Есть | P1 | [src/dashboard-visuals.js:7](../src/dashboard-visuals.js#L7) | [Контракт](design-system.md#pattern-data) |
| activity-comments | Лента, комментарии, закрепление, доказательства | Пропуск | Есть | P1 | [src/entity-activity.js:53](../src/entity-activity.js#L53) | [Контракт](design-system.md#pattern-data) |
| notifications-inbox | Входящие: прочитано / действия / счётчик | Пропуск | Есть | P1 | [src/notifications.js:56](../src/notifications.js#L56) | [Контракт](design-system.md#pattern-feedback) |
| load-more | Догрузка списка без потери выбора и фокуса | Пропуск | Есть | P1 | [src/notifications.js:56](../src/notifications.js#L56) | [Контракт](design-system.md#pattern-data) |
| push-permission | Push: устройство, разрешение, отказ, timeout | Пропуск | Есть | P1 | [src/app.js:6433](../src/app.js#L6433) | [Контракт](design-system.md#pattern-session) |
| feedback | Toast / постоянный banner / inline error | Описан | Есть | P1 | [src/app.js:236](../src/app.js#L236) | [Контракт](design-system.md#menu--dialog--feedback) |
| loading-progress | Ожидание и прогресс длительной операции | Частично | Есть | P1 | [src/app.js:228](../src/app.js#L228) | [Контракт](design-system.md#pattern-feedback) |
| draft-guard | Несохранённый черновик и связанное действие | Частично | Есть | P0 | [src/entity-draft-resolution.js:2](../src/entity-draft-resolution.js#L2) | [Контракт](design-system.md#pattern-recovery) |
| revision-conflict | Конфликт версии после создания черновика | Пропуск | Есть | P0 | [src/service-orders.js:184](../src/service-orders.js#L184) | [Контракт](design-system.md#pattern-recovery) |
| offline-sync | Локальная очередь / серверная запись / блокировка | Пропуск | Есть | P0 | [src/app.js:4278](../src/app.js#L4278) | [Контракт](design-system.md#pattern-recovery) |
| trash-restore | Корзина: восстановление и удаление навсегда | Частично | Есть | P0 | [src/app.js:1917](../src/app.js#L1917) | [Контракт](design-system.md#pattern-recovery) |
| role-authority | Просмотр, кураторство, передача ответственности | Частично | Есть | P0 | [src/entity-responsibility.js:23](../src/entity-responsibility.js#L23) | [Контракт](design-system.md#pattern-session) |
| auth-session | Вход, потеря сессии и выход | Пропуск | Есть | P0 | [src/app.js:983](../src/app.js#L983) | [Контракт](design-system.md#pattern-session) |
| profile-preferences | Аватар / профиль / preview и сохранение темы | Частично | Есть | P1 | [src/account-profile.js:4](../src/account-profile.js#L4) | [Контракт](design-system.md#pattern-session) |
| responsive-sticky | Адаптация, sticky-footer, safe-area и фокус | Частично | Есть | P1 | [src/visual-system.css:4](../src/visual-system.css#L4) | [Контракт](design-system.md#pattern-navigation) |
| external-copy | Копирование и переход во внешнюю карту | Пропуск | Есть | P1 | [src/app.js:6198](../src/app.js#L6198) | [Контракт](design-system.md#pattern-feedback) |
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

- `button` → `action-button` (11 файлов)
- `checkbox` → `checkbox-group` (7 файлов)
- `color` → `color-picker` (1 файл)
- `date` → `date-field` (3 файла)
- `email` → `text-field` (1 файл)
- `file` → `photo-upload` (1 файл)
- `number` → `number-unit` (4 файла)
- `password` → `auth-session` (1 файл)
- `radio` → `decision-radio` (1 файл)
- `range` → `range-slider` (1 файл)
- `search` → `search-field` (4 файла)
- `tel` → `text-field` (1 файл)
- `text` → `text-field` (3 файла)
- `time` → `date-field` (1 файл)

### Явные ARIA-роли

- `alert` → `feedback` (7 файлов)
- `button` → `action-button` (2 файла)
- `dialog` → `modal-editor`, `context-panel`, `multi-select-popover` (4 файла)
- `group` → `view-segment`, `checkbox-group`, `filter-chip` (5 файлов)
- `img` → `map-explorer`, `charts-tables` (3 файла)
- `note` → `feedback` (1 файл)
- `region` → `map-explorer`, `record-card` (4 файла)
- `slider` → `range-slider` (1 файл)
- `status` → `feedback` (13 файлов)
- `tab` → `entity-tabs` (2 файла)
- `tablist` → `entity-tabs` (2 файла)
- `tabpanel` → `entity-tabs` (2 файла)

Связь type/role с ID классифицирует сигнал, а не автоматически распознаёт смысл каждого его вхождения.

Хеш проверенных production-исходников: `f7399236bcfa7efacad6a183e027a52b6f42aa9275305d7634b906f42c13d61f`. CSS проверен адресно в качестве источника оформления (например, journal count и FAB), не включён в этот JS/HTML-хеш.
