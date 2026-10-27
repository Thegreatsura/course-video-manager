# Never while Matt is filming

A verification run loads the machine Matt records on. While he is filming,
nothing here may start a server or drive the app, and **the harness checks
this for you, before every step**: `launch`, `ab`, `shot`, `snap`, `cvm` and
`tiny-course` each ask `scripts/is-filming.sh` first. While he films, the verb
pauses, prints why and re-checks every 60 s, then carries on by itself:

```text
PAUSED: Matt is filming, so `verify.sh ab` waits. Do not work around this.
  filming: 2026-10-27T11:58:53.007Z recorder service listening on ws://127.0.0.1:5177 (pid 1604238)
  Re-checking every 60s; it carries on by itself when he stops.
```

Give a gated verb a long timeout, or run it in the background. Never kill a
paused verb to try something else, and never drive the app any other way to
get round the pause. `cleanup` and the read-only verbs (`url`, `dir`,
`session`, `doctor`, `guard`, `sql`, `mode`, `template`) never wait: stopping
a run is always allowed.

`scripts/is-filming.sh` (repo root) is the one check, for any tooling that
needs it. Exit 0 means filming, 1 means not; `-v` prints why. Filming means
`.data/logs/recorder-service.log` in Matt's main checkout has a `listening`
line after its last `stopped cleanly` line. It finds that checkout through
Git from any worktree, and it only reads the log: it never contacts the
recorder or Matt's app.
