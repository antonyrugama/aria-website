/* The design-system page's controller.

   It boots the v2 shell, fills the token table by resolving what the
   stylesheet actually computed, and writes the handful of lengths that are
   data-driven. Nothing here reads an API: every figure on this page is a fixed
   sample chosen to exercise a shape.

   The token table is read back out of the stylesheet rather than written out
   here on purpose. A list of names typed into this file could drift from
   aria.css, and the failure would be silent in the direction that matters — a
   token that no longer exists resolves to an empty string and a page that
   hard-codes the name would still print a row for it. */
(function (global) {
  'use strict';

  var SAMPLE_METER = 73;   /* percent, the shape a real pane would compute */
  var SAMPLE_SPENT = 62;   /* percent of a budget consumed */
  var SAMPLE_FORECAST = 26;

  /* Every custom property declared on :root by aria.css, in source order.
     Read from the stylesheet so this cannot drift from the file it documents. */
  function declaredTokens() {
    var names = [];
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var rule = rules[j];
        if (!rule.selectorText || rule.selectorText.indexOf(':root') !== 0) continue;
        for (var k = 0; k < rule.style.length; k++) {
          var name = rule.style[k];
          if (name.indexOf('--') === 0 && names.indexOf(name) === -1) names.push(name);
        }
      }
    }
    return names;
  }

  function renderTokens() {
    var body = document.querySelector('#tokenTable tbody');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    var computed = getComputedStyle(document.documentElement);
    declaredTokens().forEach(function (name) {
      var row = document.createElement('tr');
      var key = document.createElement('td');
      key.className = 'code';
      key.textContent = name;
      var value = document.createElement('td');
      value.className = 'num tiny';
      value.textContent = computed.getPropertyValue(name).trim() || '(unset)';
      row.appendChild(key);
      row.appendChild(value);
      body.appendChild(row);
    });
  }

  function sizeSamples() {
    var meter = document.querySelector('#sampleMeter i');
    if (meter) meter.style.width = SAMPLE_METER + '%';

    var fill = document.querySelector('#sampleBudget .fill');
    if (fill) fill.style.width = SAMPLE_SPENT + '%';
    var fore = document.querySelector('#sampleBudget .fore');
    if (fore) fore.style.width = SAMPLE_FORECAST + '%';
  }

  global.Aria.boot({
    id: null,
    title: 'Design system v2',
    sub: 'The shell the pane remodels are built against',
    preview: true,
    /* Sample badges. A real pane passes counts it read; this page has none, so
       these are labelled as samples rather than left looking like figures. */
    badges: {
      alerts: { label: '3', tone: 'hot', description: 'sample count' },
      spend: { label: '88%', tone: 'warm', description: 'sample figure' },
      quality: { label: 'soon', tone: 'soon' }
    },
    account: {
      name: 'Sample Admin',
      email: 'admin@example.invalid',
      meta: 'Sample \u00b7 not a session'
    }
  });

  sizeSamples();
  renderTokens();

  /* The token values change with the theme, and the theme button is in the
     top bar this page does not own. Watching the attribute keeps the table
     honest without shell code having to know this page exists. */
  new MutationObserver(renderTokens).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
})(window);
