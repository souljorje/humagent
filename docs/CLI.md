# Commands

See the [README](../README.md#install) for installation. Use `humagent --help` for syntax or `--version` for the version.

Use `--json` for JSON results. Piped results also use JSON.

## Agent loop

```sh
humagent ./page.html
humagent http://127.0.0.1:3000/path
# Apply and check the feedback.
humagent ./page.html --done RECEIPT
```

`humagent SOURCE` opens the source, or reuses its session, and waits for feedback. The first call opens the browser.
It prints the private URL on the error stream. The result adds the session ID to the feedback.

`--done RECEIPT` completes that receipt, then waits again. Repeat this command until the session ends.

Keep the page and its assets in one directory. Humagent serves supported files from that directory. See [network restrictions](SECURITY.md#network).
Use `--no-open` to open the URL yourself.
Use `--no-wait` to exit after the command opens the page or completes the receipt.

Proxied event streams stay open while idle after their headers arrive. Other proxied HTTP responses keep a 15-second idle timeout.

## Demo

```sh
humagent demo
```

The demo opens an editable plan under `demos/VERSION/plan` in the data directory. It preserves existing files.

## Agent skill

The package does not include the skill. Install it with the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add souljorje/humagent
```

Update it with `npx skills update humagent`.

## Receive input

Each **Send** action delivers one feedback with an optional `instruction` and ordered `reviews`. See the [feedback format](SDK.md#feedback-format).
One receipt can cover several feedback entries. Process the `instruction` and `reviews` of each entry together.

The command blocks until the human sends feedback or ends the session. It has no time limit.
The server sends a space every 5 seconds to keep the connection open. The CLI prints only the result.

| Result | Action |
| --- | --- |
| `feedback` | Apply authorized changes. Then run the command with `--done RECEIPT`. |
| `ended` | Stop waiting. Reopen only on request. |
| `interrupted` | The server stopped. The command starts it again, so run it only when the work continues. |

Delivered feedback shows **Agent working** in the bar. The status stays until the agent completes the receipt.
Feedback stays unfinished until completion. The next wait returns it again with a new receipt. Check feedback IDs before you repeat consequential actions.

Agent harnesses can stop long commands. If the command stops before a result, run it again. Unfinished feedback stays queued.
Use background waiting only when the harness automatically resumes the agent on completion. Otherwise, keep the agent turn active.

## Server and storage

```sh
humagent status [SESSION]
humagent end SESSION
humagent stop
humagent server --port N
```

`status` reports the runtime, package files, server, and sessions. `status SESSION` reports one session. With a stopped server it reports the runtime instead. It never starts a stopped server.

`end` rejects new input but keeps queued feedback available. `stop` retains saved sessions.

| Setting | Meaning |
| --- | --- |
| `--home PATH` | Data directory for this command |
| `HUMAGENT_HOME` | Default data directory, otherwise `~/.humagent` |
| `HUMAGENT_PORT` | Server port, or `0` for a free port |

The server selects a free loopback port at each start unless `--port` or `HUMAGENT_PORT` sets one.
After a restart, run `humagent SOURCE` again. It reuses the saved session and prints the new URL.
Use the same data directory across commands. Each session file under `sessions/` keeps pending reviews and feedback.

## Troubleshooting

| Problem | Action |
| --- | --- |
| No agent connected | Start `/humagent SOURCE` in your agent chat. |
| Feedback stays pending | Open the bar and choose Send. Forms and SDK calls only save pending reviews. |
| Agent turn ended | Send the agent a new message. |
| Browser did not open | Open the printed URL on the same computer. |
| Older server running | Run `humagent stop`. Run `humagent SOURCE` again. |
| Server restarted | Run `humagent SOURCE` again. Use the new URL. |
| Source changed | Follow [refresh and recovery](USAGE.md#refresh-and-recovery) and inspect [revision rules](SDK.md#revisions). |
| App cannot connect | Check its HTML route and [attachment limits](SECURITY.md#network). |
| Stored session is unreadable | See [stored sessions](#stored-sessions). |
| Command fails | Run `humagent status`. Read `server.log` in the data directory. |
| Port conflict | Free the configured port. Otherwise, unset `HUMAGENT_PORT`. |

## Stored sessions

Sessions from other versions are reported as unreadable. Humagent leaves their files unchanged. Use a new data directory with `--home` or `HUMAGENT_HOME`.
