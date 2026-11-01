// App controller: owns the game state, runs the loop, routes input to core actions,
// and keeps the HUD, panels and 3D view in sync.
import { World } from '../render/world';
import { PEOPLE_DETAIL } from '../render/people';
import { createGame, loc, activeStaff, stockOf, up, SAVE_VERSION, seatsTotal, migrate, tills, orderBuffer, dailyWages } from '../core/state';
import { advance, ovenSlots, itemsInStage, serviceSnapshot, quotedWait } from '../core/sim';
import { daySummary, LIMIT_LABEL, LIMIT_FIX, runsOutAt } from '../core/forecast';
import { openForBusiness, beginNextDay, resolveChoice } from '../core/day';
import * as A from '../core/actions';
import { outbox, money, clock, plural } from '../core/util';
import { suggestOrder, estimateDailyNeed, neededIngredients, bufferMult, fitToBudget, truckLines } from '../core/inventory';
import { ingredientPrice } from '../core/economy';
import { resetDressingTextures } from '../render/dressing';
import { xpForLevel } from '../core/progression';
import { ING, ITEM, type IngId, type ItemId, type SupplierId } from '../data/catalog';
import { UPG, type UpgradeId } from '../data/upgrades';
import { DAY_NAMES, LOC, WEATHER, type CampaignId, type LocationId, type ShiftId, type SpecialWindow } from '../data/world';
import type { GameState, Store, Difficulty } from '../core/types';
import { saves, native, loadSettings, storeSettings, type Settings, type SaveMeta } from '../platform/storage';
import { audio } from '../platform/audio';
import { loadFeedback, saveFeedback, sendDirect, rememberSent, deviceSummary } from '../platform/feedback';
import { exportSave, readSaveFile } from '../platform/savefile';
import { $, esc, icon, stars, meter, pizzaRating, toggleFullscreen, isFullscreen, fullscreenSupported, freeOrientation } from './dom';
import { TABS, renderPanel, panelTitle, hourChart, type TabId, type PanelCtx } from './panels';
import * as S from './screens';
import * as M from '../core/manager';
import { kioskCount } from '../core/layout';
import { shortages, shortageChip, shortageAdvice, shortageFor, stockUpPlan } from '../core/shortage';
import { calendarModal } from './calendar';
import { planModalHtml } from './plan';
import { celebrate, skipCelebration, type CelebrationId } from '../core/crew';
import { INSPECTOR_NAME } from '../core/inspector';

/** Game minutes per real second at 1x. Walking is coupled to this, so it also sets how fast people move. */
export const MIN_PER_SEC = 2;
/** Game speed buttons (x normal). */
const SPEEDS = [1, 3, 8];

type ModalKind = 'calendar' | 'updates' | 'report' | 'choice' | 'pause' | 'settings' | 'help' | 'credits' | 'feedback' | 'gameover' | 'stockcheck' | 'plan' | 'notice' | 'buycheck' | null;

export class App {
  el: HTMLElement;
  world!: World;
  s: GameState | null = null;
  demo: GameState;
  settings: Settings;
  speed = 1;
  paused = false;
  /** Set by the plan's quick start: once the new day begins (and any event is answered), order and open. */
  private quickGo = false;
  tab: TabId | null = null;
  sub: Record<string, string> = {};
  carts = new Map<number, Partial<Record<IngId, number>>>();
  confirmFire: number | null = null;
  focusUpgrade: string | null = null;
  storeIdx = 0;
  modal: ModalKind = null;
  private modalShown: ModalKind = null;
  modalBack = 'pause';
  titleView: 'main' | 'new' | 'load' | null = 'main';
  loadFromGame = false;
  newName = "Tony's Pizza";
  newDiff: Difficulty = 'standard';
  private lastT = 0;
  private panelAt = 0;
  private hudAt = 0;
  private lastPhase = '';
  private shownCash = 0;
  private saveList: SaveMeta[] = [];
  private hoverAt = 0;
  private lastRatingKey = '';
  private lastWeather = '';
  private lastStoreKey = '';
  private lastPanelHtml = '';
  private refundToastAt = 0;
  private refundBurst = 0;
  private dropToastAt = 0;
  private dropBurst = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    this.settings = loadSettings();
    audio.enabled = this.settings.sound;
    audio.setVolume(this.settings.volume);
    audio.musicOn = this.settings.music;
    el.innerHTML = this.skeleton();
    try {
      this.world = new World($('#view', el) as unknown as HTMLCanvasElement);
    } catch (e) {
      el.innerHTML = `<div class="scrim" style="position:fixed"><div class="modal"><h2>3D graphics unavailable</h2><p>Pizza SIM needs WebGL 2. Try a current version of Chrome, Edge, Firefox or Safari, or turn on hardware acceleration.</p><p class="t-meta">${esc(String(e))}</p></div></div>`;
      throw e;
    }
    this.applySettings();
    this.demo = this.makeDemo();
    this.world.controls.autoRotate = 0.05;
    this.world.envOverride = 19 * 60 + 50;
    this.bind();
    this.world.resize();
    this.refreshTitle();
    saves.ready.then(() => this.refreshTitle());
    requestAnimationFrame(this.frame);
    // canvas-drawn signs need the web fonts; redraw them once fonts arrive
    let fontsDone = false;
    const refreshFonts = () => {
      if (fontsDone || !document.fonts) return;
      const loaded = [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Lilita One' && f.status === 'loaded');
      if (!loaded) return;
      fontsDone = true;
      resetDressingTextures();
      this.world.reset();
    };
    document.fonts?.addEventListener?.('loadingdone', refreshFonts);
    document.fonts?.ready.then(refreshFonts);
  }

  // =============================================================== skeleton

  private skeleton() {
    return `
    <canvas id="view" aria-label="3D view of your pizzeria"></canvas>
    <header id="hud" hidden>
      <div class="brand"><div class="brand-mark" aria-hidden="true"></div><div class="brand-text"><div class="brand-name" id="h-name"></div><div id="h-store"></div></div></div>
      <div class="hud-group">
        <div class="hud-stat"><span class="hud-label">Cash</span><span class="hud-value cash" id="h-cash">$0</span></div>
      </div>
      <div class="hud-group hud-row2">
        <button class="hud-stat hud-cal" data-act="calendar" title="Calendar"><span class="hud-label" id="h-day">Day 1</span><span class="hud-value" id="h-clock"></span></button>
        <div class="hud-stat hud-rate" title="Rating out of 5"><span id="h-rating"></span></div>
        <div class="hud-stat hide-phone"><span class="hud-label" id="h-level">Level 1</span><span class="lvl-bar"><span id="h-xp"></span></span></div>
        <button class="hud-btn" data-act="menu" aria-label="Game menu and settings" title="Menu and settings">${icon('burger', 20)}</button>
        <div class="speed" role="group" aria-label="Game speed">
          <button data-act="pause-toggle" id="sp-0" aria-label="Pause">${icon('pause', 16)}</button>
          <button data-act="speed" data-v="1" id="sp-1" aria-label="Normal speed">${icon('play', 14)}</button>
          <button data-act="speed" data-v="3" id="sp-3" aria-label="Fast (3x)">${icon('fast', 16)}</button>
          <button data-act="speed" data-v="8" id="sp-8" aria-label="Fastest (8x)">${icon('faster', 18)}</button>
        </div>
      </div>
    </header>
    <nav id="rail" role="tablist" hidden>${TABS.map((t) => `<button class="tab" role="tab" data-act="tab" data-tab="${t.id}" id="tab-${t.id}" aria-selected="false" title="${t.label} (${t.key.toUpperCase()})">${icon(t.icon, 22)}<span class="only-desktop">${t.label}</span><span class="only-mobile">${t.short}</span></button>`).join('')}</nav>
    <section id="panel" hidden aria-live="off">
      <div class="panel-head"><div class="grow"><h2 class="panel-title" id="p-title"></h2><div class="panel-sub" id="p-sub"></div></div><button class="icon-btn" data-act="close-panel" aria-label="Close panel">${icon('close', 18)}</button></div>
      <div class="panel-body" id="p-body"></div>
    </section>
    <div id="paused-badge" hidden>${icon('pause', 16)}<span>Paused</span><button class="btn tiny" data-act="pause-toggle">Resume</button></div>
    <div id="floor" hidden></div>
    <div id="cta" hidden></div>
    <div id="camctl" hidden role="group" aria-label="Camera">
      <button data-act="cam-toggle" class="cam-toggle" aria-label="Show or hide camera buttons" title="Camera buttons">${icon('camcorder', 18)}</button>
      <button data-act="cam" data-v="in" aria-label="Zoom in">${icon('plus', 18)}</button>
      <button data-act="cam" data-v="out" aria-label="Zoom out">${icon('minus', 18)}</button>
      <button data-act="cam" data-v="left" aria-label="Turn left">⟲</button>
      <button data-act="cam" data-v="right" aria-label="Turn right">⟳</button>
      <button data-act="cam" data-v="home" aria-label="Reset view">${icon('home', 16)}</button>
    </div>
    <div id="toasts" aria-live="polite"></div>
    <div id="texts" aria-live="polite"></div>
    <div id="tip" hidden></div>
    <div id="modal" hidden></div>
    <div id="title"></div>`;
  }

  // =============================================================== demo for title

  private makeDemo(): GameState {
    const d = createGame('Pizza SIM', 'relaxed', 4242);
    const st = d.stores[0];
    d.level = 9;
    Object.assign(st.upgrades, { oven: 3, prep: 2, register: 2, dining: 3, decor: 3, sign: 3, delivery: 2, cleaning: 1, breakroom: 1 });
    d.unlocked = Object.keys(ITEM) as ItemId[];
    for (const k of Object.keys(st.menu) as ItemId[]) st.menu[k].on = true;
    for (let i = 0; i < 6; i++) {
      const c = st.candidates[0] ?? null;
      if (c) A.hire(d, st, c.id);
      st.candidates = st.candidates.length ? st.candidates : [];
    }
    const roles = ['cook', 'cook', 'front', 'front', 'driver'] as const;
    for (const r of roles) {
      if (st.staff.filter((x) => x.role === r).length >= (r === 'cook' ? 3 : r === 'front' ? 2 : 1)) continue;
      st.candidates.push({ id: ++d.nextId, name: 'Demo', role: r, skill: 3, wage: 12, traits: [], look: { skin: d.nextId % 6, hair: d.nextId % 7, shirt: 0, pants: 0, height: 1 } });
      A.hire(d, st, d.nextId);
    }
    for (const k of Object.keys(st.inventory) as IngId[]) st.inventory[k] = [{ qty: 400, exp: 999 }];
    d.cash = 99999;
    openForBusiness(d);
    advance(d, 7 * 60);
    d.notice = null;
    outbox.length = 0;
    return d;
  }

  // =============================================================== input

  private bind() {
    const el = this.el;
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t || (t as HTMLButtonElement).disabled) return;
      audio.unlock();
      this.onAct(t.dataset.act!, t.dataset, t);
    });
    // no <form> here: sandboxed embeds (like the claude.ai viewer) block form submission
    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLInputElement;
      if (e.key === 'Enter' && t.id === 'ng-name') {
        e.preventDefault();
        this.onAct('start-game', {});
      }
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.id === 'h-select' && this.s) {
        this.storeIdx = Number(t.value);
        this.renderPanel(true);
      }
    });
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'ng-name') this.newName = t.value;
      if (t.id === 'fb-notes' || t.id === 'fb-name') {
        clearTimeout(this.fbTimer);
        this.fbTimer = window.setTimeout(() => this.saveFeedbackFromForm(), 400);
        const status = document.getElementById('fb-status');
        if (status && status.textContent !== 'Saved automatically.') status.textContent = 'Saved automatically.';
      }
    });
    // bullets carry on to the next line in the feedback notes
    el.addEventListener('keydown', (e) => {
      const ta = e.target as HTMLTextAreaElement;
      if (ta.id !== 'fb-notes' || e.key !== 'Enter' || e.shiftKey) return;
      const pre = ta.value.slice(0, ta.selectionStart);
      const line = pre.slice(pre.lastIndexOf('\n') + 1);
      if (!line.startsWith('• ')) return;
      e.preventDefault();
      if (line.trim() === '•') ta.setRangeText('', ta.selectionStart - line.length, ta.selectionStart, 'end');
      else ta.setRangeText('\n• ', ta.selectionStart, ta.selectionEnd, 'end');
      this.saveFeedbackFromForm();
    });
    // typed numbers (prices, wages, order quantities) commit on change/Enter
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (!t.dataset?.input) return;
      this.onAct(t.dataset.input, { ...t.dataset, v: t.value }, t);
    });
    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLInputElement;
      if (e.key === 'Enter' && t.dataset?.input) {
        e.preventDefault();
        t.blur();
      }
    });
    const view = $('#view', el) as unknown as HTMLCanvasElement;
    view.addEventListener('pointerup', (e) => {
      if (!this.s || this.world.controls.wasDrag || this.modal) return;
      const tag = this.world.pickAt(e.clientX, e.clientY);
      if (tag) this.openFromPick(tag);
    });
    view.addEventListener('pointermove', (e) => {
      if (!this.s || e.pointerType !== 'mouse') return;
      const now = performance.now();
      if (now - this.hoverAt < 60) return;
      this.hoverAt = now;
      const tag = this.world.pickAt(e.clientX, e.clientY);
      const tip = $('#tip');
      const label = tag ? this.pickLabel(tag) : '';
      view.classList.toggle('hover', !!label);
      if (label && e.buttons === 0) {
        tip.hidden = false;
        tip.textContent = label;
        const r = this.el.getBoundingClientRect();
        tip.style.left = e.clientX - r.left + 'px';
        tip.style.top = e.clientY - r.top + 'px';
      } else tip.hidden = true;
    });
    view.addEventListener('pointerleave', () => ($('#tip').hidden = true));
    // chart tooltip
    el.addEventListener('pointermove', (e) => {
      const t = e.target as Element;
      const chart = t.closest?.('.chart') as HTMLElement | null;
      document.querySelectorAll('.chart-tip').forEach((n) => {
        if (!chart || !chart.contains(n)) n.remove();
      });
      if (!chart || !t.classList.contains('hit')) {
        chart?.querySelector('.chart-tip')?.remove();
        return;
      }
      const data = JSON.parse(chart.dataset.chart || '[]') as number[][];
      const row = data[Number((t as HTMLElement).dataset.i)];
      if (!row) return;
      let tip = chart.querySelector('.chart-tip') as HTMLElement | null;
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'chart-tip';
        chart.appendChild(tip);
      }
      tip.innerHTML = `<div><b>Day ${row[0]}</b></div><div class="r"><span>Sales</span><b>${money(row[1])}</b></div><div class="r"><span>Costs</span><b>${money(row[2])}</b></div><div class="r"><span>Profit</span><b>${money(row[3])}</b></div>`;
      const cr = chart.getBoundingClientRect();
      const rr = (t as Element).getBoundingClientRect();
      const x = Math.min(Math.max(rr.left + rr.width / 2 - cr.left, 70), cr.width - 70);
      tip.style.left = x + 'px';
      tip.style.top = rr.top - cr.top + 40 + 'px';
    });
    window.addEventListener('resize', () => this.world.resize());
    // full screen by default: browsers only allow it from a tap, so take the first one
    const goFull = () => {
      if (!this.settings.fullscreen || this.fsDeclined || native() || !fullscreenSupported() || isFullscreen()) return;
      toggleFullscreen();
    };
    document.addEventListener('pointerup', goFull, true);
    document.addEventListener('fullscreenchange', () => {
      if (!isFullscreen()) this.fsDeclined = true;
    });
    const onFs = () => {
      if (isFullscreen()) freeOrientation();
      // relabel the full-screen buttons wherever they are showing
      if (this.titleView) this.refreshTitle();
      else if (this.modal === 'pause') this.renderModal();
      setTimeout(() => this.world.resize(), 60);
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    // On phones the tab bar's height depends on the device (gesture bar, browser chrome, font size).
    // Publish its real height so the big buttons and cards always sit above it.
    const rail = $('#rail', el);
    const syncRail = () => {
      const phone = rail.getBoundingClientRect().left <= 1 && rail.offsetWidth >= window.innerWidth - 2;
      const h = phone && !rail.hidden ? Math.max(0, window.innerHeight - rail.getBoundingClientRect().top) : 0;
      document.documentElement.style.setProperty('--rail-h', `${Math.ceil(h)}px`);
    };
    if ('ResizeObserver' in window) new ResizeObserver(syncRail).observe(rail, { box: 'border-box' });
    window.addEventListener('resize', syncRail);
    window.visualViewport?.addEventListener('resize', syncRail);
    setTimeout(syncRail, 0);
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => {
      audio.setHidden(document.hidden);
      if (document.hidden && this.s) this.save('auto');
    });
    window.addEventListener('pagehide', () => {
      if (this.s) this.save('auto');
    });
    // keep panel content stable while the pointer is down inside it
    const panel = $('#panel', el);
    panel.addEventListener('pointerdown', () => (this.panelAt = performance.now() + 1200));
  }

  private onKey(e: KeyboardEvent) {
    const tgt = e.target as HTMLElement;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    if (!this.s || this.titleView) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (this.modal === 'pause' || this.modal === 'settings' || this.modal === 'help' || this.modal === 'credits' || this.modal === 'feedback') this.closeModal();
      else if (this.tab) this.closePanel();
      else if (!this.modal) this.openModal('pause');
      return;
    }
    if (this.modal) return;
    if (k === ' ' || k === 'p') {
      e.preventDefault();
      this.onAct('pause-toggle', {});
    } else if (k === '1' || k === '2' || k === '3') {
      this.onAct('speed', { v: String(SPEEDS[Number(k) - 1]) });
    } else if (k === 'enter' && this.s.phase === 'prep') this.onAct('open', {});
    else {
      const t = TABS.find((x) => x.key === k);
      if (t) this.toggleTab(t.id);
    }
  }

  // =============================================================== actions

  private result(r: A.Result) {
    this.toast(r.msg, r.ok ? 'good' : 'bad');
    audio.play(r.ok ? 'click' : 'error');
    this.renderPanel(true);
  }

  private onAct(act: string, d: DOMStringMap, el?: HTMLElement) {
    const s = this.s;
    const st = s ? this.store() : null;
    const id = Number(d.id);
    switch (act) {
      // ---- title
      case 'continue':
        if (this.saveList[0]) this.loadSlot(this.saveList[0].slot);
        return;
      case 'new-game':
        this.titleView = 'new';
        this.modal = null;
        this.renderModal();
        this.refreshTitle();
        return;
      case 'title':
        this.titleView = 'main';
        this.modal = null;
        this.renderModal();
        this.refreshTitle();
        return;
      case 'load-screen':
        this.loadFromGame = false;
        this.titleView = 'load';
        this.refreshTitle();
        return;
      case 'load-screen-game':
        this.loadFromGame = true;
        this.modal = null;
        this.renderModal();
        this.titleView = 'load';
        this.refreshTitle();
        return;
      case 'start-game': {
        const inp = document.getElementById('ng-name') as HTMLInputElement | null;
        this.startNewGame(inp?.value ?? this.newName, this.newDiff);
        return;
      }
      case 'ng-diff':
        this.newDiff = d.v as Difficulty;
        this.refreshTitle();
        return;
      case 'load':
        this.loadSlot(d.slot!);
        return;
      case 'export-save':
        saves.load(d.slot!).then((f) => {
          if (!f) return this.toast('That save could not be read.', 'bad');
          const name = exportSave(f);
          this.toast(`Downloaded ${name}. Keep it somewhere safe.`, 'good');
        });
        return;
      case 'export-current': {
        if (!s) return;
        const f = { meta: { slot: 'auto', savedAt: Date.now(), company: s.company, day: s.day, cash: Math.round(s.cash), level: s.level, stores: s.stores.length }, data: this.serialize(s) };
        this.save('auto');
        const name = exportSave(f);
        this.toast(`Downloaded ${name}. Keep it somewhere safe.`, 'good');
        return;
      }
      case 'import-save':
        this.importInput().click();
        return;
      case 'delete-save':
        saves.remove(d.slot!).then(() => this.refreshTitle());
        return;
      case 'quit-app':
        if (this.s) this.save('auto');
        setTimeout(() => native()?.quit(), 200);
        return;
      case 'splash': {
        S.rerollSplash();
        const old = document.querySelector('.splash');
        const tmp = document.createElement('div');
        tmp.innerHTML = S.splashHtml();
        if (old && tmp.firstElementChild) old.replaceWith(tmp.firstElementChild);
        audio.play('ding');
        return;
      }
      case 'help':
        this.modalBack = this.s && !this.titleView ? 'pause' : 'close-modal';
        this.openModal('help');
        return;
      case 'settings':
        this.modalBack = this.s && !this.titleView ? 'pause' : 'close-modal';
        this.openModal('settings');
        return;
      case 'credits':
        this.modalBack = this.s && !this.titleView ? 'pause' : 'close-modal';
        this.openModal('credits');
        return;
      case 'cam-toggle':
        this.settings.camButtons = !this.settings.camButtons;
        this.applySettings();
        return;
      case 'cam': {
        const c = this.world.controls;
        if (d.v === 'in') c.zoomBy(0.8);
        else if (d.v === 'out') c.zoomBy(1.25);
        else if (d.v === 'left') c.rotateBy(-0.35);
        else if (d.v === 'right') c.rotateBy(0.35);
        else c.reset();
        return;
      }
      case 'goto-bank':
        this.sub.finance = 'bank';
        this.openTab('finance');
        return;
      case 'calendar':
        this.calDay = 0;
        this.modalBack = 'close-modal';
        this.openModal('calendar');
        return;
      case 'cal-day':
        this.calDay = Number(d.v);
        this.renderModal();
        return;
      case 'updates':
        this.updOpen = '';
        this.openModal('updates');
        return;
      case 'upd-open':
        this.updOpen = this.updOpen === d.v ? '-' : d.v!;
        this.renderModal();
        return;
      case 'feedback':
        this.modalBack = this.s && !this.titleView ? 'pause' : 'close-modal';
        this.openModal('feedback');
        return;
      case 'fb-bullet':
      case 'fb-stamp': {
        const ta = document.getElementById('fb-notes') as HTMLTextAreaElement | null;
        if (!ta) return;
        const pre = ta.value.slice(0, ta.selectionStart);
        const lineStart = !pre.length || pre.endsWith('\n');
        const s0 = this.s;
        const ins = act === 'fb-bullet' ? (lineStart ? '• ' : '\n• ') : `${lineStart ? '' : '\n'}[Day ${s0?.day ?? '-'}${s0 && (s0.phase === 'open' || s0.phase === 'closing') ? ' ' + clock(s0.minute) : ''}] `;
        ta.setRangeText(ins, ta.selectionStart, ta.selectionEnd, 'end');
        ta.focus();
        this.saveFeedbackFromForm();
        return;
      }
      case 'fb-copy': {
        this.saveFeedbackFromForm();
        const txt = loadFeedback().notes;
        navigator.clipboard?.writeText(txt).then(() => this.toast('Notes copied.', 'good'), () => this.toast('Copy failed: select the text and copy it by hand.', 'bad'));
        return;
      }
      case 'fb-send': {
        this.saveFeedbackFromForm();
        const draft = loadFeedback();
        if (!draft.notes.trim()) return this.toast('Write a note first.', 'info');
        if (this.fbSending) return;
        this.fbSending = true;
        const status = document.getElementById('fb-status');
        const btn = document.querySelector<HTMLButtonElement>('[data-act="fb-send"]');
        if (status) status.textContent = 'Sending…';
        if (btn) btn.disabled = true;
        const s0 = this.s;
        const diff = s0 ? s0.difficulty.charAt(0).toUpperCase() + s0.difficulty.slice(1) : '';
        const ctx: Record<string, string> = {
          Game: s0 ? `${s0.company} · ${diff} · Day ${s0.day} · Level ${s0.level} · ${money(s0.cash)} cash` : 'Sent from the title screen',
          Device: deviceSummary(),
        };
        sendDirect(draft, ctx).then((r) => {
          this.fbSending = false;
          if (btn) btn.disabled = false;
          if (r.ok) {
            rememberSent(draft.notes);
            saveFeedback({ ...draft, notes: '', sentAt: Date.now(), sentCount: (draft.sentCount ?? 0) + 1 });
            const ta = document.getElementById('fb-notes') as HTMLTextAreaElement | null;
            if (ta) ta.value = '';
            audio.play('ding');
          }
          if (status) status.textContent = r.msg;
          this.toast(r.msg, r.ok ? 'good' : r.pending ? 'info' : 'bad');
        });
        return;
      }
      case 'fb-clear': {
        const draft = loadFeedback();
        saveFeedback({ ...draft, notes: '', sentCount: (draft.sentCount ?? 0) + 1 });
        const ta = document.getElementById('fb-notes') as HTMLTextAreaElement | null;
        if (ta) ta.value = '';
        const status = document.getElementById('fb-status');
        if (status) status.textContent = 'Thanks! Notes cleared. Start a fresh list any time.';
        audio.play('ding');
        return;
      }
      case 'close-modal':
        this.closeModal();
        return;
      case 'set': {
        const key = d.key as keyof Settings;
        (this.settings as unknown as Record<string, unknown>)[key] = !this.settings[key];
        if (key === 'fullscreen' && !native()) {
          this.fsDeclined = false;
          if (this.settings.fullscreen !== isFullscreen()) toggleFullscreen();
        }
        this.applySettings();
        this.renderModal();
        return;
      }
      case 'volume':
        this.settings.volume = Math.max(0, Math.min(1, Math.round((this.settings.volume + Number(d.d)) * 10) / 10));
        this.applySettings();
        audio.play('click');
        this.renderModal();
        return;
      case 'quality':
        this.settings.quality = d.v as Settings['quality'];
        this.applySettings();
        this.renderModal();
        return;
    }
    switch (act) {
      case 'fullscreen': {
        const n = native();
        if (n) n.toggleFullscreen();
        else
          toggleFullscreen().then((ok) => {
            if (!ok) this.toast("This browser won't go full screen. Try Chrome, or add the page to your home screen.", 'info');
          });
        return;
      }
    }
    if (!s || !st) return;
    switch (act) {
      case 'tab':
        this.toggleTab(d.tab as TabId);
        return;
      case 'close-panel':
        this.closePanel();
        return;
      case 'sub':
        this.sub[d.key!] = d.v!;
        this.renderPanel(true);
        // only switching a panel's tabs jumps to the top; opening a card keeps your place
        if (d.top) $('#p-body').scrollTop = 0;
        return;
      case 'speed':
        this.speed = Number(d.v);
        if (s.phase === 'open' || s.phase === 'closing') this.paused = false;
        else this.toast(s.phase === 'prep' ? `Speed set to ${this.speed}x. Time starts when you open for business.` : `Speed set to ${this.speed}x for tomorrow. Tap "Start day ${s.day + 1}" when you're ready.`, 'info');
        return;
      case 'pause-toggle':
        if (s.phase === 'open' || s.phase === 'closing') this.paused = !this.paused;
        else if (s.phase === 'report' && s.report) this.openModal('report');
        else this.toast('Time is stopped during morning prep. Open for business to start the clock.', 'info');
        return;
      case 'plan':
        this.openModal('plan');
        return;
      case 'plan-go':
        if (s.phase === 'report') {
          this.quickGo = true;
          this.onAct('next-day', {});
          if (!s.choice) this.finishQuickGo();
        } else this.finishQuickGo();
        return;
      case 'plan-tab':
        this.modal = null;
        this.renderModal();
        this.openTab(d.tab as TabId);
        return;
      case 'plan-campaign': {
        const r = A.runCampaign(s, st, d.id as CampaignId);
        this.toast(r.ok ? r.msg : r.msg, r.ok ? 'good' : 'bad');
        if (r.ok) audio.play('cash');
        this.renderModal();
        return;
      }
      case 'receipt':
        if (s.report) this.openModal('report');
        return;
      case 'notice-ok':
        s.notice = null;
        this.modal = null;
        this.renderModal();
        return;
      case 'menu':
      case 'pause':
        this.titleView = null;
        this.refreshTitle();
        this.openModal('pause');
        return;
      case 'resume':
        this.closeModal();
        return;
      case 'save':
        this.save(d.slot!).then((ok) => ok && this.toast(`Saved to slot ${d.slot}. ${saves.where}.`, 'good'));
        audio.play('click');
        return;
      case 'quit-title':
        this.save('auto').then(() => this.toTitle());
        return;
      case 'open': {
        if (d.force !== '1' && this.truckDue(s)) {
          this.openModal('stockcheck');
          return;
        }
        this.modal = null;
        this.renderModal();
        const r = openForBusiness(s);
        if (!r.ok) return this.toast(r.msg ?? '', 'bad');
        audio.play('open');
        this.paused = false;
        this.world.resetActors();
        this.updateCta();
        return;
      }
      case 'celebrate': {
        const target = s.stores.find((x) => x.id === Number(d.store)) ?? st;
        const r = celebrate(s, target, d.v as CelebrationId);
        this.toast(r.msg, r.ok ? 'good' : 'bad');
        if (r.ok) audio.play('cash');
        this.renderModal();
        return;
      }
      case 'celebrate-skip': {
        const target = s.stores.find((x) => x.id === Number(d.store)) ?? st;
        skipCelebration(s, target);
        this.renderModal();
        return;
      }
      case 'crew-msg': {
        const target = s.stores.find((x) => x.id === Number(d.store)) ?? st;
        const r = M.sendCrewMessage(s, target, d.v as M.CrewMsgKind);
        if (!r.ok) this.toast(r.msg, 'bad');
        else audio.play('ding');
        this.renderModal();
        return;
      }
      case 'buycheck-truck':
        this.pendingBuy = null;
        this.openModal('stockcheck');
        return;
      case 'stock-up': {
        const x = shortageFor(s, d.k as IngId);
        const plan = x && stockUpPlan(s, st, x);
        if (!plan) return this.toast('Nothing to stock up right now.', 'info');
        const r = A.orderSupplies(s, st, { [d.k as IngId]: plan.qty }, false);
        this.toast(r.ok ? `Stocked up: +${plan.qty} ${ING[d.k as IngId].name.toLowerCase()} at the normal price${s.phase === 'prep' ? '' : ', arriving tomorrow morning'}.` : r.msg, r.ok ? 'good' : 'bad');
        if (r.ok) audio.play('cash');
        this.renderPanel(true);
        return;
      }
      case 'ask-help': {
        const r = M.askForHelp(s, st);
        if (!r.ok) this.toast(r.msg, 'info');
        this.updateFloor();
        return;
      }
      case 'next-day':
        beginNextDay(s);
        this.paused = true;
        this.world.resetActors();
        this.modal = null;
        this.renderModal();
        this.save('auto');
        if (s.choice) this.openModal('choice');
        else if (this.settings.autoNextDay && !this.quickGo) this.onAct('open', {});
        this.renderPanel(true);
        return;
      case 'choose': {
        const msg = resolveChoice(s, d.id!);
        this.modal = null;
        this.renderModal();
        if (msg) this.toast(msg, 'info');
        if (this.quickGo) this.finishQuickGo();
        else if (this.settings.autoNextDay && s.phase === 'prep') this.onAct('open', {});
        return;
      }
      case 'truck-skip':
        for (const x of s.stores) x.truckDay = s.day;
        this.onAct('open', { force: '1' });
        return;
      case 'order-and-open':
      case 'order-truck':
      case 'order-afford': {
        for (const x of s.stores) {
          const lines = act === 'order-afford' ? fitToBudget(s, x, truckLines(s, x), Math.max(0, s.cash - 20) / s.stores.length) : truckLines(s, x);
          if (Object.keys(lines).length) {
            const r = A.orderSupplies(s, x, lines, false);
            if (!r.ok) {
              this.toast(r.msg, 'bad');
              this.renderModal();
              return;
            }
            this.toast(r.msg, 'good');
          }
          x.truckDay = s.day;
        }
        audio.play('ding');
        if (act === 'order-truck' || act === 'order-afford') {
          this.closeModal();
          this.renderPanel(true);
          this.updateCta();
          return;
        }
        this.onAct('open', { force: '1' });
        return;
      }
      case 'goto-stock':
        this.modal = null;
        this.renderModal();
        this.openTab('stock');
        return;
      case 'game-over':
        this.openModal('gameover');
        return;
      // ---- staff
      case 'hire':
        return this.result(A.hire(s, st, id));
      case 'fire':
        if (this.confirmFire !== id) {
          this.confirmFire = id;
          this.renderPanel(true);
          setTimeout(() => {
            if (this.confirmFire === id) {
              this.confirmFire = null;
              this.renderPanel(true);
            }
          }, 3500);
          return;
        }
        this.confirmFire = null;
        return this.result(A.fire(s, st, id));
      case 'train':
        return this.result(A.train(s, st, id));
      case 'wage':
        return this.result(A.adjustWage(s, st, id, Number(d.d)));
      case 'wage-set':
        return this.result(A.setWage(s, st, id, parseFloat(d.v ?? '')));
      case 'shift':
        return this.result(A.setShift(s, st, id, d.v as ShiftId));
      case 'dayoff':
        return this.result(A.toggleDayOff(s, st, id));
      case 'weekly':
        return this.result(A.setWeekly(s, st, !st.weekly));
      case 'sched-set': {
        const r = A.setScheduleCell(s, st, id, Number(d.d), d.v as ShiftId | 'off');
        if (!r.ok) return this.result(r);
        this.sub.schedPick = '';
        audio.play('click');
        this.renderPanel(true);
        return;
      }
      case 'sched-locked':
        this.toast(st.staff.some((x) => x.role === 'manager') ? 'Today and tomorrow are locked in. Your manager handles call-offs; plan two or more days ahead.' : 'Today and tomorrow are locked in. Plan two or more days ahead.', 'info');
        return;
      case 'sched-copy':
        return this.result(A.copyShiftsToWeek(st));
      case 'sched-suggest':
        return this.result(A.suggestSchedule(s, st));
      case 'delivery-toggle':
        return this.result(A.toggleDelivery(st));
      case 'sched-auto':
        return this.result(A.setAutoSchedule(s, st, !st.autoSchedule));
      case 'job-ad':
        return this.result(A.postJobAd(s, st));
      case 'bonus':
        return this.result(A.giveBonus(s, st, id));
      // ---- stock
      case 'cart': {
        const cart = this.cart(st);
        const k = d.k as IngId;
        cart[k] = Math.max(0, (cart[k] ?? 0) + Number(d.d));
        if (!cart[k]) delete cart[k];
        audio.play('click');
        this.renderPanel(true);
        return;
      }
      case 'cart-set': {
        const cart = this.cart(st);
        const k = d.k as IngId;
        const v = Math.max(0, Math.round(parseFloat(d.v ?? '0') || 0));
        if (v) cart[k] = v;
        else delete cart[k];
        this.renderPanel(true);
        return;
      }
      case 'reorder-mode':
        st.reorderMode = d.v === 'par' ? 'par' : 'forecast';
        if (st.reorderMode === 'par' && !Object.keys(st.par).length) this.onAct('par-suggest', {});
        this.renderPanel(true);
        return;
      case 'cart-suggest':
        this.carts.set(st.id, suggestOrder(s, st));
        this.renderPanel(true);
        return;
      case 'cart-clear':
        this.carts.set(st.id, {});
        this.renderPanel(true);
        return;
      case 'order': {
        const r = A.orderSupplies(s, st, this.cart(st), d.express === '1');
        if (r.ok) this.carts.set(st.id, {});
        return this.result(r);
      }
      case 'supplier':
        return this.result(A.setSupplier(st, d.v as SupplierId));
      case 'auto-toggle':
        st.autoReorder = !st.autoReorder;
        if (st.autoReorder && !Object.keys(st.par).length) this.onAct('par-suggest', {});
        this.renderPanel(true);
        return;
      case 'par':
        A.setPar(st, d.k as IngId, (st.par[d.k as IngId] ?? 0) + Number(d.d));
        this.renderPanel(true);
        return;
      case 'buffer':
        st.orderBuffer = d.v === 'auto' ? null : Number(d.v);
        this.renderPanel(true);
        this.updateCta();
        return;
      case 'mgr-truck':
        st.mgrOrders.truck = !st.mgrOrders.truck;
        this.renderPanel(true);
        return;
      case 'mgr-express':
        st.mgrOrders.express = !st.mgrOrders.express;
        this.renderPanel(true);
        return;
      case 'mgr-limit':
        st.mgrOrders.limit = Math.max(50, Math.min(1000, st.mgrOrders.limit + Number(d.d)));
        this.renderPanel(true);
        return;
      case 'par-suggest':
        for (const k of neededIngredients(s, st)) A.setPar(st, k, Math.ceil((estimateDailyNeed(s, st, k, 'tomorrow') * bufferMult(st)) / 5) * 5);
        this.renderPanel(true);
        return;
      // ---- menu
      case 'menu-toggle':
        return this.result(A.toggleItem(s, st, d.id as ItemId));
      case 'price':
        A.setPrice(st, d.id as ItemId, Math.round((st.menu[d.id as ItemId].price + Number(d.d)) * 4) / 4);
        audio.play('click');
        this.renderPanel(true);
        return;
      case 'price-set':
        return this.result(A.setPrice(st, d.id as ItemId, parseFloat(d.v ?? '')));
      case 'special-add':
        this.sub.spEdit = '';
        return this.result(A.addSpecial(s, st, d.id as ItemId, d.w as SpecialWindow, Number(d.p)));
      case 'special-clear':
        return this.result(A.addSpecial(s, st, d.id as ItemId, 'all', 25, true));
      case 'special-end':
        return this.result(A.removeSpecial(st, d.id as ItemId));
      case 'unlock':
        return this.result(A.unlockRecipe(s, d.id as ItemId));
      // ---- upgrades & marketing
      case 'upgrade': {
        // spending the truck money? check first (unless they said buy anyway)
        if (d.force !== '1') {
          const w = this.truckWarning(s, st, d.id as UpgradeId);
          if (w) {
            this.pendingBuy = { id: d.id as UpgradeId, ...w };
            this.openModal('buycheck');
            return;
          }
        }
        if (this.modal === 'buycheck') {
          this.modal = null;
          this.renderModal();
        }
        const r = A.buyUpgrade(s, st, d.id as UpgradeId);
        if (r.ok) {
          audio.play('ding');
          setTimeout(() => this.world.installPuff(), 60);
        }
        return this.result(r);
      }
      case 'campaign':
        return this.result(A.runCampaign(s, st, d.id as CampaignId));
      case 'loyalty':
        return this.result(A.buyLoyalty(s));
      // ---- finance & empire
      case 'loan':
        return this.result(A.takeLoan(s, Number(d.v)));
      case 'repay':
        return this.result(A.repayLoan(s));
      case 'goto-store':
        this.storeIdx = Math.max(0, s.stores.findIndex((x) => x.id === id));
        this.renderPanel(true);
        return;
      case 'buy-location': {
        const r = A.buyLocation(s, d.id as LocationId);
        if (r.ok) {
          this.storeIdx = s.stores.length - 1;
          audio.play('levelup');
          setTimeout(() => this.world.celebrate(), 120);
        }
        return this.result(r);
      }
    }
    void el;
  }

  /** Ingredients each store will likely run out of today (cached briefly; the forecast is not free). */
  private lowCache: { at: number; v: { st: Store; k: IngId; have: number; need: number; at: number | null }[] } = { at: -1, v: [] };
  lowStock(s: GameState, fresh = false) {
    const nowT = performance.now();
    if (!fresh && nowT - this.lowCache.at < 1500) return this.lowCache.v;
    const out: { st: Store; k: IngId; have: number; need: number; at: number | null }[] = [];
    if (s.phase === 'prep' || s.phase === 'open') {
      for (const st of s.stores) {
        for (const k of neededIngredients(s, st)) {
          const need = estimateDailyNeed(s, st, k, 'today');
          const have = stockOf(st, k);
          const at = runsOutAt(s, st, k);
          if (need > 0 && at !== null && at < 21.5 * 60) out.push({ st, k, have, need, at });
        }
      }
    }
    this.lowCache = { at: nowT, v: out };
    return out;
  }

  private pendingBuy: { id: UpgradeId; truck: number; cost: number; when: 'today' | 'tomorrow' } | null = null;

  /**
   * Would this upgrade leave too little cash for the truck? Before opening it's this morning's
   * truck (if not ordered yet); later in the day it's tomorrow's, plus tonight's wages and rent.
   */
  private truckWarning(s: GameState, st: Store, id: UpgradeId): { truck: number; cost: number; when: 'today' | 'tomorrow' } | null {
    const cost = A.upgradeCost(s, st, id);
    if (cost === null || cost > s.cash) return null;
    const price = (lines: Partial<Record<IngId, number>>) => (Object.entries(lines) as [IngId, number][]).reduce((a, [k, q]) => a + ingredientPrice(s, st, k) * q, 0);
    if (s.phase === 'prep') {
      if (st.truckDay === s.day) return null;
      const truck = s.stores.reduce((a, x) => a + price(truckLines(s, x)), 0);
      return truck > 20 && s.cash - cost < truck * 1.1 ? { truck, cost, when: 'today' } : null;
    }
    // later: tomorrow's truck, and tonight's bills come first if the doors are still open
    const truck = s.stores.reduce((a, x) => a + price(suggestOrder(s, x, 'tomorrow')), 0);
    const bills = s.phase === 'report' ? 0 : s.stores.reduce((a, x) => a + dailyWages(x) + LOC[x.locationId].rent, 0);
    return truck > 20 && s.cash - cost < truck * 1.1 + bills ? { truck: truck + bills, cost, when: 'tomorrow' } : null;
  }

  private buyCheckModal(s: GameState) {
    const b = this.pendingBuy!;
    const st = this.store();
    const name = UPG[b.id].levels[st.upgrades[b.id] + 1]?.name ?? UPG[b.id].name;
    const left = s.cash - b.cost;
    return `<div class="modal" role="dialog" aria-label="Before you buy">
      <h2>${b.when === 'today' ? 'Place your truck order first?' : 'Keep enough for tomorrow?'}</h2>
      <p>${esc(name)} costs <b>${money(b.cost)}</b>, which leaves <b class="${left < b.truck ? 'neg' : ''}">${money(left)}</b>. ${b.when === 'today' ? `This morning's truck needs about <b>${money(b.truck)}</b>, and running out of dough mid-rush costs more than waiting a day for the upgrade.` : `Tomorrow's truck${s.phase === 'report' ? '' : ' plus tonight\'s wages and rent'} comes to about <b>${money(b.truck)}</b>.`}</p>
      <div class="btns" style="flex-direction:column">
        ${b.when === 'today' ? '<button class="btn buy block" data-act="buycheck-truck">Order the truck first</button>' : ''}
        <button class="btn block" data-act="upgrade" data-id="${b.id}" data-force="1">Buy it anyway</button>
        <button class="btn block" data-act="close-modal">Not now</button>
      </div>
    </div>`;
  }

  /** The morning truck hasn't been ordered (or confirmed) and the forecast + buffer still needs stock. */
  private truckDue(s: GameState) {
    return s.phase === 'prep' && s.stores.some((x) => Object.keys(truckLines(s, x)).length > 0);
  }

  private stockCheckModal(s: GameState) {
    const low = this.lowStock(s, true);
    let cost = 0;
    const multi = s.stores.length > 1;
    let rows = '';
    const topUp = s.stores.some((x) => x.truckDay === s.day);
    for (const st of s.stores) {
      const lines = truckLines(s, st);
      for (const [k, q] of Object.entries(lines) as [IngId, number][]) {
        cost += ingredientPrice(s, st, k) * q;
        const have = stockOf(st, k);
        const need = estimateDailyNeed(s, st, k, 'today');
        rows += `<div class="spread review"><span><span class="swatch" style="display:inline-block;vertical-align:-1px;margin-right:6px;background:${ING[k].color}"></span>${esc(ING[k].name)}${multi ? ` <span class="t-meta">· ${esc(LOC[st.locationId].name)}</span>` : ''}<span class="t-meta"> · have ${have}, today ~${need}</span></span><span class="num"><b>+${q}</b></span></div>`;
      }
    }
    const st0 = this.store();
    return `<div class="modal" role="dialog" aria-label="Morning truck">
      <h2>${topUp ? 'Top-up truck' : 'Morning truck'}</h2>
      <p>${topUp ? 'Since your first order, today got bigger (more capacity, staff or a promo), so the forecast needs more.' : "The supplier's truck is at the back door."} This order covers today's forecast <b>plus ${orderBuffer(st0)}%</b> (change the buffer in Stock). It arrives before you open.</p>
      ${low.length ? `<p class="t-meta neg">Without it, ${plural(low.length, 'ingredient')} run${low.length === 1 ? 's' : ''} out today.</p>` : ''}
      <div class="ticket" style="padding:4px 12px;max-height:38vh;overflow:auto">${rows || '<p class="t-meta">Nothing needed.</p>'}</div>
      <div class="btns" style="flex-direction:column">
        <button class="btn buy block" data-act="order-and-open" ${cost > s.cash ? 'disabled' : ''}>${icon('cart', 16)}<span>Order (${money(cost)}) and open</span></button>
        <button class="btn block" data-act="order-truck" ${cost > s.cash ? 'disabled' : ''}>Order it, but stay in prep</button>
        <button class="btn block" data-act="goto-stock">Adjust the order myself</button>
        <button class="btn block" data-act="truck-skip">No truck needed today</button>
      </div>
      ${cost > s.cash ? `<p class="t-meta neg">Not enough cash for the full order.</p><div class="btns" style="flex-direction:column;margin-top:0"><button class="btn gold block" data-act="order-afford">Order what I can afford (${money(Math.max(0, s.cash - 20))})</button><button class="btn block" data-act="goto-bank">See loans (Money → Bank)</button></div>` : ''}
    </div>`;
  }

  /** Today's or tomorrow's plan: customers, stock, staff and promo at a glance, plus the quick start. */
  private planModal(s: GameState) {
    return planModalHtml(s, this.store(), s.phase === 'report' ? 'tomorrow' : 'today');
  }

  /** The quick start: order the morning truck (or what you can afford) and open the doors. */
  private finishQuickGo() {
    const s = this.s!;
    this.quickGo = false;
    if (s.phase !== 'prep') return;
    if (!this.truckDue(s)) return this.onAct('open', { force: '1' });
    const cost = s.stores.reduce((a, x) => a + Object.entries(truckLines(s, x)).reduce((b, [k, q]) => b + ingredientPrice(s, x, k as IngId) * (q ?? 0), 0), 0);
    if (cost <= s.cash) return this.onAct('order-and-open', {});
    this.onAct('order-afford', {});
    this.onAct('open', { force: '1' });
  }

  private openFromPick(tag: string) {
    if (tag.startsWith('staff')) return this.openTab('staff');
    const map: Record<string, [TabId, string | null]> = {
      oven: ['upgrades', 'oven'], prep: ['upgrades', 'prep'], register: ['upgrades', 'register'], storage: ['stock', null], dining: ['upgrades', 'dining'],
      decor: ['upgrades', 'decor'], sign: ['marketing', null], delivery: ['upgrades', 'delivery'], menu: ['menu', null], cleaning: ['upgrades', 'cleaning'], breakroom: ['upgrades', 'breakroom'],
    };
    const m = map[tag];
    if (!m) return;
    this.focusUpgrade = m[1];
    this.openTab(m[0]);
    if (m[1]) setTimeout(() => document.getElementById('up-' + m[1])?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
  }

  private pickLabel(tag: string): string {
    const st = this.store();
    if (tag.startsWith('staff:')) {
      const x = st.staff.find((q) => 'staff:' + q.id === tag);
      return x ? `${x.name} · ${x.role} · morale ${Math.round(x.morale)}` : '';
    }
    const u = (id: UpgradeId) => `${UPG[id].levels[st.upgrades[id]].name} · click to upgrade`;
    switch (tag) {
      case 'oven': return `${u('oven')} (${itemsInStage(st, 'baking')}/${ovenSlots(st)} baking)`;
      case 'prep': return u('prep');
      case 'register': return u('register');
      case 'storage': return `${UPG.storage.levels[st.upgrades.storage].name} · click to order stock`;
      case 'dining': return `${seatsTotal(st)} seats · click to upgrade`;
      case 'decor': return u('decor');
      case 'sign': return `${UPG.sign.levels[st.upgrades.sign].name} · click for marketing`;
      case 'delivery': return u('delivery');
      case 'menu': return 'Menu & prices';
      case 'cleaning': return u('cleaning');
      case 'breakroom': return u('breakroom');
      case 'staff': return 'Manager desk · staff';
    }
    return '';
  }

  // =============================================================== game lifecycle

  private startNewGame(name: string, diff: Difficulty) {
    this.s = createGame(name, diff, (Date.now() ^ Math.floor(Math.random() * 1e9)) | 0);
    this.enterGame();
    this.toast('Welcome! Morning prep: the clock is stopped. Hire someone for the front of house, check your stock, then open the doors.', 'gold');
    setTimeout(() => this.openTab('goals'), 300);
  }

  private enterGame() {
    this.titleView = null;
    this.modal = null;
    this.tab = null;
    this.storeIdx = 0;
    this.speed = 1;
    this.paused = this.s!.phase !== 'open' && this.s!.phase !== 'closing';
    this.carts.clear();
    outbox.length = 0;
    this.world.reset();
    this.world.envOverride = null;
    this.world.controls.autoRotate = 0;
    this.world.controls.reset();
    this.shownCash = this.s!.cash;
    this.lastPhase = '';
    $('#hud').hidden = false;
    $('#camctl').hidden = false;
    $('#rail').hidden = false;
    this.refreshTitle();
    this.renderModal();
    this.closePanel();
    if (this.s!.phase === 'report' && this.s!.report) this.openModal('report');
    else if (this.s!.choice) this.openModal('choice');
    else if (this.s!.gameOver) this.openModal('gameover');
    audio.setMusic(this.settings.music);
  }

  private toTitle() {
    this.s = null;
    this.titleView = 'main';
    this.modal = null;
    this.closePanel();
    $('#hud').hidden = true;
    $('#camctl').hidden = true;
    $('#rail').hidden = true;
    $('#floor').hidden = true;
    $('#cta').hidden = true;
    $('#paused-badge').hidden = true;
    this.world.reset();
    this.world.envOverride = 19 * 60 + 50;
    this.world.controls.autoRotate = 0.05;
    this.renderModal();
    this.refreshTitle();
  }

  /** Developer helper: fast-forward the current day (used by automated tests). */
  skip(minutes: number) {
    if (this.s) advance(this.s, minutes);
  }

  serialize(s: GameState) {
    return JSON.stringify(s);
  }

  loadState(s: GameState) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.stores)) throw new Error('Not a Pizza SIM save');
    if ((s.version ?? 0) > SAVE_VERSION) throw new Error('Save is from a newer version');
    migrate(s);
    this.s = s;
    this.enterGame();
  }

  /** Set when a save couldn't be written anywhere, so the warning shows once, not every autosave. */
  private saveWarned = false;
  /** Whether this browser can keep saves at all (checked once on the title screen). */
  private storageOk: boolean | undefined;
  async save(slot: string): Promise<boolean> {
    const s = this.s;
    if (!s) return false;
    const r = await saves.save({
      meta: { slot, savedAt: Date.now(), company: s.company, day: s.day, cash: Math.round(s.cash), level: s.level, stores: s.stores.length },
      data: this.serialize(s),
    });
    if (!r.ok && !this.saveWarned) {
      this.saveWarned = true;
      this.toast("This browser won't let the game save right now (private mode, full storage, or blocked site data). Use Download save in the menu to keep your progress as a file.", 'bad');
    }
    if (r.ok) this.saveWarned = false;
    return r.ok;
  }

  private fileInput: HTMLInputElement | null = null;
  /** Hidden file picker for loading save files. */
  private importInput() {
    if (this.fileInput) return this.fileInput;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json,text/plain';
    inp.style.display = 'none';
    inp.addEventListener('change', async () => {
      const file = inp.files?.[0];
      inp.value = '';
      if (!file) return;
      try {
        const r = await readSaveFile(file);
        const state = JSON.parse(r.data) as GameState;
        this.loadState(state);
        await this.save('auto');
        this.toast(`Loaded ${state.company}, day ${state.day}, from your save file.`, 'good');
      } catch (e) {
        this.toast((e as Error).message || "That file couldn't be loaded.", 'bad');
      }
    });
    document.body.appendChild(inp);
    this.fileInput = inp;
    return inp;
  }

  private async loadSlot(slot: string) {
    const f = await saves.load(slot);
    if (!f) return this.toast('That save could not be read.', 'bad');
    try {
      this.loadState(JSON.parse(f.data));
      this.toast(`Loaded ${f.meta.company}, day ${f.meta.day}.`, 'good');
    } catch (e) {
      this.toast('That save could not be read: ' + String((e as Error).message), 'bad');
    }
  }

  private async refreshTitle() {
    const t = $('#title');
    if (!this.titleView) {
      t.hidden = true;
      return;
    }
    t.hidden = false;
    this.saveList = await saves.list();
    this.storageOk ??= await saves.healthy();
    if (this.titleView === 'main') {
      const where = this.storageOk ? saves.where : "⚠ This browser isn't keeping saves (private window or blocked site data). Use Download save in the pause menu";
      t.innerHTML = S.titleScreen({ latest: this.saveList[0] ?? null, hasSaves: this.saveList.length > 0, where, desktop: !!native() });
    } else if (this.titleView === 'new') {
      if (!t.querySelector('[data-form="new-game"]')) t.innerHTML = S.newGameScreen(this.newName, this.newDiff);
      else {
        t.innerHTML = S.newGameScreen(this.newName, this.newDiff);
      }
      const inp = $('#ng-name', t) as HTMLInputElement;
      if (inp && !matchMedia('(pointer: coarse)').matches) inp.focus();
    } else {
      t.innerHTML = S.loadScreen(this.saveList, this.loadFromGame && !!this.s);
    }
  }

  // =============================================================== settings

  private applySettings() {
    const st = this.settings;
    storeSettings(st);
    audio.enabled = st.sound;
    audio.setVolume(st.volume);
    if (audio.ctx) audio.setMusic(st.music);
    else audio.musicOn = st.music;
    if (this.world) {
      this.world.opts.shadows = st.shadows;
      this.world.opts.floatingText = st.floatingText;
      const mobile = Math.min(window.innerWidth, window.innerHeight) < 600;
      this.world.opts.maxDpr = st.quality === 'low' ? 1 : mobile ? 1.75 : 2;
      this.world.renderer.setShadowSize(st.quality === 'low' ? 1024 : mobile ? 1024 : 2048);
      this.world.renderer.postOpts.enabled = st.quality === 'high';
      PEOPLE_DETAIL.high = st.quality === 'high';
      this.world.opts.detail = st.quality === 'high';
      this.world.controls.dragRotates = st.dragRotate;
      document.getElementById('camctl')?.classList.toggle('collapsed', !st.camButtons);
      this.world.resize();
    }
  }

  // =============================================================== panels

  store(): Store {
    const s = this.s!;
    if (this.storeIdx >= s.stores.length) this.storeIdx = 0;
    return s.stores[this.storeIdx];
  }
  private cart(st: Store) {
    let c = this.carts.get(st.id);
    if (!c) {
      c = {};
      this.carts.set(st.id, c);
    }
    return c;
  }

  private toggleTab(t: TabId) {
    if (this.tab === t) this.closePanel();
    else this.openTab(t);
  }
  openTab(t: TabId) {
    if (!this.s) return;
    if (this.tab !== t && t !== 'upgrades') this.focusUpgrade = null;
    this.tab = t;
    $('#panel').hidden = false;
    for (const x of TABS) $('#tab-' + x.id).setAttribute('aria-selected', String(x.id === t));
    $('#floor').classList.add('collapsed-by-panel');
    $('#camctl').classList.add('collapsed-by-panel');
    if (t === 'stock') {
      const st = this.store();
      const cart = this.cart(st);
      if (!Object.keys(cart).length && this.s.phase === 'prep') this.carts.set(st.id, suggestOrder(this.s, st));
    }
    this.renderPanel(true);
    $('#p-body').scrollTop = 0;
  }
  closePanel() {
    this.tab = null;
    $('#panel').hidden = true;
    for (const x of TABS) $('#tab-' + x.id)?.setAttribute('aria-selected', 'false');
    $('#floor').classList.remove('collapsed-by-panel');
    $('#camctl').classList.remove('collapsed-by-panel');
    $('#tip').hidden = true;
  }

  renderPanel(force = false) {
    if (!this.s || !this.tab) return;
    const now = performance.now();
    if (!force && now < this.panelAt) return;
    const body = $('#p-body');
    if (!force && body.contains(document.activeElement) && document.activeElement !== body && (document.activeElement as HTMLElement).tagName === 'INPUT') return;
    this.panelAt = now + 1000;
    const st = this.store();
    const ctx: PanelCtx = { s: this.s, st, sub: this.sub, cart: this.cart(st), confirmFire: this.confirmFire, focusUpgrade: this.focusUpgrade };
    const t = panelTitle(this.tab, this.s, st);
    $('#p-title').textContent = t.title;
    $('#p-sub').textContent = t.sub;
    const scroll = body.scrollTop;
    const openDetails = [...body.querySelectorAll('details')].map((d) => d.open);
    // keep focus on the same control after re-render
    const fa = document.activeElement as HTMLElement | null;
    const focusKey = fa && body.contains(fa) ? fa.dataset.act + '|' + (fa.dataset.id ?? fa.dataset.k ?? fa.dataset.v ?? '') + '|' + (fa.dataset.d ?? '') : null;
    const html = renderPanel(this.tab, ctx);
    if (!force && html === this.lastPanelHtml) return;
    this.lastPanelHtml = html;
    body.innerHTML = html;
    body.querySelectorAll('details').forEach((d, i) => {
      if (openDetails[i]) d.open = true;
    });
    body.scrollTop = scroll;
    if (focusKey) {
      const [a, idv, dd] = focusKey.split('|');
      const cand = [...body.querySelectorAll<HTMLElement>(`[data-act="${a}"]`)].find((n) => (n.dataset.id ?? n.dataset.k ?? n.dataset.v ?? '') === idv && (n.dataset.d ?? '') === dd);
      cand?.focus({ preventScroll: true });
    }
  }

  // =============================================================== modals

  private fbTimer = 0;
  private fbSending = false;
  private musicT = 0;
  private calDay = 0;
  private updOpen = '';
  /** The player left full screen this session: don't push them back in. */
  private fsDeclined = false;
  private saveFeedbackFromForm() {
    const ta = document.getElementById('fb-notes') as HTMLTextAreaElement | null;
    const nm = document.getElementById('fb-name') as HTMLInputElement | null;
    if (!ta) return;
    saveFeedback({ ...loadFeedback(), notes: ta.value, name: nm?.value.trim() ?? '' });
  }

  private openModal(k: ModalKind) {
    this.modal = k;
    this.renderModal();
  }
  private closeModal() {
    if (this.modal === 'settings' || this.modal === 'help' || this.modal === 'credits' || this.modal === 'feedback') {
      if (this.modalBack === 'pause' && this.s) return this.openModal('pause');
    }
    if (this.modal === 'plan' && this.s?.phase === 'report' && this.s.report) return this.openModal('report');
    this.modal = null;
    this.renderModal();
  }
  private renderModal() {
    const m = $('#modal');
    const s = this.s;
    this.updateCta();
    if (!this.modal) {
      m.hidden = true;
      m.innerHTML = '';
      this.modalShown = null;
      return;
    }
    let inner = '';
    switch (this.modal) {
      case 'report':
        if (s?.report) inner = S.reportModal(s, s.report);
        break;
      case 'choice':
        if (s?.choice) inner = S.choiceModal(s);
        break;
      case 'pause':
        inner = S.pauseModal(saves.where, !!native());
        break;
      case 'settings':
        inner = S.settingsModal(this.settings, this.modalBack === 'pause' ? 'pause' : 'close-modal');
        break;
      case 'help':
        inner = S.helpModal(this.modalBack === 'pause' ? 'pause' : 'close-modal');
        break;
      case 'credits':
        inner = S.creditsModal(this.modalBack === 'pause' ? 'pause' : 'close-modal');
        break;
      case 'calendar':
        if (s) inner = calendarModal(s, this.calDay, 'close-modal');
        break;
      case 'updates':
        inner = S.updatesModal(this.updOpen, 'credits');
        break;
      case 'feedback':
        inner = S.feedbackModal(loadFeedback(), this.modalBack === 'pause' ? 'pause' : 'close-modal');
        break;
      case 'gameover':
        if (s) inner = S.gameOverModal(s);
        break;
      case 'stockcheck':
        if (s) inner = this.stockCheckModal(s);
        break;
      case 'plan':
        if (s) inner = this.planModal(s);
        break;
      case 'notice':
        if (s?.notice) inner = S.noticeModal(s);
        break;
      case 'buycheck':
        if (s && this.pendingBuy) inner = this.buyCheckModal(s);
        break;
    }
    if (!inner) {
      this.modal = null;
      m.hidden = true;
      return;
    }
    m.hidden = false;
    // re-rendering the same modal (picking a calendar day, opening an update) keeps scroll and open sections
    const same = this.modalShown === this.modal;
    const scrollers = same ? [...m.querySelectorAll<HTMLElement>('.scrim, .modal, .receipt')].map((n) => n.scrollTop) : [];
    const opened = same ? [...m.querySelectorAll('details')].map((d) => d.open) : [];
    m.innerHTML = `<div class="scrim">${inner}</div>`;
    this.modalShown = this.modal;
    if (same) {
      m.querySelectorAll<HTMLElement>('.scrim, .modal, .receipt').forEach((n, i) => (n.scrollTop = scrollers[i] ?? 0));
      m.querySelectorAll('details').forEach((d, i) => { if (opened[i]) d.open = true; });
      return;
    }
    const first = m.querySelector<HTMLElement>('button');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus({ preventScroll: true });
  }

  // =============================================================== toasts

  /** A phone-style text bubble: the manager's message goes out, then each reply pops in. */
  textBubble(from: string, text: string, out: boolean) {
    const box = $('#texts');
    const n = document.createElement('div');
    n.className = 'text-msg ' + (out ? 'out' : 'in');
    n.innerHTML = `<b>${esc(out ? `${from} → crew` : from)}</b><span>${esc(text)}</span>`;
    box.append(n);
    audio.play(out ? 'click' : 'ding');
    while (box.children.length > 5) box.firstElementChild!.remove();
    setTimeout(() => {
      n.classList.add('gone');
      setTimeout(() => n.remove(), 400);
    }, out ? 6500 : 5500);
  }

  toast(text: string, tone: 'good' | 'bad' | 'info' | 'gold' = 'info') {
    if (!text) return;
    const box = $('#toasts');
    const n = document.createElement('div');
    n.className = 'toast ' + tone;
    const ic = tone === 'good' ? 'check' : tone === 'bad' ? 'alert' : tone === 'gold' ? 'star' : 'info';
    n.innerHTML = `<span class="dot">${icon(ic, 14)}</span><span>${esc(text)}</span>`;
    box.prepend(n);
    while (box.children.length > 4) box.lastElementChild!.remove();
    setTimeout(() => {
      n.classList.add('out');
      setTimeout(() => n.remove(), 260);
    }, tone === 'bad' ? 5200 : 4200);
  }

  private drainEvents() {
    const ev = outbox.splice(0);
    if (!this.s) {
      for (const e of ev) if (e.type === 'sale' && e.amount) this.world.floatText('+$' + e.amount.toFixed(2), '#f2b33d', e.customerId);
      return;
    }
    const cur = this.store().id;
    for (const e of ev) {
      switch (e.type) {
        case 'sale':
          if (e.storeId === cur && e.amount) {
            this.world.floatText('+$' + e.amount.toFixed(2), '#f2b33d', e.customerId);
            audio.play('cash');
          }
          break;
        case 'toast': {
          // collapse bursts of refund notices into one line
          if (e.text?.startsWith('Refunded')) {
            this.refundBurst++;
            const now = performance.now();
            if (now - this.refundToastAt < 6000) break;
            this.refundToastAt = now;
            const n = this.refundBurst;
            this.refundBurst = 0;
            this.toast(n > 1 ? `${n} customers got refunds after waiting too long.` : e.text, 'bad');
            break;
          }
          this.toast(e.text ?? '', e.tone === 'good' ? 'good' : e.tone === 'bad' ? 'bad' : 'info');
          break;
        }
        case 'levelup':
          this.toast(`${e.text} New unlocks are waiting.`, 'gold');
          audio.play('levelup');
          this.world.celebrate();
          break;
        case 'goal':
          this.toast(e.text ?? '', 'gold');
          audio.play('goal');
          this.world.celebrate();
          break;
        case 'walkout':
          if (e.storeId === cur && e.text) this.world.floatText(e.text, '#ff7a66', e.customerId);
          break;
        case 'turnaway':
          if (e.storeId === cur) this.world.passerby();
          break;
        case 'text':
          if (e.storeId === cur && e.text) this.textBubble(e.from ?? '', e.text, !!e.out);
          break;
        case 'greet':
          // not every hello needs a bubble: keep the floor readable when it's busy
          if (e.storeId === cur && e.text && Math.random() < 0.6) this.world.floatText(e.text, '#9fd6a0', e.customerId);
          break;
        case 'drop': {
          if (e.storeId !== cur) break;
          this.world.floatText(e.text ?? 'Remake!', '#ff7a66');
          this.dropBurst++;
          const t = performance.now();
          if (t - this.dropToastAt > 20000 && this.dropBurst >= 3) {
            this.dropToastAt = t;
            this.toast(`${this.dropBurst} pizzas remade recently. Green or worn-out crew slip up more; training helps.`, 'bad');
            this.dropBurst = 0;
          }
          break;
        }
      }
    }
  }

  // =============================================================== HUD & floor

  private updateHud(dt: number) {
    const s = this.s!;
    const st = this.store();
    // cash count-up
    const diff = s.cash - this.shownCash;
    this.shownCash += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 8);
    const cashEl = $('#h-cash');
    cashEl.textContent = money(this.shownCash);
    cashEl.classList.toggle('neg', s.cash < 0);
    const storeKey = s.company + '|' + s.stores.length + '|' + this.storeIdx;
    if (storeKey !== this.lastStoreKey) {
      this.lastStoreKey = storeKey;
      $('#h-name').textContent = s.company;
      $('#h-store').innerHTML = s.stores.length > 1
        ? `<select id="h-select" class="store-select" aria-label="Store">${s.stores.map((x, i) => `<option value="${i}" ${i === this.storeIdx ? 'selected' : ''}>${esc(LOC[x.locationId].name)}</option>`).join('')}</select>`
        : `<span class="store-loc">${esc(loc(st).name)}</span>`;
    }
    const sel = document.getElementById('h-select') as HTMLSelectElement | null;
    if (sel && sel.value !== String(this.storeIdx)) sel.value = String(this.storeIdx);
    $('#h-day').textContent = `Day ${s.day} · ${DAY_NAMES[(s.day - 1) % 7]}`;
    const phaseText = s.phase === 'prep' ? 'Morning prep' : s.phase === 'report' ? 'Closed' : clock(s.minute);
    const clk = $('#h-clock');
    if (s.weather !== this.lastWeather || clk.dataset.t !== phaseText) {
      this.lastWeather = s.weather;
      clk.dataset.t = phaseText;
      clk.innerHTML = `${icon(s.weather, 16)}<span>${phaseText}</span>`;
      clk.title = WEATHER[s.weather].name;
    }
    const rk = st.rating.toFixed(2);
    if (rk !== this.lastRatingKey) {
      this.lastRatingKey = rk;
      $('#h-rating').innerHTML = pizzaRating(st.rating, 40);
    }
    const cur = xpForLevel(s.level), next = xpForLevel(s.level + 1);
    $('#h-level').textContent = `Level ${s.level}`;
    ($('#h-xp') as HTMLElement).style.width = `${Math.min(100, ((s.xp - cur) / (next - cur)) * 100)}%`;
    // time only runs while open and nothing is in the way; the selector shows exactly that
    const running = this.isRunning();
    $('#sp-0').setAttribute('aria-pressed', String(!running));
    for (const v of SPEEDS) $('#sp-' + v).setAttribute('aria-pressed', String(running && this.speed === v));
    const userPaused = this.paused && (s.phase === 'open' || s.phase === 'closing') && !this.modal && !this.titleView;
    $('#paused-badge').hidden = !userPaused;
    $('#view').classList.toggle('frozen', userPaused);
  }

  private updateFloor() {
    const s = this.s!;
    const st = this.store();
    const f = $('#floor');
    if (s.phase === 'report' || s.phase === 'prep' || this.titleView) {
      f.hidden = true;
      this.updateBadges(s, this.store());
      return;
    }
    f.hidden = false;
    const snap = serviceSnapshot(st);
    const slots = ovenSlots(st);
    const onFloor = st.staff.filter((x) => x.onFloor);
    const front = onFloor.filter((x) => x.role === 'front' || x.role === 'manager').length;
    const cooks = onFloor.filter((x) => x.role === 'cook').length;
    const drivers = onFloor.filter((x) => x.role === 'driver').length;
    const quote = quotedWait(s, st);
    // stage loads: how far behind each part of the service is (1 = keeping up, >1 = falling behind)
    const stages = [
      { k: 'line', label: 'Line', v: `${snap.line}`, load: snap.line / Math.max(1, tills(st) + kioskCount(st)) / 3, why: 'Customers waiting to order', fix: 'More front-of-house staff on the till, more tills or a kiosk.' },
      { k: 'kitchen', label: 'Make line', v: `${snap.toMake + snap.making}`, load: (snap.toMake + snap.making) / Math.max(1, Math.min(cooks, up(st, 'prep').stations ?? 1) * 3), why: 'Pizzas waiting to be built', fix: 'More kitchen crew or make-line stations.' },
      { k: 'oven', label: 'Oven', v: `${snap.baking}/${slots}${snap.ovenWait ? ` +${snap.ovenWait}` : ''}`, load: (snap.baking + snap.ovenWait) / slots / 1.4, why: 'Pizzas waiting for oven space', fix: 'A bigger oven.' },
      { k: 'run', label: 'To serve', v: `${snap.toRun}`, load: snap.toRun / Math.max(1, front) / 1.5, why: 'Finished food waiting for a runner', fix: 'More front-of-house staff to run food.' },
      { k: 'tables', label: 'Dirty tables', v: `${snap.dirty}`, load: snap.dirty / Math.max(1, (seatsTotal(st) / 2) * 0.5), why: 'Tables waiting to be cleared', fix: 'More front-of-house time, a dishwasher.' },
    ];
    if (st.upgrades.delivery > 0) stages.push({ k: 'delivery', label: 'Deliveries', v: `${snap.toDeliver}`, load: snap.toDeliver / Math.max(1, drivers * (up(st, 'delivery').vehicleCap ?? 1)) / 1.5, why: 'Boxes waiting for a driver', fix: 'More drivers or a bigger vehicle.' });
    const worst = stages.reduce((a, b) => (b.load > a.load ? b : a), stages[0]);
    const bar = (x: (typeof stages)[number]) => {
      const tone = x.load > 1 ? 'bad' : x.load > 0.6 ? 'warn' : 'good';
      return `<div class="stage ${x === worst && x.load > 0.6 ? 'hot' : ''}" title="${esc(x.why)}"><span class="hud-label">${x.label}</span><span class="hud-value">${x.v}</span>${meter(Math.min(1, x.load), 1, tone).replace('class="meter', 'class="meter thin')}</div>`;
    };
    let alert = '';
    let tone = '';
    const need = neededIngredients(s, st);
    const empty = need.filter((k) => stockOf(st, k) === 0);
    const low = this.lowStock(s).filter((x) => x.st === st && x.at !== null && x.at < s.minute + 120);
    if (!onFloor.length) alert = s.phase === 'closing' ? '' : 'Nobody is on the floor. Check shifts and hire staff.';
    else if (empty.length) alert = `Out of ${empty.map((k) => ING[k].name.toLowerCase()).slice(0, 2).join(' & ')}. Express order from Stock!`;
    else if (low.length) alert = `${ING[low[0].k].name} runs out around ${clock(low[0].at!)}. Order express from Stock.`;
    else if (worst.load > 1) alert = `Bottleneck: ${worst.why.toLowerCase()}. ${worst.fix}`;
    else if (st.cleanliness < 45) alert = 'The store is dirty. Front-of-house staff clean when they have a spare minute.';
    else if (st.upgrades.delivery > 0 && !drivers && s.phase === 'open') alert = 'You own a delivery vehicle but no driver is on shift.';
    if (st.inspector) {
      tone = 'info';
      alert = `${INSPECTOR_NAME} is inspecting until ${clock(st.inspector.until - s.day * 1440)}.${alert ? ' ' + alert : ''}`;
    }
    // a manager on shift can text the crew when it gets hectic
    const mgrHere = M.managerOnFloor(st);
    const hectic = worst.load > 0.9 || snap.line >= 5;
    const canAsk = mgrHere && s.phase === 'open' && !M.helpBlocked(s, st);
    const helpBtn = mgrHere && s.phase === 'open' && (hectic || st.helpMsg?.day === s.day)
      ? `<button class="btn tiny ${canAsk && hectic ? 'gold' : ''}" data-act="ask-help" ${canAsk ? '' : 'disabled'} title="${esc(M.helpBlocked(s, st) ?? `${mgrHere.name} texts people who are off to come in for the rush`)}">${icon('staff', 13)} Message the crew</button>`
      : '';
    // the main card redraws every tick; the button lives in its own box so taps never get lost
    let main = f.querySelector<HTMLElement>('.floor-main');
    let actBox = f.querySelector<HTMLElement>('.floor-act');
    if (!main || !actBox) {
      f.innerHTML = '<div class="floor-main"></div><div class="floor-act"></div>';
      main = f.querySelector<HTMLElement>('.floor-main')!;
      actBox = f.querySelector<HTMLElement>('.floor-act')!;
    }
    if (actBox.dataset.key !== helpBtn) {
      actBox.dataset.key = helpBtn;
      actBox.innerHTML = helpBtn;
    }
    main.innerHTML = `<div class="stages">${stages.map(bar).join('')}</div>
      <div class="floor-meta"><span>Quoted wait <b class="num">${Math.round(quote)} min</b></span><span>Served <b class="num">${st.today.served}</b></span><span>Lost <b class="num">${st.today.lost + st.today.turnedAway}</b></span><span>Clean <b class="num">${Math.round(st.cleanliness)}%</b></span></div>
      <div class="alert ${alert ? tone : 'ok'}">${icon(alert ? (tone ? 'info' : 'alert') : 'check', 14)}<span>${esc(alert || (s.phase === 'closing' ? 'Doors closed. Finishing the last orders.' : 'Running smoothly.'))}</span></div>`;
    this.updateBadges(s, st);
  }

  private updateBadges(s: GameState, st: Store) {
    const badge = (t: TabId, on: boolean) => {
      const b = $('#tab-' + t);
      const has = b.querySelector('.badge');
      if (on && !has) b.insertAdjacentHTML('beforeend', '<span class="badge"></span>');
      if (!on && has) has.remove();
    };
    badge('stock', this.lowStock(s).some((x) => x.st === st));
    badge('staff', !st.staff.some((x) => x.role === 'front') || st.staff.some((x) => x.morale < 30));
    badge('goals', s.phase === 'prep' && s.day === 1 && s.goalsDone.length < 2);
  }

  private updateCta() {
    const c = $('#cta');
    const s = this.s;
    if (!s || this.titleView || this.modal || (s.phase !== 'prep' && s.phase !== 'report')) {
      c.hidden = true;
      return;
    }
    c.hidden = false;
    if (s.phase === 'report') {
      // The receipt was closed (to check panels, the plan, etc.): always keep a way to start tomorrow.
      const key = `report|${s.day}|${!!s.gameOver}`;
      if (c.dataset.key !== key) {
        c.dataset.key = key;
        c.innerHTML = `<div class="prep-card" role="status">
          <span class="chip">${icon('check', 13)} Day ${s.day} is done</span>
          <button class="chip" data-act="receipt">${icon('finance', 13)} View receipt</button>
          <button class="chip" data-act="plan">${icon(s.forecast, 13)} Tomorrow's plan</button>
        </div>
        ${s.gameOver ? '<button class="btn red big-cta" data-act="game-over">See what happened</button>' : `<button class="btn red big-cta" data-act="plan">${icon('door', 22)} Plan and open day ${s.day + 1}</button>`}`;
      }
      return;
    }
    const st = this.store();
    const low = this.lowStock(s).length;
    const staff = activeStaff(st).length;
    const shifts = st.staff.map((x) => x.shift + x.offToday + x.status + x.skill).join('');
    const truck = this.truckDue(s);
    const key = `${s.day}|${low}|${truck}|${orderBuffer(st)}|${staff}|${s.weather}|${this.storeIdx}|${shifts}|${Object.values(st.upgrades).join('')}|${Math.round(st.rating * 10)}`;
    if (c.dataset.key !== key) {
      c.dataset.key = key;
      const plan = daySummary(s, st, 'today');
      const short = plan.missed > 3 && plan.limit;
      const soon = shortages(s).find((x) => x.phase === 'now' || x.inDays <= 2);
      const fixed = s.stores.reduce((a, x) => a + dailyWages(x) + LOC[x.locationId].rent, 0);
      const tight = !s.loan && s.cash < fixed * 2;
      const todo = (low ? 1 : 0) + (short ? 1 : 0) + (staff ? 0 : 1) + (soon ? 1 : 0);
      c.innerHTML = `<div class="prep-card" role="status">
        <button class="chip plan-chip ${todo ? 'warn' : 'good'}" data-act="plan">${icon(todo ? 'info' : 'check', 13)} <b>Today's plan</b>${todo ? ` · ${todo} to check` : ' · ready'}</button>
        <button class="chip ${staff ? 'good' : 'bad'}" data-act="tab" data-tab="staff">${icon('staff', 13)} ${staff} working today</button>
        <button class="chip ${low ? 'bad' : truck ? 'warn' : 'good'}" data-act="tab" data-tab="stock">${icon('stock', 13)} ${low ? `${low} item${low > 1 ? 's' : ''} will run out` : truck ? 'Truck not ordered yet' : st.truckDay === s.day ? 'Truck ordered' : 'No truck needed'}</button>
        <button class="chip ${short ? 'warn' : 'good'}" data-act="plan" title="Hour-by-hour plan">${icon('finance', 13)} ~${Math.round(plan.demand)} expected${short ? ` · room for ~${Math.round(plan.served)}` : ''}</button>
        <span class="chip">${icon(s.weather, 13)} ${WEATHER[s.weather].name}</span>
        ${tight ? `<button class="chip bad" data-act="goto-bank">${icon('finance', 13)} Cash is tight: loans in Money → Bank</button>` : ''}
        <button class="chip" data-act="calendar">${icon('calendar', 13)} Calendar</button>
        ${soon ? `<button class="chip ${soon.phase === 'now' ? 'bad' : 'warn'}" data-act="tab" data-tab="stock" title="${esc(shortageAdvice(s, soon, st))}">${icon('alert', 13)} ${esc(soon.phase === 'coming' && soon.inDays <= 1 ? `${shortageChip(s, soon)}: stock up now` : shortageChip(s, soon))}</button>` : ''}
      </div>
      <button class="btn red big-cta" data-act="open">${icon('door', 22)} Open for business</button>`;
    }
  }

  private isRunning() {
    const s = this.s;
    return !!s && !this.paused && !this.modal && !this.titleView && (s.phase === 'open' || s.phase === 'closing') && !s.choice && !s.notice;
  }

  // =============================================================== loop

  private frame = (t: number) => {
    const dt = Math.min(0.1, Math.max(0, (t - (this.lastT || t)) / 1000));
    this.lastT = t;
    try {
      const s = this.s;
      if (s) {
        const running = this.isRunning();
        if (running) advance(s, dt * this.speed * MIN_PER_SEC);
        // music follows how backed up the shop is
        this.musicT += dt;
        if (this.musicT > 0.5) {
          this.musicT = 0;
          let x = 0;
          if (s.phase === 'open' || s.phase === 'closing') {
            for (const st of s.stores) {
              const line = st.customers.filter((c) => c.state === 'queue' || c.state === 'enter').length;
              const q = quotedWait(s, st);
              const waiting = st.orders.filter((o) => o.state === 'kitchen').length;
              x = Math.max(x, (line / 8) * 0.5 + Math.max(0, q - 12) / 25 * 0.3 + Math.min(1, waiting / 10) * 0.2);
            }
          }
          audio.setIntensity(x);
        }
        if (s.phase !== this.lastPhase) {
          if (s.phase === 'report' && s.report) {
            this.paused = true;
            this.openModal('report');
            audio.play('close');
          }
          this.lastPhase = s.phase;
          this.updateCta();
        }
        if (s.choice && this.modal !== 'choice' && !this.titleView && this.modal !== 'report') this.openModal('choice');
        if (s.notice && !this.modal && !this.titleView) {
          const target = s.stores.findIndex((x) => x.id === s.notice!.storeId);
          if (target >= 0) this.storeIdx = target;
          this.openModal('notice');
          audio.play('ding');
        }
        this.drainEvents();
        this.updateHud(dt);
        if (t - this.hudAt > 250) {
          this.hudAt = t;
          this.updateFloor();
          this.updateCta();
        }
        this.renderPanel(false);
        this.world.frame(s, this.store(), dt, running ? this.speed * MIN_PER_SEC : 0);
      } else {
        const d = this.demo;
        advance(d, dt * MIN_PER_SEC * 1.5);
        d.notice = null;
        d.choice = null;
        if (d.phase === 'closing' || d.minute > 21 * 60) {
          d.minute = 17 * 60;
          d.phase = 'open';
        }
        this.drainEvents();
        this.world.frame(d, d.stores[0], dt, MIN_PER_SEC * 1.5);
      }
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(this.frame);
  };
}

export { plural };
