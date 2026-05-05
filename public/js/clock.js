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

  function _tick() {
    const now  = new Date();
    const h    = now.getHours();
    const h12  = h % 12 || 12;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const m    = _pad(now.getMinutes());
    const s    = _pad(now.getSeconds());

    timeEl.textContent = `${_pad(h12)}:${m}:${s} ${ampm}`;
    dateEl.textContent =
      `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  }

  async function _fetchWeather() {
    try {
      const res  = await fetch('/api/weather');
      if (!res.ok) return;
      const { temp, code } = await res.json();
      const [icon, desc] = WMO[code] || ['🌡️', ''];
      weatherEl.innerHTML =
        `<span class="weather-icon">${icon}</span>` +
        `<span class="weather-temp">${temp}°C</span>` +
        `<span class="weather-desc">${desc}</span>`;
      weatherEl.classList.remove('hidden');
      // Refresh every 15 minutes
      weatherTimer = setTimeout(_fetchWeather, 15 * 60 * 1000);
    } catch (_) { /* network error — stay hidden */ }
  }

  function start() {
    if (interval) return;
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
    display.classList.add('hidden');
  }

  return { start, stop };
})();
