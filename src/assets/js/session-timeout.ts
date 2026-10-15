/**
 * The session timeout warning (OWASP plan 03, Task 7; WCAG 2.2.1 Timing Adjustable).
 *
 * Progressive enhancement, not the control: `src/auth/session-lifetime.ts` ends sessions whether or not this runs.
 * The page carries the seconds left on each limit (`layouts/session-timeout.njk`). Two minutes before the idle limit
 * this opens a dialog offering to stay signed in. Five minutes before the absolute limit, which cannot be extended,
 * it says when the user will be signed out. Before acting at either point it asks `/session/status`, which never
 * counts as activity, because the user may have been working in another tab. When time is really up it reloads the
 * page, so the server ends the session properly, through IDAM, keeping where the user was.
 */

const IDLE_WARNING_LEAD_MS = 2 * 60 * 1000;
const ABSOLUTE_NOTICE_LEAD_MS = 5 * 60 * 1000;
const STATUS_PATH = "/session/status";
const KEEP_ALIVE_PATH = "/session/keep-alive";

export function initSessionTimeout(): void {
  const idleDialog = document.getElementById("session-timeout-idle") as HTMLDialogElement | null;
  const absoluteDialog = document.getElementById("session-timeout-absolute") as HTMLDialogElement | null;
  if (!idleDialog || !absoluteDialog || typeof idleDialog.showModal !== "function") return;

  const idleSeconds = Number(idleDialog.dataset.idleSeconds);
  let deadlines = deadlinesFrom(Number(idleDialog.dataset.idleRemaining), Number(idleDialog.dataset.absoluteRemaining));
  let absoluteNoticeShown = false;
  let timer: number | undefined;
  let returnFocusTo: Element | null = null;

  const open = (dialog: HTMLDialogElement, focus: HTMLElement | null) => {
    if (dialog.open) return;
    returnFocusTo = document.activeElement;
    dialog.showModal();
    focus?.focus();
  };
  const close = (dialog: HTMLDialogElement) => {
    if (!dialog.open) return;
    dialog.close();
    if (returnFocusTo instanceof HTMLElement) returnFocusTo.focus();
  };

  const schedule = () => {
    window.clearTimeout(timer);
    const now = Date.now();
    const next = Math.min(
      deadlines.idle - IDLE_WARNING_LEAD_MS > now ? deadlines.idle - IDLE_WARNING_LEAD_MS : deadlines.idle,
      !absoluteNoticeShown && deadlines.absolute - ABSOLUTE_NOTICE_LEAD_MS > now ? deadlines.absolute - ABSOLUTE_NOTICE_LEAD_MS : deadlines.absolute
    );
    timer = window.setTimeout(check, Math.max(0, next - now));
  };

  const check = async () => {
    const left = await timeLeft();
    if (!left || left.idleRemaining <= 0 || left.absoluteRemaining <= 0) {
      // A fresh GET of this page, not `reload()`, which would offer to resubmit a page that came from a POST. The
      // server times the session out and returns here after signing in again.
      revisit();
      return;
    }
    deadlines = deadlinesFrom(left.idleRemaining, left.absoluteRemaining);
    const now = Date.now();
    if (!absoluteNoticeShown && deadlines.absolute - now <= ABSOLUTE_NOTICE_LEAD_MS) {
      absoluteNoticeShown = true;
      showSignOutTime(absoluteDialog, deadlines.absolute);
      close(idleDialog);
      open(absoluteDialog, absoluteDialog.querySelector<HTMLElement>("[data-session-continue]"));
    } else if (deadlines.idle - now <= IDLE_WARNING_LEAD_MS && deadlines.idle < deadlines.absolute && !absoluteDialog.open) {
      open(idleDialog, idleDialog.querySelector<HTMLElement>("[data-session-stay]"));
    } else {
      close(idleDialog);
    }
    schedule();
  };

  const staySignedIn = async () => {
    const response = await fetch(KEEP_ALIVE_PATH, { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    if (response?.status !== 204) {
      revisit();
      return;
    }
    deadlines = { idle: Date.now() + idleSeconds * 1000, absolute: deadlines.absolute };
    close(idleDialog);
    schedule();
  };

  idleDialog.querySelector("[data-session-stay]")?.addEventListener("click", staySignedIn);
  // Escape is the user being present, so it counts as staying signed in rather than dismissing the warning.
  idleDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    void staySignedIn();
  });
  absoluteDialog.querySelector("[data-session-continue]")?.addEventListener("click", () => close(absoluteDialog));
  absoluteDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close(absoluteDialog);
  });

  schedule();
}

function revisit(): void {
  window.location.assign(window.location.href);
}

function deadlinesFrom(idleRemaining: number, absoluteRemaining: number): Deadlines {
  const now = Date.now();
  return { idle: now + idleRemaining * 1000, absolute: now + absoluteRemaining * 1000 };
}

async function timeLeft(): Promise<TimeLeft | undefined> {
  try {
    const response = await fetch(STATUS_PATH, { credentials: "same-origin", headers: { Accept: "application/json" } });
    return response.ok ? ((await response.json()) as TimeLeft) : undefined;
  } catch {
    return undefined;
  }
}

/** The time in the user's own clock and language, which is what "sign in again at HH:MM" has to mean to them. */
function showSignOutTime(dialog: HTMLDialogElement, deadline: number): void {
  const body = dialog.querySelector<HTMLElement>("[data-session-template]");
  if (!body) return;
  const time = new Date(deadline).toLocaleTimeString(document.documentElement.lang || undefined, { hour: "2-digit", minute: "2-digit" });
  body.textContent = (body.dataset.sessionTemplate ?? "").replace("{time}", time);
}

interface Deadlines {
  idle: number;
  absolute: number;
}

interface TimeLeft {
  idleSeconds: number;
  idleRemaining: number;
  absoluteRemaining: number;
}
