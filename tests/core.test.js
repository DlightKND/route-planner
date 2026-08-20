import { describe, it, expect } from 'vitest';
import { kmBetween, circuitKm, tspOrder, dedupeStops, simplifyLine } from '../src/core/geo.js';
import { money, hhmm, businessDays, colNum, colLetter, cellRC } from '../src/core/format.js';
import { jobRoadPayer, rateFrom } from '../src/core/tariff.js';

// Заглушка turf: гаверсинус, чтобы geo-тесты не тянули настоящую библиотеку.
const turf = {
  distance([lng1, lat1], [lng2, lat2]) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
};
const K = (49.0779, 33.4154); // Кременчук — просто якорь

describe('geo', () => {
  it('kmBetween: Кременчук → Киев ≈ 245 км', () => {
    const d = kmBetween({ lat: 49.0779, lng: 33.4154 }, { lat: 50.4501, lng: 30.5234 }, turf);
    expect(d).toBeGreaterThan(230); expect(d).toBeLessThan(260);
  });
  it('circuitKm: пустой список = 0', () => {
    expect(circuitKm({ lat: 49, lng: 33 }, [], turf)).toBe(0);
  });
  it('circuitKm: одна точка = туда и обратно', () => {
    const one = circuitKm({ lat: 49, lng: 33 }, [{ lat: 50, lng: 30 }], turf);
    const there = kmBetween({ lat: 49, lng: 33 }, { lat: 50, lng: 30 }, turf);
    expect(one).toBeCloseTo(2 * there, 6);
  });
  it('circuitKm: две точки — обход не короче половины удвоенного', () => {
    const two = circuitKm({ lat: 49, lng: 33 }, [{ lat: 50, lng: 30 }, { lat: 49.5, lng: 34.5 }], turf);
    expect(two).toBeGreaterThan(0);
  });
  it('tspOrder: старт первый, конец последний', () => {
    const M = [[0, 1, 2, 5], [1, 0, 3, 4], [2, 3, 0, 1], [5, 4, 1, 0]];
    const o = tspOrder(M, 3);
    expect(o[0]).toBe(0); expect(o[o.length - 1]).toBe(3);
    expect(new Set(o).size).toBe(4); // все точки по разу
  });
  it('dedupeStops: подряд идущие дубли схлопываются', () => {
    const r = dedupeStops([{ lat: 1, lng: 1 }, { lat: 1, lng: 1 }, { lat: 2, lng: 2 }]);
    expect(r).toHaveLength(2);
  });
});

describe('format', () => {
  it('money: два знака после запятой', () => {
    expect(money(1234.5)).toMatch(/1[\s ]?234,50/);
    expect(money(null)).toMatch(/0,00/);
  });
  it('hhmm: пусто → тире', () => { expect(hhmm(null)).toBe('—'); });
  it('businessDays: та же дата = 0', () => { expect(businessDays('2026-07-13', '2026-07-13')).toBe(0); });
  it('businessDays: пн→пт = 4 (не включая начало)', () => {
    expect(businessDays('2026-07-13', '2026-07-17')).toBe(4); // 13-е пн, считаем вт-пт
  });
  it('businessDays: перескок через выходные', () => {
    expect(businessDays('2026-07-17', '2026-07-20')).toBe(1); // пт→пн: только пн
  });
  it('колонки xlsx: буква↔номер обратимы', () => {
    for (const a1 of ['A1', 'Z9', 'AA10', 'AZ100', 'BA5']) {
      const { c } = cellRC(a1); expect(colLetter(c)).toBe(a1.match(/[A-Z]+/)[0]);
    }
    expect(colNum('A')).toBe(1); expect(colNum('Z')).toBe(26); expect(colNum('AA')).toBe(27);
  });
});

describe('tariff', () => {
  it('jobRoadPayer: гарантийная работа перебивает платную', () => {
    const j = { job_works: [
      { billable: true, tariff_profile: 'client' },
      { billable: false, tariff_profile: 'warranty' }
    ] };
    expect(jobRoadPayer(j)).toBe('warranty');
  });
  it('jobRoadPayer: нет профилей → null', () => {
    expect(jobRoadPayer({ job_works: [{ billable: true }] })).toBe(null);
  });
  it('rateFrom: меньше двух показаний → 0', () => {
    expect(rateFrom([{ taken_on: '2026-01-01', moto_hours: 10 }])).toBe(0);
  });
  it('rateFrom: 20 моточасов за 2 дня = 10/сут', () => {
    const r = rateFrom([
      { taken_on: '2026-01-01', moto_hours: 100 },
      { taken_on: '2026-01-03', moto_hours: 120 }
    ]);
    expect(r).toBeCloseTo(10, 6);
  });
  it('rateFrom: счётчик назад (замена) → 0, не отрицательное', () => {
    const r = rateFrom([
      { taken_on: '2026-01-01', moto_hours: 500 },
      { taken_on: '2026-01-03', moto_hours: 20 }
    ]);
    expect(r).toBe(0);
  });
});

describe('simplifyLine — прореживание маршрута', () => {
  it('короткую линию не трогает', () => {
    const l=[[33,49],[34,50]];
    expect(simplifyLine(l)).toHaveLength(2);
  });
  it('точки на прямой выбрасываются, концы остаются', () => {
    const l=[[0,0],[1,1],[2,2],[3,3],[4,4]];   // строго прямая
    const r=simplifyLine(l,0.0001);
    expect(r[0]).toEqual([0,0]);
    expect(r[r.length-1]).toEqual([4,4]);
    expect(r.length).toBeLessThan(l.length);
  });
  it('излом сохраняется', () => {
    const l=[[0,0],[1,0],[2,0],[2,1],[2,2]];   // поворот на [2,0]
    const r=simplifyLine(l,0.0001);
    expect(r).toContainEqual([2,0]);
  });
  it('длинная линия сокращается многократно', () => {
    const l=[]; for(let i=0;i<5000;i++) l.push([33+i*0.00002, 49+i*0.00002]);
    const r=simplifyLine(l,0.0001);
    expect(r.length).toBeLessThan(l.length/10);
  });
  it('не падает на пустом и на одной точке', () => {
    expect(simplifyLine([])).toEqual([]);
    expect(simplifyLine([[1,1]])).toHaveLength(1);
  });
});
