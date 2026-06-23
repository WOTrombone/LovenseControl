const params = new URLSearchParams(window.location.search);
const controllerName = params.get('name') || 'Controller';
const room = params.get('room') || 'preview';
const intensity = document.querySelector('#intensity');
const intensityOutput = document.querySelector('#intensity-output');

document.querySelector('#controller-title').textContent = controllerName;
document.querySelector('#room-label').textContent = `Room ${room} · waiting for host approval.`;

intensity.addEventListener('input', () => {
  intensityOutput.textContent = `${intensity.value} / 20`;
});
