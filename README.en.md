# agent-penpal

### **Need something? Go ask my agent.**

Let the AI agents on two machines talk to each other directly — whatever one of them can't reach, it just asks the agent on the other.

---

## The problem it solves

An agent usually gets stuck the same way: **the thing it needs isn't on its machine.**

Say your agent runs on a cloud server, but the phone you want it to debug is plugged into a PC at the office. It can't reach it. It just sits there.

So you become the courier: run a command here, paste the result over there, the agent says "now check X", paste it back… dozens of round trips. **You're the delivery guy between two computers.**

Now: install agent-penpal on both machines and **hand over a single card** — from there the two agents ask each other until the job is done. **You just read the conclusion.**

---

## Install

```bash
# Option 1 — plugin marketplace (recommended)
claude plugin marketplace add bujianhe/agent-penpal
claude plugin install agent-penpal@agent-penpal
```

Or **option 2 — copy the folder** into your agent's skills directory (for Claude Code, `~/.claude/skills/agent-penpal/`). For agents with no skills mechanism (plain AGENTS.md / system prompt), pasting the body of [SKILL.md](SKILL.md) works just as well.

Install it on **both** machines.

---

## Three steps

**You hand over one card. That's it.**

1. **Install it on both machines** (see "Install" above)
2. **Say "make me a card" on each** — the agent fills in whatever's missing (Node, the paseo CLI), starts the service, and hands you the card
3. **Give one of the cards to the other machine** and let it connect

That's already bidirectional: **every message carries the sender's own card at the top**, so both sides end up with each other's coordinates. **You only carry a card once.**

**No window to set up**: run it inside a Paseo session and it uses **the one you're already in**; run it from a plain terminal and it opens (or reuses) a resident window for you.

> Step 2 is the point: **you don't have to install paseo first.** If you run the Paseo desktop app, its CLI is already bundled; if not, the agent runs `npm i -g @getpaseo/cli` per [SKILL.md](SKILL.md) and carries on.

---

## No public IP needed

No public IP, no port forwarding, no tunneling service, no VPN.

Public reachability comes from **Paseo's built-in end-to-end encrypted relay** (built on Paseo). frp / ngrok / Tailscale / reverse SSH all exist to solve "how do the two sides reach each other" — here, that's built in.

---

## What using it looks like

Generate a card (once per machine):

```bash
node setup.mjs --name <machine>
```

Send the printed card to the other side; once they store it, they can reach you. After that, ask each other things:

```bash
node ask.mjs --peer <name> "Did your build finish?"
```

For long jobs, don't block: `--async` sends and returns; pull the answer later with `--replies`.

Other flags: `node <script> --help`, or just read [SKILL.md](SKILL.md).

---

## What you might be searching for

Cross-machine agents · let two computers' AIs talk to each other · agent connector · agent-to-agent (A2A) · agent interop beyond MCP · remote agent without a public IP · Claude Code / Codex / OpenClaw across machines · remote agent daemon · multi-machine automation · agents asking each other

---

## Security

> The `LINK` in a card is **full control of that machine's daemon**. Treat it like a key — don't pass it around.
> If it leaks, rotate your identity with the exact passphrase `/agent-penpal reset pair` (the old link dies immediately; every peer needs your new card).

---

## Disclaimer

**Not affiliated with, or endorsed by, the Paseo project.**

agent-penpal is an independent third-party tool. It only **calls** the Paseo CLI as a subprocess; this repository contains **no Paseo code**. Paseo is licensed under the Apache License 2.0 (© Mohamed Boudra), which grants **no trademark rights** — "Paseo" is used here only to describe the dependency.

---

## License

MIT
