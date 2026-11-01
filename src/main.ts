// Entry point. Boots the app and wires the artifact viewer's hot-reload hook
// (absent everywhere else) so a republish keeps the current game.
import { App } from './ui/app';
import { audio } from './platform/audio';

type Hot = {
  ready?: (cb: (data: Record<string, unknown>) => void) => void;
  snapshot?: (fn: () => Record<string, unknown>) => void;
  data?: Record<string, unknown>;
};

function start(data: Record<string, unknown> = {}) {
  const el = document.getElementById('app');
  if (!el) return;
  const app = new App(el);
  (window as unknown as { pizza: App }).pizza = app;
  (window as unknown as { __audio: unknown }).__audio = audio;
  const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
  hot?.snapshot?.(() => ({ save: app.s ? app.serialize(app.s) : null }));
  if (typeof data.save === 'string') {
    try {
      app.loadState(JSON.parse(data.save));
    } catch {
      /* start fresh */
    }
  }
}

const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
