// Playtester feedback: notes kept on this device between sessions, sent to the studio by email
// through FormSubmit as a short table: From, Notes, Game, Device, Version.
import { FEEDBACK_TO, VERSION } from '../data/meta';

const KEY = 'pizzasim.feedback.v1';

export interface FeedbackDraft {
  name: string;
  notes: string;
  /** When notes were last sent (ms), and how many times. */
  sentAt?: number;
  sentCount?: number;
}

export function loadFeedback(): FeedbackDraft {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { name: '', notes: '', ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { name: '', notes: '' };
}

export function saveFeedback(d: FeedbackDraft) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: notes live until the page closes */
  }
}

/** Email subject and body for the notes plus a little context (version, day, device). */
export function feedbackEmail(d: FeedbackDraft, context: Record<string, string>) {
  const now = new Date();
  const stamp = `${now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  const subject = `Playtest notes · ${stamp}${d.name.trim() ? ` · ${d.name.trim()}` : ''}`;
  const ctx = Object.entries(context).map(([k, v]) => `${k}: ${v}`).join('\n');
  const body = `${d.notes.trim()}\n\n--\n${d.name ? `From: ${d.name}\n` : ''}Version: ${VERSION}\n${ctx}`;
  return { subject, body };
}

export interface SendResult {
  ok: boolean;
  msg: string;
  /** FormSubmit wants the studio to confirm the address for this website first: nothing was delivered yet. */
  pending?: boolean;
}

/**
 * Send the notes straight to the studio from inside the game, through FormSubmit (a free
 * form-to-email relay: no account, no key; the studio confirms the address once).
 */
export async function sendDirect(d: FeedbackDraft, context: Record<string, string>): Promise<SendResult> {
  const mail = feedbackEmail(d, context);
  // FormSubmit labels each row with its key, in this order: keep them few and readable
  const body: Record<string, string> = {
    _subject: mail.subject,
    _template: 'table',
    _captcha: 'false',
    From: d.name.trim() || 'Anonymous playtester',
    Notes: d.notes.trim().replace(/\n{3,}/g, '\n\n'),
    ...context,
    Version: `Pizza SIM v${VERSION}`,
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`https://formsubmit.co/ajax/${FEEDBACK_TO}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const j = (await res.json().catch(() => ({}))) as { success?: string | boolean; message?: string };
    if (j.success === true || j.success === 'true') return { ok: true, msg: 'Sent to Noisewater Labs. Thanks!' };
    // first message from a new website (a new itch.io page, say): the studio gets a one-time
    // "activate" email and this message isn't delivered, so keep the notes for another try
    if (/activat/i.test(String(j.message ?? ''))) return { ok: false, pending: true, msg: 'Almost there: Noisewater Labs has to switch on notes from this site once. Your notes are saved; send them again in a little while.' };
  } catch {
    /* fall through */
  }
  return { ok: false, msg: "Couldn't send right now. Your notes are saved, so try again in a bit." };
}

/** Keep a copy of what was sent, in case anything gets lost on the way. */
export function rememberSent(notes: string) {
  try {
    const raw = localStorage.getItem('pizzasim.feedback.sent');
    const list = raw ? (JSON.parse(raw) as { at: number; notes: string }[]) : [];
    list.unshift({ at: Date.now(), notes });
    localStorage.setItem('pizzasim.feedback.sent', JSON.stringify(list.slice(0, 10)));
  } catch {
    /* ignore */
  }
}

/** "Android 10 phone · Chrome 155 · 411×891" instead of a raw user-agent string. */
export function deviceSummary() {
  const ua = navigator.userAgent;
  const m = (re: RegExp) => ua.match(re)?.[1];
  let os = 'Unknown OS';
  if (/Android/.test(ua)) os = `Android ${m(/Android ([\d.]+)/) ?? ''}`.trim();
  else if (/iPhone|iPad|iPod/.test(ua)) os = `iOS ${(m(/OS (\d+[_\d]*)/) ?? '').replace(/_/g, '.')}`.trim();
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X/.test(ua)) os = navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  const browser =
    /Edg\//.test(ua) ? `Edge ${m(/Edg\/(\d+)/)}`
    : /SamsungBrowser/.test(ua) ? `Samsung Internet ${m(/SamsungBrowser\/(\d+)/)}`
    : /Firefox|FxiOS/.test(ua) ? `Firefox ${m(/(?:Firefox|FxiOS)\/(\d+)/)}`
    : /CriOS/.test(ua) ? `Chrome ${m(/CriOS\/(\d+)/)}`
    : /Chrome\//.test(ua) ? `Chrome ${m(/Chrome\/(\d+)/)}`
    : /Safari/.test(ua) ? `Safari ${m(/Version\/(\d+)/) ?? ''}`.trim()
    : 'Unknown browser';
  const w = window.innerWidth, h = window.innerHeight, short = Math.min(w, h);
  const kind = navigator.maxTouchPoints > 0 ? (short < 600 ? ' phone' : ' tablet') : '';
  const app = window.matchMedia?.('(display-mode: standalone)').matches ? ' · desktop app' : '';
  return `${os}${kind} · ${browser} · ${w}×${h}${app}`;
}
