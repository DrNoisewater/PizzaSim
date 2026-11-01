import { readFileSync } from 'node:fs';
import { migrate } from '../src/core/state';
import { advance } from '../src/core/sim';
import { openForBusiness, beginNextDay, resolveChoice } from '../src/core/day';
import { truckLines } from '../src/core/inventory';
import { dayNeed, daySummary } from '../src/core/forecast';
import { storageCap, storageUsed } from '../src/core/state';
import * as A from '../src/core/actions';
import type { GameState } from '../src/core/types';
const s = JSON.parse(readFileSync(process.argv[2], 'utf8')) as GameState;
migrate(s);
const st = s.stores[0];
console.log('migrated: version', s.version, 'storage', st.upgrades.storage, 'specials', JSON.stringify(st.specials), 'outlook', s.outlook?.length, 'buffer', st.orderBuffer, 'pool', st.candidates.length);
for (let d = 0; d < 3; d++) {
  if (s.phase === 'report') { beginNextDay(s); if (s.choice) resolveChoice(s, s.choice.options[0].id); }
  const lines = truckLines(s, st);
  const r = A.orderSupplies(s, st, lines, false);
  const need = dayNeed(s, st, 'today');
  console.log('  order ok', r.ok, r.msg, '| dough line', lines.dough, 'need', need.dough?.toFixed(0), 'have', st.inventory.dough.reduce((a, b) => a + b.qty, 0), 'cap', storageCap(st), 'used', storageUsed(st).toFixed(0));
  const plan = daySummary(s, st, 'today');
  openForBusiness(s);
  let g = 0; while ((s.phase === 'open' || s.phase === 'closing') && g++ < 20000) { advance(s, 2); if (s.choice) resolveChoice(s, s.choice.options[0].id); s.notice = null; }
  const x = s.report!.stores[0].stats;
  const xx = st.today;
  console.log('  forecast demand', plan.demand.toFixed(0), 'actual demand', xx.demandByHour.reduce((a, b) => a + b, 0), 'used dough', xx.used.dough, 'drops', xx.drops, 'refunds', xx.refunds, 'weather', s.weather, 'effects', s.effects.map((e) => e.label).join(';'));
  const empty = Object.keys(st.inventory).filter((k) => (st.inventory as any)[k].reduce((a: number, b: any) => a + b.qty, 0) < 1);
  console.log('  empty at close:', empty.join(','), '| unlocked', s.unlocked.join(','), '| specials', st.specials.map((x) => x.id).join(','));
  console.log(`day ${s.day}: served ${x.served} soldOut ${x.soldOut} revenue ${x.revenue.toFixed(0)} cash ${s.cash.toFixed(0)}`);
}
