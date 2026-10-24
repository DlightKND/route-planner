// A portable catalogue reusing production theme values, scales and candidate components.
import {readFileSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
const read=p=>readFileSync(p,'utf8');
const source=read('index.html'),app=read('src/app.js');
const roots=[...source.matchAll(/^  :root\s*\{[\s\S]*?\n  \}/gm)].map(m=>m[0]).join('\n');
const roleTokens=['src/visual-system.css','src/operations-design.css'].map(p=>read(p).match(/html:root\s*\{[\s\S]*?\n\}/)[0]).join('\n');
const themes=app.slice(app.indexOf('const THEMES='),app.indexOf('function applyTheme('));
if(!roots.includes('--sp-8')||!themes.includes('--on-accent'))throw Error('Shared token source changed; update catalogue extraction.');
const result=await build({stdin:{contents:`${themes}\nwindow.kitThemeValues=THEMES;window.setKitTheme=mode=>{document.documentElement.dataset.theme=mode;document.documentElement.style.colorScheme=mode;Object.entries(THEMES[mode]).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));};window.setKitTheme(new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light');mountKit();import {mountKit} from './src/ui/design-system-preview.js';`,resolveDir:process.cwd(),loader:'js'},bundle:true,format:'iife',write:false,minify:true});
// Bundle font files as data URLs: preview works offline and can be attached as one HTML file.
const fonts=['sans','mono'].flatMap(f=>[400,500,600].flatMap(weight=>['cyrillic','latin'].map(subset=>`@font-face{font-family:'IBM Plex ${f==='sans'?'Sans':'Mono'}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(`node_modules/@fontsource/ibm-plex-${f}/files/ibm-plex-${f}-${subset}-${weight}-normal.woff2`).toString('base64')}) format('woff2');unicode-range:${subset==='cyrillic'?'U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116':'U+0000-00FF,U+2000-206F'}}`))).join('\n');
const html='<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DLIGHT · Дизайн-система 0.6</title><style>'+fonts+roots+roleTokens+'\n'+read('src/ui/component-tokens.css')+'\n'+read('src/ui/design-system.css')+'\n'+read('src/ui/design-system-guidance.css')+'\n'+read('src/ui/design-system-comparison.css').replace(/^@import[^;]+;/gm,'')+'</style><body class="ds-kit"><main id="kit"></main><script>'+result.outputFiles[0].text+'</script></body></html>';
writeFileSync('dist/preview-design-system.html',html);console.log('Design system catalogue generated from shared tokens.');
