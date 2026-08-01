/* Inline SVG icon set, ported from the approved mocks.

   Icons are built as DOM rather than injected as HTML strings so that no part
   of this file can turn attacker-influenced text into markup. Every icon is
   decorative: the control around it carries the accessible name. */
(function (global) {
  'use strict';

  var PATHS = {
    overview: ['M3 12h5l2-7 4 14 2-7h5'],
    live: ['M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7'],
    history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
    analytics: ['M3 3v18h18', 'M7 11h3v6H7zM12.5 7h3v10h-3zM18 13h3v4h-3z'],
    eval: ['M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4', 'm21 3-9 9', 'M15 3h6v6', 'm7 13 2.5 2.5L14 11'],
    users: ['M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20', 'M22 20v-1.5a4 4 0 0 0-3-3.85', 'M16.5 3.9a4 4 0 0 1 0 6.2'],
    release: ['M12 2 3 7v10l9 5 9-5V7z', 'm3 7 9 5 9-5', 'M12 12v10'],
    spend: ['M12 2v20', 'M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.7 5 3.2 5 1.3 5 3.3-2.2 3-5 3-5-1.1-5-3'],
    alerts: ['M18 8a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7', 'M13.7 20a2 2 0 0 1-3.4 0'],
    settings: ['M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z'],
    search: ['m20 20-3.5-3.5'],
    close: ['M18 6 6 18M6 6l12 12'],
    warn: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4M12 17h.01'],
    info: ['M12 16v-4M12 8h.01'],
    check: ['M20 6 9 17l-5-5'],
    x: ['m15 9-6 6M9 9l6 6'],
    empty: ['M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z', 'M3 7.5 12 12l9-4.5M12 12v9'],
    menu: ['M3 6h18M3 12h18M3 18h18'],
    external: ['M15 3h6v6', 'M10 14 21 3', 'M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5'],
    download: ['M12 3v12', 'm7 11 5 5 5-5', 'M4 21h16'],
    refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v6h-6'],
    lock: ['M4 12a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M8 10V7a4 4 0 0 1 8 0v3'],
    eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z'],
    filter: ['M3 5h18l-7 8v6l-4 2v-8z'],
    clock: ['M12 7v5l3 2'],
    signout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
    sun: ['M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
    moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z'],
    build: ['M3 21v-4l11-11 4 4L7 21z', 'm14 6 4 4', 'M17 3l4 4']
  };

  /* A few icons need a circle rather than a path. Kept separate so PATHS
     stays a plain string map that cannot smuggle markup. */
  var CIRCLES = {
    live: [[12, 12, 3]],
    search: [[11, 11, 7]],
    info: [[12, 12, 9]],
    x: [[12, 12, 9]],
    clock: [[12, 12, 9]],
    settings: [[12, 12, 3]],
    users: [[9, 7, 3.2]],
    eye: [[12, 12, 3]],
    sun: [[12, 12, 4.2]]
  };

  var NS = 'http://www.w3.org/2000/svg';

  /* Returns a decorative <svg> element for the named icon. Unknown names give
     an empty svg rather than throwing, so a typo degrades to a blank slot. */
  function icon(name, className) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (className) svg.setAttribute('class', className);

    (CIRCLES[name] || []).forEach(function (c) {
      var el = document.createElementNS(NS, 'circle');
      el.setAttribute('cx', String(c[0]));
      el.setAttribute('cy', String(c[1]));
      el.setAttribute('r', String(c[2]));
      svg.appendChild(el);
    });
    (PATHS[name] || []).forEach(function (d) {
      var el = document.createElementNS(NS, 'path');
      el.setAttribute('d', d);
      svg.appendChild(el);
    });
    return svg;
  }

  global.OpsIcons = { icon: icon, has: function (n) { return !!PATHS[n]; } };
})(window);
