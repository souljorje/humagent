import { version } from '../server/version.js';

export const HELP = `Humagent ${version}
Work with your agent through a page, prototype, or local application.

Agent loop:
  humagent ./page.html                   Open the page and wait for feedback
  humagent http://localhost:3000         The same for a trusted local app
  humagent ./page.html --done RECEIPT    Complete a receipt, then wait again

Other commands:
  humagent demo                          Open the interactive plan guide
  humagent status [session]              Show the server, sessions, or one session
  humagent end <session>                 End a session
  humagent stop                          Stop the server and retain saved data

Options:
  --no-wait                             Open the page or complete a receipt, then exit
  --no-open                             Print the browser URL without opening it
  --network                             Allow external resources in trusted HTML
  --home <directory>                    Choose a private data directory
  --json                                Print machine-readable output
  -h, --help                            Show this help
  -v, --version                         Show the installed version

Also:
  humagent server [--port number]

Run with Node.js 24+ or Bun 1.4.4+. Bun is not required for npm/npx use.
Humagent does not run a model or change source files.
Install the agent skill separately: npx skills add souljorje/humagent
`;
