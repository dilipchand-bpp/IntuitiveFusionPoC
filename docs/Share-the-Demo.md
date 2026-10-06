# Sharing the demo with someone outside your network

The app runs on your laptop. To let a person validate it from theirs, put a tunnel in front of the web port. The tunnel gives them an https address; your laptop does the work, so it has to stay on, awake and online while they use it.

## Which option

| Option | Works for this app? | Notes |
| --- | --- | --- |
| **Cloudflare Tunnel** | **Yes. Recommended.** | Free. A "quick tunnel" needs no account and gives a random address that changes each time. With a free Cloudflare account you can add Cloudflare Access, which asks each visitor for a one-time code sent to their email and lets in only the addresses you list. That is the safest way to share. A permanent address needs a domain on Cloudflare |
| **ngrok** | Yes | Easy, needs a free account. The free plan gives one fixed address, shows a "visit site" warning page on a first visit, and has usage limits. Limiting visitors to named people is a paid feature |
| Vercel, Netlify | **No** | They run short-lived functions with no lasting disk. This app has a long-running API server and keeps its data in files, so it would need to be redesigned around a hosted database first (that is the real-PostgreSQL work planned in M17) |
| GitHub Pages | **No** | Static pages only; there is no server to run the API |

A hosted copy that does not depend on your laptop becomes possible after M17 (real PostgreSQL, a container image). Free hosting terms change, so check them then.

## Steps (Cloudflare quick tunnel)

1. Install the tunnel program once. From PowerShell: `winget install Cloudflare.cloudflared` (it is a download from Cloudflare; install it only if you are happy to).
2. Stop the development servers. The production start needs the ports and the database to itself.
3. Make a fresh demo database, so the visitor starts from the known data:
   ```powershell
   npm run db:reset
   ```
4. Build once, then start in production mode:
   ```powershell
   npm run build
   npm run demo:start
   ```
   Leave this window open. The app is at http://localhost:3000. Share only the **web** port (3000). Never expose 4000: the web server passes `/api/v1` on to the API, so visitors never need it.
5. In a second window:
   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```
   It prints an address ending in `trycloudflare.com`. Send that address to the person.
6. When they have finished, press Ctrl+C in both windows. The address stops working at once.

Keep the laptop awake while sharing (Windows power settings, "never sleep when plugged in"), and use a wired or strong connection.

## Before you send the address

- **The demo password is public.** It is in the project documents, and anyone who has the address and the password can sign in as any of the 13 demo users, including the administrator. Do one of these:
  - set a private password before the reseed: add `SEED_PASSWORD=<something only you and they know, at least 8 characters, longer is better>` to `.env`, then run `npm run db:reset`; and/or
  - put Cloudflare Access in front (see below) so only listed email addresses reach the login page at all.
- Send each person the one or two logins they need (for example `procurement@meridian-demo.example` and `exec@meridian-demo.example`), not the whole list.
- The data is synthetic, but nothing stops a visitor changing it. Run `npm run db:reset` before each new visitor.
- The supplier registration page is open to anyone with a tender invitation link, as designed. The Ask AI assistant and every report only show what the signed-in role may see.
- You can watch what they do: Administration, then the audit trail.

## A stable address, limited to named people (Cloudflare Access)

You need a free Cloudflare account and a domain managed there (a domain costs a few dollars a year).

1. In Cloudflare, Zero Trust, Networks, Tunnels: create a tunnel, choose Windows, and run the command it shows. Add a public hostname such as `demo.yourdomain.example` pointing to `http://localhost:3000`.
2. Zero Trust, Access, Applications: add a self-hosted application for that hostname, and a policy "Allow" with "Emails" set to the people you list. Visitors get a one-time code by email.
3. Keep `npm run demo:start` running. The same address works every time until you remove the tunnel.

## Things to know

- The first load after `demo:start` can take a few seconds while the pages warm up.
- If a visitor reports they cannot sign in, check that the API window has not stopped (it says "api stopped" and stops the web server too).
- The real map in the supplier risk screen uses OpenStreetMap tiles, so the visitor's browser needs an internet connection for the map background; the pins and the table work without it.
- This is a proof of concept, not a hardened internet service. Do not leave the tunnel running unattended, and never use real data.
