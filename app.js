// ===== Configuration =====
const API_KEY = 'e9be677d45e2925a23edef4b768ffbb8';
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

// ===== State =====
let currentUnit = 'metric'; // metric = °C, imperial = °F
let currentWeatherData = null;
let currentForecastData = null;

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const searchInput = $('#searchInput');
const locationBtn = $('#locationBtn');
const unitToggle = $('#unitToggle');
const themeToggle = $('#themeToggle');
const loading = $('#loading');
const errorMessage = $('#errorMessage');
const errorText = $('#errorText');
const welcome = $('#welcome');
const weatherContent = $('#weatherContent');
const recentSearchesEl = $('#recentSearches');

// ===== Event Listeners =====
document.addEventListener('DOMContentLoaded', () => {
  renderRecentSearches();
  loadTheme();
  loadUnit();

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const city = searchInput.value.trim();
      if (city) fetchWeather(city);
    }
  });

  locationBtn.addEventListener('click', fetchByGeolocation);
  unitToggle.addEventListener('click', toggleUnit);
  themeToggle.addEventListener('click', toggleTheme);
});

// ===== API Functions =====
async function fetchWeather(city) {
  showLoading();
  hideError();

  try {
    const res = await fetch(`${BASE_URL}/weather?q=${encodeURIComponent(city)}&units=${currentUnit}&appid=${API_KEY}`);
    const data = await res.json();

    if (data.cod !== 200) {
      throw new Error(data.message || 'City not found');
    }

    currentWeatherData = data;
    saveRecentSearch(data.name);
    renderCurrentWeather(data);

    // Fetch forecast and AQI in parallel
    const [forecastData, aqiData] = await Promise.all([
      fetchForecast(data.coord.lat, data.coord.lon),
      fetchAQI(data.coord.lat, data.coord.lon)
    ]);

    if (forecastData) renderForecast(forecastData);
    if (aqiData) renderAQI(aqiData);

    setDynamicBackground(data.weather[0].main);
    hideLoading();
    showWeatherContent();
  } catch (err) {
    hideLoading();
    showError(err.message === 'city not found'
      ? 'City not found. Please check the spelling and try again.'
      : `Error: ${err.message}`
    );
  }
}

async function fetchByCoords(lat, lon) {
  showLoading();
  hideError();

  try {
    const res = await fetch(`${BASE_URL}/weather?lat=${lat}&lon=${lon}&units=${currentUnit}&appid=${API_KEY}`);
    const data = await res.json();

    if (data.cod !== 200) throw new Error(data.message);

    currentWeatherData = data;
    saveRecentSearch(data.name);
    renderCurrentWeather(data);

    const [forecastData, aqiData] = await Promise.all([
      fetchForecast(lat, lon),
      fetchAQI(lat, lon)
    ]);

    if (forecastData) renderForecast(forecastData);
    if (aqiData) renderAQI(aqiData);

    setDynamicBackground(data.weather[0].main);
    hideLoading();
    showWeatherContent();
  } catch (err) {
    hideLoading();
    showError(`Error: ${err.message}`);
  }
}

async function fetchForecast(lat, lon) {
  try {
    const res = await fetch(`${BASE_URL}/forecast?lat=${lat}&lon=${lon}&units=${currentUnit}&appid=${API_KEY}`);
    const data = await res.json();
    if (data.cod === '200') {
      currentForecastData = data;
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchAQI(lat, lon) {
  try {
    const res = await fetch(`${BASE_URL}/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`);
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

// ===== Geolocation =====
function fetchByGeolocation() {
  if (!navigator.geolocation) {
    showError('Geolocation is not supported by your browser.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => fetchByCoords(pos.coords.latitude, pos.coords.longitude),
    (err) => {
      const messages = {
        1: 'Location access denied. Please enable it in your browser settings.',
        2: 'Location unavailable. Please try searching manually.',
        3: 'Location request timed out. Please try again.'
      };
      showError(messages[err.code] || 'Unable to get location.');
    }
  );
}

// ===== Render Functions =====
function renderCurrentWeather(data) {
  const iconCode = data.weather[0].icon;
  const iconUrl = `https://openweathermap.org/img/wn/${iconCode}@4x.png`;

  $('#weatherIcon').src = iconUrl;
  $('#weatherIcon').alt = data.weather[0].description;
  $('#temperature').textContent = `${Math.round(data.main.temp)}°${currentUnit === 'metric' ? 'C' : 'F'}`;
  $('#description').textContent = data.weather[0].description;
  $('#cityName').textContent = `${data.name}, ${data.sys.country}`;
  $('#dateTime').textContent = formatDateTime(data.dt, data.timezone);

  // Details
  $('#feelsLike').textContent = `${Math.round(data.main.feels_like)}°${currentUnit === 'metric' ? 'C' : 'F'}`;
  $('#humidity').textContent = `${data.main.humidity}%`;

  const windSpeed = currentUnit === 'metric'
    ? `${(data.wind.speed * 3.6).toFixed(1)} km/h`
    : `${data.wind.speed.toFixed(1)} mph`;
  $('#wind').textContent = windSpeed;

  $('#pressure').textContent = `${data.main.pressure} hPa`;
  $('#visibility').textContent = data.visibility
    ? `${(data.visibility / 1000).toFixed(1)} km`
    : 'N/A';

  // Dew point approximation: Td ≈ T - ((100 - RH) / 5)
  const dewPoint = Math.round(data.main.temp - ((100 - data.main.humidity) / 5));
  $('#dewPoint').textContent = `${dewPoint}°${currentUnit === 'metric' ? 'C' : 'F'}`;

  // Sunrise & Sunset
  $('#sunrise').textContent = formatTime(data.sys.sunrise, data.timezone);
  $('#sunset').textContent = formatTime(data.sys.sunset, data.timezone);

  // Sun position dot
  updateSunPosition(data.dt, data.sys.sunrise, data.sys.sunset);
}

function renderForecast(data) {
  const container = $('#forecastCards');
  container.innerHTML = '';

  // Get one forecast per day (noon readings)
  const dailyMap = new Map();
  data.list.forEach((item) => {
    const date = new Date(item.dt * 1000).toLocaleDateString('en-US', { weekday: 'short' });
    const hour = new Date(item.dt * 1000).getHours();
    if (!dailyMap.has(date) || Math.abs(hour - 12) < Math.abs(new Date(dailyMap.get(date).dt * 1000).getHours() - 12)) {
      dailyMap.set(date, item);
    }
  });

  // Skip today, take next 5
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short' });
  const entries = [...dailyMap.entries()].filter(([day]) => day !== today).slice(0, 5);

  entries.forEach(([day, item]) => {
    const iconUrl = `https://openweathermap.org/img/wn/${item.weather[0].icon}@2x.png`;
    const tempMax = Math.round(item.main.temp_max);
    const tempMin = Math.round(item.main.temp_min);
    const unit = currentUnit === 'metric' ? 'C' : 'F';

    const card = document.createElement('div');
    card.className = 'forecast-card';
    card.innerHTML = `
      <p class="forecast-day">${day}</p>
      <img src="${iconUrl}" alt="${item.weather[0].description}">
      <p class="forecast-temp">${tempMax}° <span>${tempMin}°${unit}</span></p>
      <p class="forecast-desc">${item.weather[0].description}</p>
    `;
    container.appendChild(card);
  });
}

function renderAQI(data) {
  if (!data || !data.list || !data.list[0]) return;

  const aqi = data.list[0].main.aqi;
  const components = data.list[0].components;

  const levels = [
    { label: 'Good', desc: 'Air quality is satisfactory.', color: 'var(--aqi-good)' },
    { label: 'Fair', desc: 'Acceptable air quality.', color: 'var(--aqi-fair)' },
    { label: 'Moderate', desc: 'May affect sensitive groups.', color: 'var(--aqi-moderate)' },
    { label: 'Poor', desc: 'Health effects for everyone.', color: 'var(--aqi-poor)' },
    { label: 'Very Poor', desc: 'Serious health risk.', color: 'var(--aqi-very-poor)' }
  ];

  const level = levels[aqi - 1] || levels[0];

  $('#aqiBadge').style.background = level.color;
  $('#aqiValue').textContent = aqi;
  $('#aqiLevel').textContent = level.label;
  $('#aqiLevel').style.color = level.color;
  $('#aqiDesc').textContent = level.desc;

  const compContainer = $('#aqiComponents');
  compContainer.innerHTML = '';

  const pollutants = [
    { key: 'pm2_5', label: 'PM2.5', unit: 'μg/m³' },
    { key: 'pm10', label: 'PM10', unit: 'μg/m³' },
    { key: 'o3', label: 'O₃', unit: 'μg/m³' },
    { key: 'no2', label: 'NO₂', unit: 'μg/m³' },
    { key: 'so2', label: 'SO₂', unit: 'μg/m³' },
    { key: 'co', label: 'CO', unit: 'μg/m³' }
  ];

  pollutants.forEach(({ key, label, unit }) => {
    if (components[key] !== undefined) {
      const el = document.createElement('div');
      el.className = 'aqi-comp';
      el.innerHTML = `
        <p class="aqi-comp-value">${components[key].toFixed(1)}</p>
        <p class="aqi-comp-label">${label}</p>
      `;
      compContainer.appendChild(el);
    }
  });
}

// ===== UI State Functions =====
function showLoading() {
  loading.classList.add('active');
  welcome.classList.add('hidden');
  weatherContent.classList.remove('active');
}

function hideLoading() {
  loading.classList.remove('active');
}

function showError(msg) {
  errorText.textContent = msg;
  errorMessage.classList.add('active');
  weatherContent.classList.remove('active');
}

function hideError() {
  errorMessage.classList.remove('active');
}

function showWeatherContent() {
  welcome.classList.add('hidden');
  weatherContent.classList.add('active');
}

// ===== Dynamic Background =====
function setDynamicBackground(condition) {
  const classes = ['weather-clear', 'weather-clouds', 'weather-rain', 'weather-snow', 'weather-thunderstorm', 'weather-mist', 'weather-drizzle'];
  document.body.classList.remove(...classes);

  const mapping = {
    'Clear': 'weather-clear',
    'Clouds': 'weather-clouds',
    'Rain': 'weather-rain',
    'Snow': 'weather-snow',
    'Thunderstorm': 'weather-thunderstorm',
    'Mist': 'weather-mist',
    'Haze': 'weather-mist',
    'Fog': 'weather-mist',
    'Drizzle': 'weather-drizzle',
    'Smoke': 'weather-mist',
    'Dust': 'weather-mist'
  };

  const cls = mapping[condition];
  if (cls) document.body.classList.add(cls);
}

// ===== Theme =====
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('weather-theme', next);
  updateThemeIcon(next);
}

function loadTheme() {
  const saved = localStorage.getItem('weather-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function updateThemeIcon(theme) {
  themeToggle.innerHTML = theme === 'dark'
    ? "<i class='bx bx-sun'></i>"
    : "<i class='bx bx-moon'></i>";
}

// ===== Unit Toggle =====
function toggleUnit() {
  currentUnit = currentUnit === 'metric' ? 'imperial' : 'metric';
  unitToggle.textContent = currentUnit === 'metric' ? '°C' : '°F';
  localStorage.setItem('weather-unit', currentUnit);

  // Re-fetch if we have data
  if (currentWeatherData) {
    fetchWeather(currentWeatherData.name);
  }
}

function loadUnit() {
  const saved = localStorage.getItem('weather-unit');
  if (saved) {
    currentUnit = saved;
    unitToggle.textContent = currentUnit === 'metric' ? '°C' : '°F';
  }
}

// ===== Recent Searches =====
function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem('weather-recent') || '[]');
  } catch {
    return [];
  }
}

function saveRecentSearch(city) {
  let recent = getRecentSearches();
  recent = recent.filter((c) => c.toLowerCase() !== city.toLowerCase());
  recent.unshift(city);
  recent = recent.slice(0, 6);
  localStorage.setItem('weather-recent', JSON.stringify(recent));
  renderRecentSearches();
}

function removeRecentSearch(city) {
  let recent = getRecentSearches();
  recent = recent.filter((c) => c !== city);
  localStorage.setItem('weather-recent', JSON.stringify(recent));
  renderRecentSearches();
}

function renderRecentSearches() {
  const recent = getRecentSearches();
  recentSearchesEl.innerHTML = '';

  if (recent.length === 0) return;

  recent.forEach((city) => {
    const chip = document.createElement('button');
    chip.className = 'recent-chip';
    chip.innerHTML = `${city} <span class="remove-chip">&times;</span>`;

    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-chip')) {
        e.stopPropagation();
        removeRecentSearch(city);
      } else {
        searchInput.value = city;
        fetchWeather(city);
      }
    });

    recentSearchesEl.appendChild(chip);
  });
}

// ===== Helpers =====
function formatDateTime(timestamp, timezone) {
  const date = new Date((timestamp + timezone) * 1000);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(date);
}

function formatTime(timestamp, timezone) {
  const date = new Date((timestamp + timezone) * 1000);
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(date);
}

function updateSunPosition(currentTime, sunrise, sunset) {
  const dot = $('#sunDot');
  if (!dot) return;

  if (currentTime < sunrise || currentTime > sunset) {
    dot.style.left = currentTime < sunrise ? '0%' : '100%';
    return;
  }

  const total = sunset - sunrise;
  const elapsed = currentTime - sunrise;
  const pct = Math.min(Math.max((elapsed / total) * 100, 0), 100);
  dot.style.left = `${pct}%`;
}
