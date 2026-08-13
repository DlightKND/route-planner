import { describe, it, expect } from 'vitest';
import { vehAgeMin, vehAgeText, vehClass, vehTitle, vehBearing, vehLabel } from '../src/core/vehicle.js';

const nowRow = (over={}) => ({ ts:new Date().toISOString(), status:'moving', speed:60, ...over });
const agoRow = (min, over={}) => ({ ts:new Date(Date.now()-min*60000).toISOString(), status:'moving', ...over });

describe('vehAgeMin', () => {
  it('нет ts → очень старая', () => expect(vehAgeMin({})).toBeGreaterThan(1e8));
  it('свежая ≈ 0 мин', () => expect(vehAgeMin(nowRow())).toBeLessThan(1));
  it('10 минут назад ≈ 10', () => expect(vehAgeMin(agoRow(10))).toBeCloseTo(10, 0));
});

describe('vehAgeText', () => {
  it('меньше минуты', () => expect(vehAgeText(0.5)).toBe('только что'));
  it('минуты', () => expect(vehAgeText(23)).toBe('23 мин назад'));
  it('часы и минуты', () => expect(vehAgeText(90)).toBe('1 ч 30 мин назад'));
});

describe('vehClass', () => {
  it('свежая движущаяся → moving', () => expect(vehClass(nowRow())).toBe('moving'));
  it('свежая стоящая → idle', () => expect(vehClass(nowRow({status:'idle'}))).toBe('idle'));
  it('устаревшая → stale', () => expect(vehClass(agoRow(30))).toBe('stale'));
  it('потеря связи перебивает всё → stale', () => {
    expect(vehClass(nowRow({ lost_since:new Date().toISOString() }))).toBe('stale');
  });
  it('порог настраивается', () => {
    expect(vehClass(agoRow(8), 5)).toBe('stale');   // при пороге 5 — уже старая
    expect(vehClass(agoRow(8), 20)).toBe('moving'); // при 20 — ещё свежая
  });
});

describe('vehTitle', () => {
  it('потеря связи — первым делом', () => {
    expect(vehTitle(nowRow({ lost_since:new Date().toISOString() }))).toMatch(/связь потеряна/);
  });
  it('устаревшая без потери → данных нет', () => {
    expect(vehTitle(agoRow(30))).toMatch(/данных нет/);
  });
  it('стоит', () => expect(vehTitle(nowRow({status:'idle'}))).toBe('стоит на месте'));
  it('едет со скоростью', () => expect(vehTitle(nowRow({speed:73}))).toBe('в движении · 73 км/ч'));
});

describe('vehBearing', () => {
  it('нет точки → null', () => expect(vehBearing(null, {lat:1,lng:1})).toBe(null));
  it('строго на восток ≈ 90°', () => {
    const b = vehBearing({lat:0,lng:0}, {lat:0,lng:1});
    expect(b).toBeCloseTo(90, 0);
  });
  it('строго на север ≈ 0°', () => {
    const b = vehBearing({lat:0,lng:0}, {lat:1,lng:0});
    expect(b).toBeCloseTo(0, 0);
  });
  it('диапазон 0..360', () => {
    const b = vehBearing({lat:49,lng:33}, {lat:48,lng:32});
    expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(360);
  });
});

describe('vehLabel', () => {
  it('номер в приоритете', () => expect(vehLabel({plate:'AX3150EI',name:'VW'})).toBe('AX3150EI'));
  it('имя, если номера нет', () => expect(vehLabel({name:'VW T5'})).toBe('VW T5'));
  it('пусто → тире', () => expect(vehLabel({})).toBe('—'));
});
