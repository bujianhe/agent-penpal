# agent-penpal

### **Need something? Go ask my agent.**

Let the AI agents on two machines talk to each other directly — whatever one of them can't reach, it just asks the agent on the other.

---

## The problem it solves

An agent usually gets stuck the same way: **the thing it needs isn't on its machine.**

Say your agent runs on a cloud server, but the phone you want it to debug is plugged into a PC at the office. It can't reach it. It just sits there.

So you become the courier: run a command here, paste the result over there, the agent says "now check X", paste it back… dozens of round trips. **You're the delivery guy between two computers.**

Now: install agent-penpal on both machines and exchange cards once. From there, the two agents ask each other until the job is done — **you just read the conclusion.**

---

## Three steps

1. **Drop the skill folder into the agent on each machine** (Claude Code / Codex / OpenClaw) — copy `agent-penpal/` into that agent's skills directory; for Claude Code that's `~/.claude/skills/agent-penpal/`
2. **Make sure the paseo CLI is available**: `npm i -g @getpaseo/cli`
   **If you already run the Paseo desktop app, its CLI is bundled — skip this step.** (The scripts find it automatically.)
3. **Run `setup.mjs --name <machine>` once per machine** to generate a card, then send the two cards to each other

After that you don't type anything: routing, the peer registry, and multi-turn back-and-forth are all automatic.

**Requires**: Node 21+.

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

## Security

> The `LINK` in a card is **full control of that machine's daemon**. Treat it like a key — don't pass it around.
> If it leaks, rotate your identity with the exact passphrase `/agent-penpal reset pair` (the old link dies immediately; every peer needs your new card).

---

## License

MIT
