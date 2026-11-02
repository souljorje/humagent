# Commands

Requires Node.js 22+ or Bun 1.4.4+. See the [README](../README.md#start) for installation.

`humagent --help` lists commands. `humagent --version` prints the installed version. Use `--json` for JSON output. Piped output also uses JSON.

## Open a page

```sh
humagent open ./page.html
humagent open http://127.0.0.1:3000/path
humagent open ./page.html --no-open --json
```

`open` starts the server if needed and returns a session ID and private browser URL.

Use a dedicated artifact directory. Humagent serves supported sibling assets from that directory.

`--network` allows external resources for trusted HTML files. Without it, Humagent blocks external connections and resources.

## Demos

```sh
humagent demo
humagent demo calculator
humagent demo existing
```

The default demo is `plan`. Demos copy examples to `demos/VERSION` under the data directory without overwriting existing copies.

## Install the agent skill

```sh
humagent setup
humagent setup --directory ./my-agent/skills/humagent
```

The default location is `.agents/skills/humagent` in the current project. Setup leaves identical files unchanged.

To replace a modified skill, preserve any custom instructions first. Then run:

```sh
humagent setup --directory ./my-agent/skills/humagent --force
```

Setup does not change global agent configuration.

## Receive input

```sh
humagent wait SESSION --consumer my-agent --timeout 50 --lease 600
```

Use the session ID returned by `open`.

| Option | Meaning | Default | Range |
| --- | --- | --- | --- |
| `--timeout` | Seconds to wait for input | 50 | More than 0, up to 600 |
| `--lease` | Seconds to reserve a delivered batch | 120 | 1–3600 |

| Result | Next action |
| --- | --- |
| `feedback` | Read all events. Apply authorized changes. Acknowledge the receipt. |
| `timeout` | Repeat `wait` while review remains active. |
| `ended` | Stop waiting. Reopen only on request. |
| `interrupted` | Check server status before resuming. |

Keep `wait` attached to the active agent turn. A detached process does not guarantee agent resumption.

Events remain stored until acknowledgment. They can arrive again after lease expiry. Check event IDs before repeating consequential actions.

## Reply and acknowledge

```sh
humagent reply SESSION --receipt RECEIPT --message "Updated the page."
humagent ack SESSION --receipt RECEIPT
humagent renew SESSION --receipt RECEIPT --lease 600
```

Use the receipt returned by `wait`.

| Command | Effect |
| --- | --- |
| `reply --receipt` | Send a reply and complete that batch. |
| `reply` without a receipt | Send a reply without completing work. |
| `ack` | Complete the batch without a reply. |
| `renew` | Extend the lease. Run it before expiry. |

Newer input remains queued. Run `wait` again to receive it.

## Inspect and stop

| Command | Effect |
| --- | --- |
| `humagent status [SESSION]` | Show sessions without starting a stopped server. |
| `humagent doctor` | Show runtime details and check packaged files. |
| `humagent end SESSION` | Reject new input. Keep previously queued input available. |
| `humagent stop` | Stop the server without deleting sessions. |

## Storage and ports

| Setting | Meaning |
| --- | --- |
| `--home PATH` | Data directory for this command |
| `HUMAGENT_HOME` | Default data directory, otherwise `~/.humagent` |
| `HUMAGENT_PORT` | Server port, or `0` for a free port |
| `humagent server --port N` | Start a foreground server on port N |

The default server uses a free loopback port. Commands must use the same data directory to share sessions. Keep that directory private.

## Troubleshooting

| Problem | Action |
| --- | --- |
| No agent is listening | Ask your agent to run `humagent wait SESSION`. Queued input remains available. |
| The agent turn ended | Send the agent a new message, unless its harness provides a supported completion callback. |
| The browser did not open | Open the printed URL. Use `--no-open` on a headless computer. The browser normally runs on the same computer. |
| An older server is running | Run `humagent stop`, then repeat `open`. Saved sessions remain available. |
| The source changed | Refresh, check the target, discard the stale submission, then submit again. Do not relabel the old revision. |
| A local app does not connect | Check its server and final HTML route. CSP, frame restrictions, service workers, and absolute URLs can block attachment. |
| The command cannot start | Run `humagent doctor`. Check the runtime version and `server.log` in the data directory. |
| Port conflict | Set `HUMAGENT_PORT=0`. In PowerShell, use `$env:HUMAGENT_PORT="0"`. |
| npm package unavailable | Use the [CI archive](https://github.com/souljorje/humagent/actions) until the first npm release. |
