// Set this to the deployed Render API URL, for example:
// window.MONEY_HUB_API = 'https://money-hub-api.onrender.com';
const localHosts = ['localhost', '127.0.0.1'];
window.MONEY_HUB_API = localHosts.includes(window.location.hostname)
  ? `http://${window.location.hostname}:3000`
  : window.location.origin;
