import './index.css';

const COPIED_TIME = 1500;

async function copy(button: HTMLButtonElement) {
  const command = button.previousElementSibling?.textContent ?? '';
  await navigator.clipboard.writeText(command);
  button.dataset.copied = '';
  setTimeout(() => delete button.dataset.copied, COPIED_TIME);
}

// Copy a command from the demo. A blocked clipboard changes nothing.
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-copy]',
))
  button.addEventListener('click', () => copy(button).catch(() => {}));
