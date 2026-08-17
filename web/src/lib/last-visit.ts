const KEY = "sc:lastVisitAt";

export function readLastVisit(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function stampLastVisit(): void {
  try {
    window.localStorage.setItem(KEY, new Date().toISOString());
  } catch {
    // ignore quota / private mode
  }
}
