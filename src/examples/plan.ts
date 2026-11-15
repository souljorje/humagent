/** Copy a command from the demo. A blocked clipboard changes nothing. */
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-copy]',
))
  button.addEventListener('click', () => {
    const command = button.previousElementSibling?.textContent ?? '';
    navigator.clipboard.writeText(command).then(
      () => {
        button.dataset.copied = '';
        setTimeout(() => delete button.dataset.copied, 1500);
      },
      () => {},
    );
  });
