# agent-penpal

### **Need something? Go ask my agent.**

Let the AI agents on two machines talk to each other directly — whatever one of them can't reach, it just asks the agent on the other.

---

## The problem it solves

Of everything that eats a programmer's time and energy, integration work is near the top. **What costs you isn't writing code — it's ferrying information between two machines.**

Half the system runs on one box, half on another, and the moment something breaks you're switching back and forth:

- Read the log on A → copy → switch to B, paste, ask "is this yours?"
- B says it needs one more value → back to A to re-run it → copy again, switch back
- The service is in the cloud, the phone is plugged in here, the code lives over there — **every extra environment is another human relay**
- At the end of the day you barely wrote any code; you spent it all as **a human message bus between two machines**

**But if both sides already have an AI agent, why is a person doing the carrying?**

Install agent-penpal and the two agents **talk to each other directly** — whatever one side is missing or needs verified, it just asks the other, until the job is done. **You only read the conclusion.**

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
2. **Say "make me a card" on each** (or just `/agent-penpal`) — the agent fills in whatever's missing (Node, the paseo CLI), starts the service, and hands you the card. **The first run is slower** — that's the dependencies installing.
3. **Give one of the cards to the other machine** (`/agent-penpal` followed by the card) and let it connect

That's already bidirectional: **every message carries the sender's own card at the top**, so both sides end up with each other's coordinates. **You only carry a card once.**

**No window to set up**: run it inside a Paseo session and it uses **the one you're already in**; run it from a plain terminal and it opens (or reuses) a resident window for you.

> Step 2 is the point: **you don't have to install paseo first.** If you run the Paseo desktop app, its CLI is already bundled; if not, the agent runs `npm i -g @getpaseo/cli` per [SKILL.md](SKILL.md) and carries on.

---

## No public IP, and no SSH

**No public IP, no port forwarding, no tunneling service, no VPN — and no SSH.**

No end that has to be reachable, no tunnel to set up, no keys to manage, no IP that changes on you.

Public reachability comes from **Paseo's built-in end-to-end encrypted relay** (built on Paseo). frp / ngrok / Tailscale / reverse SSH all exist to solve "how do the two sides reach each other" — here, that's built in.

---

## Compared with the usual approaches

**What we're most interested in removing is SSH.** No reachable end, no tunnel to configure, no keys to manage — **both machines just need internet access**.

| Approach | What it really requires |
|---|---|
| Copy-paste by hand | Nothing — the cost is your time |
| Reverse SSH tunnel | SSH that actually works (one end reachable) + a tunnel tool |
| frp / ngrok | A public server or an account |
| Tailscale / VPN | Both ends joined to the same virtual network |
| **agent-penpal** | **Internet access on both machines** |

---

## What using it looks like

**Day to day you don't type commands — you just tell the agent:**

| You say | It does |
|---|---|
| "Make me a card" / `/agent-penpal` | Hands you a card (installs whatever's missing first) |
| `/agent-penpal` + the other side's card | Connects to them |
| "Ask the PC whether its build finished" | Finds that machine, sends the message, brings the answer back |

> **A card is one machine paired with one session.** The LINK is that machine's identity; the AGENT is which session. One card per machine is usually enough; if you want a different session, make another card — same LINK, different AGENT.

Those are the commands it runs for you, if you'd rather do it by hand:

```bash
node setup.mjs --name <machine>          # make a card
node ask.mjs --peer <name> "Did your build finish?"   # ask (blocks for the reply by default)
```

For long jobs, don't block: `--async` sends and returns; pull the answer later with `--replies`.

Other flags: `node <script> --help`, or just read [SKILL.md](SKILL.md).

---

## Other ways people use it

- **Pairing up on an integration**: agree on the boundary up front, let each side's agent own half, and let them converge on the problem between themselves.
- **Handing off work remotely**: from home, give your office machine a task and let the machine at home verify and guide — no remote desktop, no VPN.
- **SDK / platform support**: open a session in the repo and hand the pairing link to whoever is integrating. When they get stuck it's literally: **"Need something? Go ask my agent."**
- **When one machine can't reach the other's stuff**: the device is plugged in here, the service runs there, the build environment only exists on a third box — ask the agent that has it.

---

## What you might be searching for

Cross-machine agents · let two computers' AIs talk to each other · agent connector · agent-to-agent (A2A) · agent interop beyond MCP · remote agent without a public IP · behind NAT · zero-infrastructure · no server, no accounts, no open ports · Claude Code / Codex / OpenClaw across machines · cross-harness · agent message bus · multi-machine agent collaboration

---

## Security

> The `LINK` in a card is **full control of that machine's daemon**. Treat it like a key — don't pass it around.
> If it leaks, rotate your identity with the exact passphrase `/agent-penpal reset pair` (the old link dies immediately; every peer needs your new card).

---

## Dependency

This project **calls** the Paseo CLI as a subprocess ([Paseo](https://github.com/getpaseo/paseo) is licensed under the Apache License 2.0, © Mohamed Boudra). **No Paseo code is bundled here.**

---

## License

MIT
