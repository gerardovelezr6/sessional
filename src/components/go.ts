// Loads the page a server action pointed to, through the request proxy. When only the part after
// "#" differs, the browser would merely scroll, so the page is reloaded to show the saved data.
export function goTo(url: string): void {
  const same = url.split('#')[0] === window.location.pathname + window.location.search;
  window.location.assign(url);
  if (same) window.location.reload();
}
