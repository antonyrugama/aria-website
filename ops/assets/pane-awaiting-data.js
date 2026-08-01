/* Happening now and What happened, while nothing serves them.

   Both panes are designed and approved. Neither has anything to read: the
   operations API serves problems and it serves the identity behind the sign
   in, and that is all it serves. There is no live queue to show and no run
   history to search, so these two pages show neither.

   They are here rather than left on the shell's generic placeholder because
   that placeholder answers a different question. It says a pane is waiting for
   the delivery wave that builds its screen, which for these two is no longer
   true: the screens are what this release is. What they are waiting for is
   something to put on them. Those are different facts and an operator chasing
   an incident at three in the morning deserves the accurate one, particularly
   after following a link from a problem that pointed them here.

   The alternative was to build both panes against a shape nobody has written
   yet. That would have produced two screens that render an error every time
   anybody opens them, and a set of guesses about a contract that would be
   wrong in the details by the time it existed. Saying so plainly costs a
   page each and is true. */
(function (global) {
  'use strict';

  var shell = global.OpsShell;
  var op = global.OpsOperate;
  var h = shell.h;
  var icon = shell.icon;

  var PANES = {
    jobs: {
      title: 'The live queue is not being served yet',
      missing: 'what Aria is working on right now',
      lines: [
        'This pane is the control room for work in flight: what is queued, what is running, ' +
          'what is being retried, and what has been given up on. Nothing serves that yet, ' +
          'so there is nothing here to show you.',
        'Nothing is broken and nothing is being hidden. Your role is not the reason this ' +
          'page is empty, and neither is a filter.'
      ],
      instead: 'A problem that says work is stuck is still raised, and it will still reach you.'
    },
    history: {
      title: 'Run history is not being searchable yet',
      missing: 'what happened to a particular piece of work',
      lines: [
        'This pane is where a single run is reconstructed end to end: what was asked for, ' +
          'what it cost, how long it took, why it failed, and whether the same thing is ' +
          'happening to other people. Nothing serves that yet.',
        'Nothing is broken and nothing is being hidden. Your role is not the reason this ' +
          'page is empty, and neither is a filter.'
      ],
      instead: 'A rule that watches how often work succeeds is still running, and it will ' +
        'still raise a problem when the rate drops.'
    }
  };

  function render(config) {
    return function (content, pane) {
      var wrap = h('div', { className: 'stack' });

      var card = h('div', { className: 'card' });
      var block = shell.stateBlock('clock', config.title, config.lines);

      var actions = h('div', { className: 'row row-wrap mt-sm' });
      actions.appendChild(op.link('alerts.html', 'Open problems', 'btn btn-primary'));
      block.appendChild(actions);
      card.appendChild(block);

      card.appendChild(h('div', { className: 'card-foot' }, [
        h('span', {
          text: 'This pane answers: ' + pane.question + ' It will, once ' + config.missing +
                ' is something the dashboard can read.'
        })
      ]));
      wrap.appendChild(card);

      var note = h('div', { className: 'callout callout-info' });
      note.appendChild(icon('info'));
      note.appendChild(h('div', { text: config.instead }));
      wrap.appendChild(note);

      content.appendChild(wrap);
    };
  }

  Object.keys(PANES).forEach(function (id) {
    shell.definePane(id, render(PANES[id]));
  });
})(window);
