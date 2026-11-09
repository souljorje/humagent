# Commands

See the [README](../README.md#install) for installation. Use `humagent --help` for syntax or `--version` for the version.

Use `--json` for JSON results. Piped results also use JSON.

## Pages and setup

```sh
humagent open ./page.html
humagent open http://127.0.0.1:3000/path
humagent demo
humagent setup [--directory PATH] [--force]
```

`open` starts the server and returns a session ID and private URL. Use `--no-open` to open the URL yourself.

Keep the page and its assets in one directory. Humagent serves supported files from that directory. See [network restrictions](SECURITY.md#network).

The demo opens an editable plan under `demos/VERSION/plan` in the data directory. It preserves existing files.

Setup installs the skill at `.agents/skills/humagent` by default. It preserves changed instructions unless you pass `--force`.

## Receive input

```sh
humagent wait SESSION
humagent wait SESSION --consumer my-agent --timeout 50 --lease 600
humagent ack SESSION --receipt RECEIPT
humagent renew SESSION --receipt RECEIPT --lease 600
```

Use the session ID from `open`. `wait` reserves queued events and returns their receipt.

Each **Send** action creates one event with an optional `message` and ordered `items`. See the [event format](SDK.md#event-format).
One receipt can cover several review events. Process each event's `message` and `items` together.

| Option | Seconds | Default |
| --- | --- | --- |
| `--timeout` | More than 0, up to 600 | 50 |
| `--lease` | 1–3600 | 120 |

| Result | Action |
| --- | --- |
| `feedback` | Read the events. Apply authorized changes. Acknowledge the receipt. |
| `timeout` | Repeat `wait` while review remains active. |
| `ended` | Stop waiting. Reopen only on request. |
| `interrupted` | Check server status before resuming. |

`ack --receipt` completes only the events reserved by that receipt.

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

The server selects a free loopback port at each start unless `--port` or `HUMAGENT_PORT` sets one.
After a restart, run `open` with the same target again. It reuses the saved session and returns the new URL.
Use the same data directory across commands. Each session file under `sessions/` keeps drafts and events.

## Troubleshooting

| Problem | Action |
| --- | --- |
| No agent listening | Ask the agent to run `wait`. New sends require a listening or working agent. |
| Feedback remains a draft | Choose Send from the floating bar. Forms and SDK calls only stage feedback. |
| Agent turn ended | Send the agent a new message. |
| Browser did not open | Open the printed URL on the same computer. |
| Older server running | Run `humagent stop`. Repeat `open`. |
| Server restarted | Repeat `open` with the same target. Use the new URL. |
| Source changed | Follow [refresh and recovery](USAGE.md#refresh-and-recovery) and inspect [revision rules](SDK.md#revisions). |
| App cannot connect | Check its HTML route and [attachment limits](SECURITY.md#network). |
| Stored session is unreadable | See [stored sessions](#stored-sessions). |
| Command fails | Run `humagent doctor`. Read `server.log` in the data directory. |
| Port conflict | Free the configured port. Otherwise, unset `HUMAGENT_PORT`. |

## Stored sessions

Sessions from other development versions are reported as unreadable. Humagent leaves their files unchanged. Use a new data directory with `--home` or `HUMAGENT_HOME`.
