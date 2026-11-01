// Calendar: three weeks at a glance with weather, events, shortages, promos and staffing.
import type { GameState } from '../core/types';
import { DAY_NAMES, WEATHER, CAMPAIGN, type WeatherId } from '../data/world';
import { ING } from '../data/catalog';
import { shortageCalendar } from '../core/shortage';
import { staffingGaps, withSchedule, ctxForDay } from '../core/forecast';
import { esc, icon } from './dom';
import { loc } from '../core/state';

interface CalEvent {
  label: string;
  tone: 'good' | 'bad' | 'info' | 'warn';
}

const TOMORROW_EVENT: Record<string, CalEvent> = {
  biggame: { label: 'Big game night: huge dinner rush', tone: 'good' },
  festival: { label: 'Street festival: +40% foot traffic', tone: 'good' },
  concert: { label: 'Concert crowd from 6 PM', tone: 'good' },
  sale: { label: 'Restaurant supply sale: 20% off upgrades', tone: 'good' },
  cheese: { label: 'Cheese deal offer', tone: 'info' },
  rival: { label: 'Rival promotion nearby', tone: 'bad' },
  viral: { label: 'Gone viral online', tone: 'good' },
};

export function weatherFor(s: GameState, day: number): WeatherId | null {
  if (day === s.day) return s.weather;
  if (day === s.day + 1) return s.forecast;
  const w = s.outlook?.[day - s.day - 1];
  return day > s.day && w ? w : null;
}

export function eventsFor(s: GameState, day: number): CalEvent[] {
  const out: CalEvent[] = [];
  const dow = (day - 1) % 7;
  const ahead = day - s.day;
  if (dow === 4 || dow === 5) out.push({ label: 'Weekend crowds', tone: 'info' });
  const w = weatherFor(s, day);
  if (w === 'hot') out.push({ label: 'Heatwave: drinks fly off the shelf', tone: 'info' });
  if (w === 'rainy') out.push({ label: 'Rain: fewer walk-ins, more delivery', tone: 'info' });
  out.push(...shortageCalendar(s, day));
  for (const u of s.upcoming) if (u.kind !== 'shortage' && day >= u.day && day < u.day + (u.days ?? 1)) out.push({ label: u.label, tone: 'bad' });
  if (ahead >= 0) {
    for (const e of s.effects) {
      if (ahead < e.daysLeft && e.label && e.kind !== 'price') out.push({ label: e.label, tone: e.mult < 1 ? 'bad' : 'good' });
    }
    for (const e of s.pendingEffects ?? []) {
      if (ahead >= 1 && ahead <= e.daysLeft && e.label) out.push({ label: e.label, tone: e.mult < 1 ? 'bad' : 'good' });
    }
    for (const st of s.stores) {
      for (const c of st.campaigns) if (ahead < c.daysLeft) out.push({ label: `${CAMPAIGN[c.id].name}${s.stores.length > 1 ? ` (${loc(st).name})` : ''}`, tone: 'good' });
      if (st.jobAd > 0 && ahead < st.jobAd) out.push({ label: 'Job ad running', tone: 'info' });
    }
    if (s.loan && ahead === s.loan.daysLeft - 1) out.push({ label: 'Final loan payment', tone: 'good' });
  }
  if (ahead === 1 && s.tomorrowEvent && TOMORROW_EVENT[s.tomorrowEvent]) out.push(TOMORROW_EVENT[s.tomorrowEvent]);
  return out;
}

export function calendarModal(s: GameState, selected: number, back: string): string {
  const first = s.day - ((s.day - 1) % 7);
  const days = Array.from({ length: 21 }, (_, i) => first + i);
  const sel = selected || s.day;
  const cell = (d: number) => {
    const past = d < s.day;
    const w = weatherFor(s, d);
    const ev = past ? [] : eventsFor(s, d).filter((e) => e.label !== 'Weekend crowds');
    const tones = [...new Set(ev.map((e) => e.tone))];
    return `<button class="cal-cell ${past ? 'past' : ''} ${d === s.day ? 'today' : ''} ${d === sel ? 'sel' : ''} ${(d - 1) % 7 >= 4 && (d - 1) % 7 <= 5 ? 'wkend' : ''}" data-act="cal-day" data-v="${d}" ${past ? 'disabled' : ''} aria-label="Day ${d}">
      <span class="cal-n">${d}</span>
      <span class="cal-w">${w ? icon(w, 16) : past ? '' : '<span class="t-meta">?</span>'}</span>
      <span class="cal-dots">${tones.map((t) => `<i class="dot ${t}"></i>`).join('')}</span>
    </button>`;
  };
  const w = weatherFor(s, sel);
  const ev = eventsFor(s, sel);
  let staff = '';
  for (const st of s.stores) {
    if (!st.staff.length) continue;
    const dow = (sel - 1) % 7;
    const g = withSchedule(st, dow, () => staffingGaps(s, st, ctxForDay(s, sel)));
    const who = st.weekly ? st.staff.filter((x) => (st.schedule[x.id]?.[dow] ?? x.shift) !== 'off').length : st.staff.length;
    staff += `<div class="note-row">${icon('staff', 15)}<span>${s.stores.length > 1 ? `<b>${esc(loc(st).name)}:</b> ` : ''}${who} working. ${g.gaps.some((x) => !x.equip) ? `<span class="neg">Short: ${g.gaps.filter((x) => !x.equip).map((x) => `+${x.extra} ${x.role === 'cook' ? 'kitchen' : 'front'} at ${x.window}`).join(', ')}</span>` : g.gaps.length ? '<span class="t-meta">Busier than the equipment can handle.</span>' : '<span class="pos">Covered for the forecast.</span>'}</span></div>`;
  }
  return `<div class="modal calendar" role="dialog" aria-label="Calendar" style="width:min(560px,100%)">
    <h2>Calendar</h2>
    <div class="cal-grid">${DAY_NAMES.map((n) => `<span class="cal-h">${n}</span>`).join('')}${days.map(cell).join('')}</div>
    <div class="cal-legend t-meta"><span><i class="dot good"></i> good news</span><span><i class="dot bad"></i> trouble</span><span><i class="dot warn"></i> act now</span><span><i class="dot info"></i> heads-up</span><span>Weather is known 7 days out.</span></div>
    <div class="ticket" style="margin-top:10px">
      <div class="spread"><b>${sel === s.day ? 'Today' : sel === s.day + 1 ? 'Tomorrow' : DAY_NAMES[(sel - 1) % 7]} · day ${sel}</b><span class="row" style="gap:6px">${w ? `${icon(w, 16)} ${WEATHER[w].name}` : '<span class="t-meta">Weather not forecast yet</span>'}</span></div>
      ${ev.length ? ev.map((e) => `<div class="note-row"><i class="dot ${e.tone}" style="margin-top:6px"></i><span>${esc(e.label)}</span></div>`).join('') : '<div class="note-row"><span class="t-meta">Nothing special on the books.</span></div>'}
      ${staff}
    </div>
    <div class="btns"><button class="btn red block" data-act="${back}">Close</button></div>
  </div>`;
}
