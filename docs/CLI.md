# Commands

See the [README](../README.md#install) for installation. Use `humagent --help` for syntax or `--version` for the version.

Use `--json` for JSON results. Piped results also use JSON.

## Pages and setup

```sh
humagent open ./page.html
humagent open http://127.0.0.1:3000/path
humagent demo [plan|calculator|existing]
humagent setup [--directory PATH] [--force]
```

`open` starts the server and returns a session ID and private URL. Use `--no-open` to open the URL yourself.

Keep the page and its assets in one directory. Humagent serves supported files from that directory. See [network restrictions](SECURITY.md#network).

Demos use editable copies under `demos/VERSION` in the data directory. They preserve existing files.

Setup installs the skill at `.agents/skills/humagent` by default. It preserves changed instructions unless you pass `--force`.

## Receive input

```sh
humagent wait SESSION --consumer my-agent --timeout 50 --lease 600
humagent reply SESSION --receipt RECEIPT --message "Updated the page."
humagent ack SESSION --receipt RECEIPT
humagent renew SESSION --receipt RECEIPT --lease 600
```

Use the session ID from `open`. `wait` reserves queued events and returns their receipt.

Each **Send all** action creates one protocol v2 event. Its `payload` contains an optional `message` and ordered `items`.
One receipt can cover several review events. Process each event's overall instruction and items together.

| Option | Seconds | Default |
| --- | --- | --- |
| `--timeout` | More than 0, up to 600 | 50 |
| `--lease` | 1–3600 | 120 |

| Result | Action |
| --- | --- |
| `feedback` | Read the batch. Apply authorized changes. Reply or acknowledge its receipt. |
| `timeout` | Repeat `wait` while review remains active. |
| `ended` | Stop waiting. Reopen only on request. |
| `interrupted` | Check server status before resuming. |

`reply --receipt` completes only the events in that receipt. Without a receipt, a reply completes no events.
`ack` completes the receipt's events without replying.

Renew before the lease expires. Events remain stored and can arrive again after expiry. Check event IDs before repeating consequential actions.

Keep `wait` attached to the active agent turn. Humagent cannot resume an ended turn without a supported harness callback.

## Server and storage

```sh
humagent status [SESSION]
humagent doctor
humagent end SESSION
humagent stop
humagent server --port N
```

`status` reports sessions. `doctor` checks runtime and package files. Neither starts a stopped server.

`end` rejects new input but keeps queued events available. `stop` retains saved sessions.

| Setting | Meaning |
| --- | --- |
| `--home PATH` | Data directory for this command |
| `HUMAGENT_HOME` | Default data directory, otherwise `~/.humagent` |
| `HUMAGENT_PORT` | Server port, or `0` for a free port |

The default workspace saves and reuses its loopback port so browser drafts survive restarts. Explicit port `0` selects a new port.
Use the same data directory across commands.

## Troubleshooting

| Problem | Action |
| --- | --- |
| No agent listening | Ask the agent to run `wait`. Queued input remains available. |
| Feedback remains a draft | Open Review and choose Send all. Forms and SDK calls only stage feedback. |
| Review is open in another tab | Close the editing tab, then reload the other tab. |
| Agent turn ended | Send the agent a new message. |
| Browser did not open | Open the printed URL on the same computer. |
| Server version mismatch | Run `humagent stop`. Repeat `open`. |
| Source changed | Follow the [revision steps](SDK.md#revisions). |
| App cannot connect | Check its HTML route and [attachment limits](SECURITY.md#network). |
| Command fails | Run `humagent doctor`. Read `server.log` in the data directory. |
| Port conflict | Free the saved workspace port. Set `HUMAGENT_PORT=0` only if you want a new browser origin. |
