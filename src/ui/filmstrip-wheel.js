// src/ui/filmstrip-wheel.js
// Dedicated helper for horizontal mousewheel scrolling of the effects filmstrip.

export const DESKTOP_BREAKPOINT_PX = 721;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_BREAKPOINT_PX}px)`;
export const LINE_HEIGHT_FALLBACK_PX = 32;

/**
 * Checks if the current viewport matches the desktop breakpoint.
 * @param {Window|null} [win=window]
 * @returns {boolean}
 */
export function isDesktopBreakpoint(win = typeof window !== "undefined" ? window : null) {
  if (!win) return false;
  return win.matchMedia
    ? win.matchMedia(DESKTOP_MEDIA_QUERY).matches
    : (win.innerWidth >= DESKTOP_BREAKPOINT_PX);
}

/**
 * Normalizes wheel delta across pixel, line, and page modes.
 * @param {WheelEvent} event
 * @param {number} pageSize
 * @returns {number}
 */
export function normalizeWheelDelta(event, pageSize = 0) {
  let delta = event.deltaY;
  if (event.deltaMode === 1) { // DOM_DELTA_LINE
    delta *= LINE_HEIGHT_FALLBACK_PX;
  } else if (event.deltaMode === 2) { // DOM_DELTA_PAGE
    delta *= pageSize;
  }
  return delta;
}

/**
 * Attaches horizontal wheel scrolling handlers to the filmstrip.
 * Batches rapid wheel events via requestAnimationFrame to prevent layout micro-stutter.
 *
 * @param {Object} [options]
 * @param {Element|null} [options.strip] - The outer .strip container
 * @param {Element|null} [options.films] - The scrollable #films container
 * @param {Window|null} [options.win=window]
 * @returns {() => void} Teardown function to remove event listeners and cancel pending frames
 */
export function wireFilmstripWheel({
  strip = document.querySelector(".strip"),
  films = document.querySelector("#films"),
  win = typeof window !== "undefined" ? window : null,
} = {}) {
  if (!strip || !films) {
    return () => {};
  }

  let pendingDelta = 0;
  let rafId = 0;

  const onStripWheel = (e) => {
    // Zoom combinations (ctrlKey/metaKey) pass through to browser zoom
    if (e.ctrlKey || e.metaKey) return;

    if (!isDesktopBreakpoint(win)) return;

    // Trackpad horizontal gestures (|deltaX| > |deltaY|) pass through
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.deltaY === 0) return;

    const delta = normalizeWheelDelta(e, films.clientWidth);

    // Prevent default synchronously on cancelable wheel events to stop vertical scroll
    if (e.cancelable) {
      e.preventDefault();
    }

    pendingDelta += delta;

    if (!rafId && typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        films.scrollLeft += pendingDelta;
        pendingDelta = 0;
      });
    } else if (typeof requestAnimationFrame !== "function") {
      films.scrollLeft += pendingDelta;
      pendingDelta = 0;
    }
  };

  const onStripHeadWheel = (e) => {
    const target = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (target?.closest("#films")) return;
    onStripWheel(e);
  };

  films.addEventListener("wheel", onStripWheel, { passive: false });
  strip.addEventListener("wheel", onStripHeadWheel, { passive: false });

  return () => {
    films.removeEventListener("wheel", onStripWheel);
    strip.removeEventListener("wheel", onStripHeadWheel);
    if (rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    pendingDelta = 0;
  };
}
