# Commands

See the [README](../README.md#install) for installation. Use `humagent --help` for syntax or `--version` for the version.

Use `--json` for JSON results. Piped results also use JSON.

## Pages

```sh
humagent open ./page.html
humagent open http://127.0.0.1:3000/path
humagent demo
```

`open` starts the server and returns a session ID and private URL. Use `--no-open` to open the URL yourself.

Keep the page and its assets in one directory. Humagent serves supported files from that directory. See [network restrictions](SECURITY.md#network).

The demo opens an editable plan under `demos/VERSION/plan` in the data directory. It preserves existing files.

## Agent skill

The package does not include the skill. Install it with the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add souljorje/humagent
```

Update it with `npx skills update humagent`.

## Receive input

```sh
humagent wait SESSION
humagent ack SESSION --receipt RECEIPT
```

Use the session ID from `open`. `wait` returns every unfinished event with a new receipt.

Each **Send** action creates one event with an optional `message` and ordered `items`. See the [event format](SDK.md#event-format).
One receipt can cover several review events. Process each event's `message` and `items` together.

`wait` blocks until the user sends feedback or ends the session. It has no time limit.
The server sends a space every 5 seconds to keep the connection open. The CLI prints only the result.

| Result | Action |
| --- | --- |
| `feedback` | Read the events. Apply authorized changes. Acknowledge the receipt. |
| `ended` | Stop waiting. Reopen only on request. |
| `interrupted` | The server stopped. Check `humagent status` before you run `wait` again. |

`ack --receipt` completes only the events of that receipt. Use the receipt from the latest `wait`.

Events stay unfinished until their receipt is acknowledged. The next `wait` returns them again. Check event IDs before you repeat consequential actions.

Agent harnesses can stop long commands. If `wait` stops before a result, run it again. Unacknowledged events stay queued.
In Claude Code, run `wait` as a background task. Claude Code wakes the agent when the command exits.

## Server and storage

```sh
humagent status [SESSION]
humagent end SESSION
humagent stop
humagent server --port N
```

`status` reports the runtime, package files, server, and sessions. `status SESSION` reports one session. With a stopped server it reports the runtime instead. It never starts a stopped server.

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
| Command fails | Run `humagent status`. Read `server.log` in the data directory. |
| Port conflict | Free the configured port. Otherwise, unset `HUMAGENT_PORT`. |

## Stored sessions

Sessions from other development versions are reported as unreadable. Humagent leaves their files unchanged. Use a new data directory with `--home` or `HUMAGENT_HOME`.
