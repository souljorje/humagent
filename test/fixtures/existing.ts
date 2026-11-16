const counter = document.querySelector<HTMLButtonElement>('#counter')!;
let count = 0;
counter.onclick = () => {
  count++;
  counter.textContent = `Count: ${count}`;
};
