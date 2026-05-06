/**
 * clock.js
 * Full-screen clock with large time, date, and live weather below.
 * Uses browser system time (new Date()) and Open-Meteo for weather.
 */
const Clock = (() => {
  'use strict';

  const display    = document.getElementById('clock-display');
  const timeEl     = document.getElementById('clock-time');
  const dateEl     = document.getElementById('clock-date');
  const weatherEl  = document.getElementById('clock-weather');
  let   interval   = null;
  let   weatherTimer = null;
  let   currentStyle = 'digital';
  let   analogEl = null;
  let   hourHand = null;
  let   minuteHand = null;
  let   secondHand = null;

  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

  // WMO weather interpretation codes → [emoji, short label]
  const WMO = {
    0:  ['☀️',  'Clear'],
    1:  ['🌤️', 'Mainly clear'],  2:  ['⛅',  'Partly cloudy'], 3:  ['☁️',  'Overcast'],
    45: ['🌫️', 'Fog'],           48: ['🌫️', 'Icy fog'],
    51: ['🌦️', 'Drizzle'],       53: ['🌦️', 'Drizzle'],       55: ['🌧️', 'Heavy drizzle'],
    61: ['🌧️', 'Rain'],          63: ['🌧️', 'Rain'],           65: ['🌧️', 'Heavy rain'],
    71: ['🌨️', 'Snow'],          73: ['🌨️', 'Snow'],           75: ['❄️',  'Heavy snow'],
    77: ['❄️',  'Snow grains'],
    80: ['🌦️', 'Showers'],       81: ['🌧️', 'Showers'],        82: ['⛈️',  'Heavy showers'],
    85: ['🌨️', 'Snow showers'],  86: ['❄️',  'Heavy snow showers'],
    95: ['⛈️',  'Thunderstorm'], 96: ['⛈️',  'Storm + hail'],  99: ['⛈️',  'Severe storm'],
  };

  function _pad(n) { return String(n).padStart(2, '0'); }

  function _ensureAnalogFace() {
    if (analogEl) return;
    analogEl = document.getElementById('clock-analog');
    if (!analogEl) {
      analogEl = document.createElement('div');
      analogEl.id = 'clock-analog';
      analogEl.className = 'clock-analog hidden';
      analogEl.innerHTML =
        '<div class="clock-analog-face">' +
          '<span class="clock-marker marker-12"></span>' +
          '<span class="clock-marker marker-3"></span>' +
          '<span class="clock-marker marker-6"></span>' +
          '<span class="clock-marker marker-9"></span>' +
          '<span class="clock-hand clock-hand-hour"></span>' +
          '<span class="clock-hand clock-hand-minute"></span>' +
          '<span class="clock-hand clock-hand-second"></span>' +
          '<span class="clock-analog-core"></span>' +
        '</div>';
      if (display) {
        if (timeEl && timeEl.parentNode === display) display.insertBefore(analogEl, timeEl);
        else display.prepend(analogEl);
      }
    }

    hourHand = analogEl.querySelector('.clock-hand-hour');
    minuteHand = analogEl.querySelector('.clock-hand-minute');
    secondHand = analogEl.querySelector('.clock-hand-second');
  }

  function _applyClockStyle(style) {
    currentStyle = ['digital', 'analog', 'minimal', 'panel'].includes(style) ? style : 'digital';
    if (display) display.dataset.clockStyle = currentStyle;
    _ensureAnalogFace();
    if (analogEl) analogEl.classList.toggle('hidden', currentStyle !== 'analog');
  }

  function _updateAnalogHands(now) {
    if (!hourHand || !minuteHand || !secondHand) return;
    const sec = now.getSeconds();
    const min = now.getMinutes() + sec / 60;
    const hr = (now.getHours() % 12) + min / 60;

    hourHand.style.transform = `translateX(-50%) rotate(${hr * 30}deg)`;
    minuteHand.style.transform = `translateX(-50%) rotate(${min * 6}deg)`;
    secondHand.style.transform = `translateX(-50%) rotate(${sec * 6}deg)`;
  }

  function _tick() {
    const now  = new Date();
    const h    = now.getHours();
    const h12  = h % 12 || 12;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const m    = _pad(now.getMinutes());
    const s    = _pad(now.getSeconds());

    if (currentStyle === 'minimal') {
      timeEl.textContent = `${_pad(h)}:${m}`;
      dateEl.textContent = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
      return;
    }

    if (currentStyle === 'panel') {
      timeEl.innerHTML =
        `<span class="clock-panel-main">${_pad(h12)}:${m}</span>` +
        `<span class="clock-panel-sub">${s} ${ampm}</span>`;
      dateEl.textContent = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
      return;
    }

    if (currentStyle === 'analog') {
      _updateAnalogHands(now);
      timeEl.textContent = `${_pad(h12)}:${m} ${ampm}`;
      dateEl.textContent = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
      return;
    }

    timeEl.textContent = `${_pad(h12)}:${m}:${s} ${ampm}`;
    dateEl.textContent = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  }

  async function _fetchWeather() {
    try {
      const res  = await fetch('/api/weather');
      if (!res.ok) return;
      const { temp, code } = await res.json();
      const [icon, desc] = WMO[code] || ['🌡️', ''];
      if (!weatherEl) return;
      weatherEl.innerHTML =
        `<span class="weather-icon">${icon}</span>` +
        `<span class="weather-temp">${temp}°C</span>` +
        `<span class="weather-desc">${desc}</span>`;
      weatherEl.classList.remove('hidden');
      // Refresh every 15 minutes
      weatherTimer = setTimeout(_fetchWeather, 15 * 60 * 1000);
    } catch (_) { /* network error — stay hidden */ }
  }

  function start(style = 'digital') {
    _applyClockStyle(style);
    if (interval) {
      _tick();
      return;
    }
    display.classList.remove('hidden');
    _tick();
    interval = setInterval(_tick, 1000);
    _fetchWeather();
  }

  function stop() {
    clearInterval(interval);
    clearTimeout(weatherTimer);
    interval = null;
    weatherTimer = null;
    if (weatherEl) {
      weatherEl.classList.add('hidden');
      weatherEl.innerHTML = '';
    }
    if (display) {
      display.dataset.clockStyle = '';
    }
    display.classList.add('hidden');
  }

  return { start, stop };
})();
