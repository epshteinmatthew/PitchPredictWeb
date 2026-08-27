/** Pack #list cards into independent columns so expand only shifts same-column cards. */
(function (global) {
  const COL_MIN_REM = 18;
  const GAP_PX = 16;

  function remPx() {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }

  function columnCount(list) {
    const w = list.clientWidth;
    if (w <= 0) return 1;
    const min = COL_MIN_REM * remPx();
    return Math.max(1, Math.floor((w + GAP_PX) / (min + GAP_PX)));
  }

  function ensureColumns(list, n) {
    let cols = [...list.querySelectorAll(":scope > .col")];
    while (cols.length < n) {
      const col = document.createElement("div");
      col.className = "col";
      list.appendChild(col);
      cols.push(col);
    }
    while (cols.length > n) {
      const last = cols.pop();
      const target = cols[cols.length - 1] || list;
      while (last.firstChild) target.appendChild(last.firstChild);
      last.remove();
    }
    return [...list.querySelectorAll(":scope > .col")];
  }

  /** Distribute cards (in given order) into round-robin columns. */
  function packCards(list, cards) {
    if (!list) return;
    list.querySelector(":scope > .empty")?.remove();
    const n = Math.min(columnCount(list), Math.max(1, cards.length));
    const cols = ensureColumns(list, n);
    cards.forEach((el, i) => {
      cols[i % n].appendChild(el);
    });
  }

  /** Pack every .card currently under list, preserving document order. */
  function packList(list) {
    if (!list) return;
    if (list.querySelector(":scope > .empty") && !list.querySelector(".card")) return;
    const cards = [...list.querySelectorAll(".card")];
    packCards(list, cards);
  }

  let observed = new WeakMap();

  function observeColumns(list) {
    if (!list || observed.has(list)) return;
    let last = columnCount(list);
    const ro = new ResizeObserver(() => {
      const next = columnCount(list);
      if (next === last) return;
      last = next;
      packList(list);
    });
    ro.observe(list);
    observed.set(list, ro);
  }

  global.CardColumns = { columnCount, packCards, packList, observeColumns };
})(typeof window !== "undefined" ? window : globalThis);
