/**
 * tests/setup/globals.js
 * Helper for DOM test files — loads a frontend IIFE module into the
 * current global scope AFTER the test's DOM scaffold has been set up.
 *
 * Usage in beforeAll():
 *   const { loadModule } = require('../setup/globals');
 *   loadModule('clock.js');
 *
 * Frontend modules use:  const Clock = (() => { ... })();
 * `const` does NOT leak to global in Node, so we rewrite the leading
 * assignment before eval so it lands on `global`.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '../../public/js');

// Known module names — used to rewrite the top-level const → global assignment
const MODULE_NAMES = ['Clock', 'Rain', 'WakeLock', 'Wallpaper', 'Player'];

/**
 * Evaluate a frontend JS file into the current global scope.
 * @param {string} filename  basename inside public/js/, e.g. 'clock.js'
 */
function loadModule(filename) {
  let code = fs.readFileSync(path.join(JS_DIR, filename), 'utf8');

  for (const name of MODULE_NAMES) {
    // Match: const/let/var Name = at the start of a line
    const re = new RegExp(`^(?:const|let|var)\\s+${name}\\s*=`, 'm');
    if (re.test(code)) {
      code = code.replace(re, `global.${name} =`);
      break;
    }
  }
  // eslint-disable-next-line no-eval
  eval(code);
}

module.exports = { loadModule };


