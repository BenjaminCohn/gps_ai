// ═══════════════════════════════════════
//  ARIA GPS — Météo (OpenWeatherMap)
// ═══════════════════════════════════════

const WEATHER_ICONS = {
  '01d':'☀️','01n':'🌙','02d':'⛅','02n':'🌙','03d':'☁️','03n':'☁️',
  '04d':'☁️','04n':'☁️','09d':'🌧','09n':'🌧','10d':'🌦','10n':'🌧',
  '11d':'⛈','11n':'⛈','13d':'❄️','13n':'❄️','50d':'🌫','50n':'🌫',
};

async function fetchWeather(lat, lng) {
  if (!ARIA_CONFIG.OPENWEATHER_KEY || ARIA_CONFIG.OPENWEATHER_KEY.includes('VOTRE')) return;

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}`
      + `&appid=${ARIA_CONFIG.OPENWEATHER_KEY}&units=metric&lang=fr`;
    const res = await fetch(url);
    const data = await res.json();

    const temp = Math.round(data.main.temp);
    const desc = data.weather[0].description;
    const icon = WEATHER_ICONS[data.weather[0].icon] || '🌡';

    document.getElementById('weather-icon').textContent = icon;
    document.getElementById('weather-temp').textContent = `${temp}°C`;
    document.getElementById('weather-desc').textContent = desc.charAt(0).toUpperCase() + desc.slice(1);
    document.getElementById('weather-float').classList.remove('hidden');

    // Alertes météo si conditions mauvaises
    checkWeatherAlerts(data);
  } catch (err) {
    console.warn('Météo indisponible:', err);
  }
}

function checkWeatherAlerts(data) {
  const code = data.weather[0].id;
  if (code >= 200 && code < 300) addAlert('warn', 'Orage en cours sur votre route — Prudence !', '⚡', 'badge-red');
  else if (code >= 600 && code < 700) addAlert('warn', 'Neige signalée — Route glissante', '❄️', 'badge-red');
  else if (data.wind.speed > 15) addAlert('info', `Vent fort : ${Math.round(data.wind.speed * 3.6)} km/h`, '💨', 'badge-blue');
  else if (data.visibility < 1000) addAlert('warn', 'Brouillard — Visibilité réduite', '🌫', 'badge-red');
}
