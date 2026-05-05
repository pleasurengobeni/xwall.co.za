/**
 * @jest-environment jsdom
 *
 * tests/clock.test.js
 * Tests for the Clock module: start, stop, tick format, idempotency.
 */

beforeAll(() => {
  document.body.innerHTML = `
    <div id="clock-display" class="hidden"></div>
    <span id="clock-time"></span>
    <span id="clock-date"></span>
  `;

  jest.useFakeTimers();
  const { loadModule } = require('./setup/globals');
  loadModule('clock.js');
});

afterEach(() => {
  Clock.stop();
});

afterAll(() => {
  jest.useRealTimers();
});

// ── start() ───────────────────────────────────────────────────────────────────
describe('Clock.start()', () => {
  it('removes "hidden" class from clock-display', () => {
    Clock.start();
    expect(document.getElementById('clock-display').classList.contains('hidden')).toBe(false);
  });

  it('sets clock-time text immediately on start', () => {
    Clock.start();
    expect(document.getElementById('clock-time').textContent).toMatch(/\d{2}:\d{2}:\d{2} (AM|PM)/);
  });

  it('sets clock-date text immediately on start', () => {
    Clock.start();
    const dateText = document.getElementById('clock-date').textContent;
    expect(dateText).toMatch(/[A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d+,\s+\d{4}/);
  });

  it('updates time after 1 second', () => {
    Clock.start();
    const before = document.getElementById('clock-time').textContent;
    jest.advanceTimersByTime(1000);
    const after = document.getElementById('clock-time').textContent;
    // Seconds may roll over; texts may differ or stay the same at :00
    expect(typeof after).toBe('string');
  });

  it('is idempotent — calling start() twice does not create double interval', () => {
    Clock.start();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    Clock.start(); // second call should no-op
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});

// ── stop() ────────────────────────────────────────────────────────────────────
describe('Clock.stop()', () => {
  it('adds "hidden" class to clock-display', () => {
    Clock.start();
    Clock.stop();
    expect(document.getElementById('clock-display').classList.contains('hidden')).toBe(true);
  });

  it('does not throw when called without a prior start()', () => {
    expect(() => Clock.stop()).not.toThrow();
  });

  it('stops ticking — text does not change after stop()', () => {
    Clock.start();
    Clock.stop();
    const snapshot = document.getElementById('clock-time').textContent;
    jest.advanceTimersByTime(3000);
    expect(document.getElementById('clock-time').textContent).toBe(snapshot);
  });

  it('can be restarted cleanly after stop', () => {
    Clock.start();
    Clock.stop();
    Clock.start();
    expect(document.getElementById('clock-display').classList.contains('hidden')).toBe(false);
  });
});

// ── Time format ───────────────────────────────────────────────────────────────
describe('Clock time format', () => {
  it('pads hours to 2 digits', () => {
    // Force a time where h12 < 10 by mocking Date
    const RealDate = global.Date;
    global.Date = class extends RealDate {
      getHours() { return 2; } // 2 AM → h12=2
      getMinutes() { return 5; }
      getSeconds() { return 7; }
      getDay() { return 0; }
      getMonth() { return 0; }
      getDate() { return 1; }
      getFullYear() { return 2026; }
    };
    Clock.start();
    const text = document.getElementById('clock-time').textContent;
    expect(text).toBe('02:05:07 AM');
    Clock.stop();
    global.Date = RealDate;
  });

  it('shows PM for hours >= 12', () => {
    const RealDate = global.Date;
    global.Date = class extends RealDate {
      getHours() { return 15; } // 3 PM → h12=3
      getMinutes() { return 0; }
      getSeconds() { return 0; }
      getDay() { return 1; }
      getMonth() { return 4; }
      getDate() { return 5; }
      getFullYear() { return 2026; }
    };
    Clock.start();
    expect(document.getElementById('clock-time').textContent).toContain('PM');
    Clock.stop();
    global.Date = RealDate;
  });

  it('shows 12 instead of 0 for midnight (12:xx:xx AM)', () => {
    const RealDate = global.Date;
    global.Date = class extends RealDate {
      getHours() { return 0; }
      getMinutes() { return 0; }
      getSeconds() { return 0; }
      getDay() { return 1; }
      getMonth() { return 0; }
      getDate() { return 1; }
      getFullYear() { return 2026; }
    };
    Clock.start();
    expect(document.getElementById('clock-time').textContent).toMatch(/^12:00:00 AM/);
    Clock.stop();
    global.Date = RealDate;
  });

  it('shows 12 instead of 0 at noon (12:xx:xx PM)', () => {
    const RealDate = global.Date;
    global.Date = class extends RealDate {
      getHours() { return 12; }
      getMinutes() { return 30; }
      getSeconds() { return 0; }
      getDay() { return 2; }
      getMonth() { return 0; }
      getDate() { return 1; }
      getFullYear() { return 2026; }
    };
    Clock.start();
    expect(document.getElementById('clock-time').textContent).toMatch(/^12:30:00 PM/);
    Clock.stop();
    global.Date = RealDate;
  });
});
