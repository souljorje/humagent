/** Machines get JSON: without a terminal, or with `--json`. */
const machine = !process.stdout.isTTY || process.argv.includes('--json');

/** Print the value as JSON. With text, print the text unless the output is for machines. */
export async function output(value: unknown, text?: string) {
  const line =
    text === undefined || machine ? JSON.stringify(value, null, 2) : text;
  await new Promise<void>((resolve) =>
    process.stdout.write(line + '\n', () => resolve()),
  );
}
export async function outputError(message: string) {
  if (machine) await output({ error: message });
  else process.stderr.write(`Humagent: ${message}\n`);
}
