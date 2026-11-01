// Diagnostic: forecast vs actual ingredient use per day.
import { createGame, stockOf } from '../src/core/state';
import { advance } from '../src/core/sim';
import { openForBusiness, beginNextDay, resolveChoice } from '../src/core/day';
import * as A from '../src/core/actions';
import { suggestOrder } from '../src/core/inventory';
import { dayNeed } from '../src/core/forecast';
import { outbox } from '../src/core/util';
import type { Role } from '../src/data/world';
const s = createGame('Diag', (process.argv[3] ?? 'standard') as never, Number(process.argv[2] ?? 3));
const st = s.stores[0];
const hire = (r: Role) => { const c = st.candidates.find((q) => q.role === r); if (c) A.hire(s, st, c.id); };
for (let d = 0; d < 14; d++) {
  if (st.staff.filter((x) => x.role === 'front').length < 2) hire('front');
  if (st.staff.filter((x) => x.role === 'cook').length < 2) hire('cook');
  const lines = suggestOrder(s, st);
  A.orderSupplies(s, st, lines, false);
  const f = dayNeed(s, st, 'today');
  const before = { dough: stockOf(st, 'dough'), cheese: stockOf(st, 'cheese'), basil: stockOf(st, 'basil'), box: stockOf(st, 'box') };
  openForBusiness(s);
  let g = 0;
  while ((s.phase === 'open' || s.phase === 'closing') && g++ < 20000) { advance(s, 2); if (s.choice) resolveChoice(s, s.choice.options[0].id); s.notice = null; }
  const x = s.report!.stores[0].stats;
  const u = x.used;
  const row = (k: 'dough' | 'cheese' | 'basil' | 'box') => `${k} fc ${(f[k] ?? 0).toFixed(0)} had ${before[k]} used ${(u[k] ?? 0).toFixed(0)}`;
  console.log(`D${s.day} ★${st.rating.toFixed(2)} srv ${x.served} away ${x.turnedAway} walk ${x.walkouts} sold ${x.soldOut} waste $${x.waste.toFixed(0)} | ${row('dough')} | ${row('cheese')} | ${row('basil')} | ${row('box')}`);
  outbox.length = 0;
  beginNextDay(s);
  if (s.choice) resolveChoice(s, s.choice.options[0].id);
}
