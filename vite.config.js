import { defineConfig } from 'vite';

// GitHub Pages для проекта отдаёт сайт из подпапки:
//   https://<логин>.github.io/route-planner/
// Поэтому ссылки на ассеты должны быть ОТНОСИТЕЛЬНЫМИ (base './'),
// иначе браузер ищет /assets/... от корня домена и получает 404 —
// ровно это и давало серый экран: HTML грузился, а бандл с картой нет.
export default defineConfig({
  base: './',
});
