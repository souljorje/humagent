const tasks = document.querySelector<HTMLInputElement>('#tasks')!;
const minutes = document.querySelector<HTMLInputElement>('#minutes')!;
const taskCount = document.getElementById('task-count')!;
const minuteCount = document.getElementById('minute-count')!;
const hours = document.getElementById('hours')!;

function update() {
  taskCount.textContent = tasks.value;
  minuteCount.textContent = minutes.value;
  hours.textContent = `${((Number(tasks.value) * Number(minutes.value)) / 60).toFixed(1)} hours`;
}
document.addEventListener('input', update);
update();
