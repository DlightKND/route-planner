import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
// Reproducible transfer of the approved v13 CSS; the demo's data/code is never shipped.
const html=gunzipSync(readFileSync(new URL('../tests/visual/fixtures/approved-planner-v13.html.gz',import.meta.url))).toString();
const css=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].slice(1).map(m=>m[1]).join('\n').replace(/@font-face\{[^}]*\}/g,'');
const scope='html#dlight-ui[data-ui-system] #canonicalPlannerHost';
// Appearance owns priority over the global legacy-control adapter. Coordinates and
// interval sizes retain their inline data geometry. No application-wide exemptions.
const transferred=css.replaceAll('#dlight-prototype',scope).replace(/([;{])\s*((?:font(?:-[\w-]+)?|line-height|letter-spacing|text-transform|padding(?:-[\w-]+)?|border(?:-[\w-]+)?|background(?:-[\w-]+)?|color|box-shadow|gap|min-height|min-width))\s*:\s*([^;{}]+)(?=[;}])/g,(_,lead,prop,value)=>`${lead}${prop}:${value.replace(/!important/g,'').trim()}!important`);
writeFileSync(new URL('../src/planner-approved.css',import.meta.url),'/* Generated from the approved v13 fixture by scripts/extract-approved-planner.mjs. */\n'+transferred);
