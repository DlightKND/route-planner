import { describe, it, expect } from 'vitest';
import { jobUrgency, isCold, needsEngineer, urgencyRank, attentionBuckets } from '../src/core/sla.js';

const NOW = new Date('2026-08-13T10:00:00');

describe('jobUrgency — базовые уровни', () => {
  it('нет due_date → cold', () => {
    expect(jobUrgency({}, NOW).level).toBe('cold');
  });
  it('срок прошёл → overdue, left отрицательное', () => {
    const u = jobUrgency({ due_date:'2026-08-10', created_at:'2026-07-20' }, NOW);
    expect(u.level).toBe('overdue'); expect(u.left).toBe(-3);
  });
  it('срок 20 дней, до срока 4 → acute (порог 4)', () => {
    // создана 2026-07-24, срок 2026-08-17 → span 24, порог 4.8; left=4 ≤ 4.8
    const u = jobUrgency({ created_at:'2026-07-24', due_date:'2026-08-17' }, NOW);
    expect(u.level).toBe('acute');
  });
  it('срок 20 дней, до срока много → calm', () => {
    const u = jobUrgency({ created_at:'2026-08-11', due_date:'2026-08-31' }, NOW);
    expect(u.level).toBe('calm');  // span 20, порог 4; left 18 > 4
  });
});

describe('jobUrgency — края', () => {
  it('короткий срок: минимум острого 2 дня', () => {
    // span 3 дня → 20%=0.6, но минимум 2. left=1 ≤ 2 → acute
    const u = jobUrgency({ created_at:'2026-08-12', due_date:'2026-08-14' }, NOW);
    expect(u.threshold).toBe(2); expect(u.level).toBe('acute');
  });
  it('вырожденный срок (дедлайн ≤ создания) → сразу acute', () => {
    const u = jobUrgency({ created_at:'2026-08-20', due_date:'2026-08-15' }, NOW);
    expect(u.level).toBe('acute'); expect(u.span).toBeLessThanOrEqual(0);
  });
  it('нет created_at → откат на абсолютные 2 дня', () => {
    const near = jobUrgency({ due_date:'2026-08-14' }, NOW);   // left 1 ≤ 2
    const far  = jobUrgency({ due_date:'2026-08-30' }, NOW);   // left 17 > 2
    expect(near.level).toBe('acute'); expect(near.threshold).toBe(2);
    expect(far.level).toBe('calm');
  });
  it('ровно на границе порога → ещё acute (≤, не <)', () => {
    // span 10 → порог 2 (max(2, 2)); подберём left ровно 2
    const u = jobUrgency({ created_at:'2026-08-05', due_date:'2026-08-15' }, NOW);
    expect(u.left).toBe(2); expect(u.threshold).toBe(2); expect(u.level).toBe('acute');
  });
});

describe('isCold', () => {
  it('open без срока → холодная', () => {
    expect(isCold({ status:'open' })).toBe(true);
  });
  it('planned без срока → НЕ холодная (ей уже занялись)', () => {
    expect(isCold({ status:'planned' })).toBe(false);
  });
  it('open со сроком → не холодная', () => {
    expect(isCold({ status:'open', due_date:'2026-09-01' })).toBe(false);
  });
});

describe('needsEngineer', () => {
  it('активная без инженера → да', () => {
    expect(needsEngineer({ status:'open' })).toBe(true);
    expect(needsEngineer({ status:'in_progress' })).toBe(true);
  });
  it('с инженером → нет', () => {
    expect(needsEngineer({ status:'open', assigned_engineer:'u1' })).toBe(false);
  });
  it('закрытая → нет', () => {
    expect(needsEngineer({ status:'done' })).toBe(false);
  });
});

describe('urgencyRank — порядок', () => {
  it('overdue раньше acute раньше calm раньше cold', () => {
    expect(urgencyRank('overdue')).toBeLessThan(urgencyRank('acute'));
    expect(urgencyRank('acute')).toBeLessThan(urgencyRank('calm'));
    expect(urgencyRank('calm')).toBeLessThan(urgencyRank('cold'));
  });
});

describe('attentionBuckets — раскладка ленты', () => {
  const jobs = [
    { id:'a', status:'open',        due_date:'2026-08-10', created_at:'2026-07-20' }, // overdue
    { id:'b', status:'open',        due_date:'2026-08-14', created_at:'2026-08-12' }, // acute
    { id:'c', status:'open',        due_date:'2026-09-30', created_at:'2026-08-11' }, // calm
    { id:'d', status:'open' },                                                        // cold
    { id:'e', status:'done',        due_date:'2026-08-01', created_at:'2026-07-01' }, // выкинуть
    { id:'f', status:'cancelled' },                                                   // выкинуть
  ];
  const { dated, cold } = attentionBuckets(jobs, NOW);

  it('done и cancelled не попадают в ленту', () => {
    const ids = dated.map(x=>x.job.id).concat(cold.map(j=>j.id));
    expect(ids).not.toContain('e'); expect(ids).not.toContain('f');
  });
  it('холодная — в свой блок', () => {
    expect(cold.map(j=>j.id)).toEqual(['d']);
  });
  it('датированные отсортированы по остроте: overdue, acute, calm', () => {
    expect(dated.map(x=>x.job.id)).toEqual(['a','b','c']);
  });
});
