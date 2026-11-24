# Runbook: traffic, visitor logs and crawlers

Decision: `docs/decisions.md` 2026-11-24 "Photo cache, crawler rules, visitor log". Companion: `docs/runbooks/deploy.md`, `docs/runbooks/seo.md`.

## What exists

| Piece               | Where                                                   | What it does                                                                                      |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Visitor log         | Caddy, `deploy/Caddyfile` (snippet `access_log`)        | One JSON line per request to mechdost.com and api.mechdost.com, in volume `caddy_logs`            |
| Rotation            | same                                                    | 16 MiB per file, 5 rolled files kept, rolled files older than 30 days deleted: at most 96 MiB     |
| Crawler rules       | `apps/web/src/lib/crawler-blocklist.ts` → `/robots.txt` | AI-training scrapers and SEO-tool crawlers are asked to stay out. Search engines are not listed   |
| Product photo cache | API memory (`PHOTO_CACHE_MB`, default 64)               | Repeat views of a public product photo skip Supabase Storage (egress, free plan about 5 GB/month) |

Nothing here blocks, challenges or rate-limits any visitor. robots.txt is a request that well-behaved bots honour; the
log only records.

## What is and is not in the log

- Logged: time, client IP (`request>remote_ip` and `X-Forwarded-For` if any), method, host, path, status, size,
  duration, `User-Agent`.
- Not logged: the query string (everything after `?` becomes `?REDACTED`, in the URI and in `Referer`; reset links carry
  `oobCode`, share links carry tokens), `Authorization`, `Cookie`, `Set-Cookie` and `Proxy-Authorization` (Caddy writes
  `REDACTED` for these by default, `log_credentials` is not set), TLS details, response headers.
- Privacy (DPDP): an IP address is personal data. Purpose: security and abuse handling and traffic statistics only;
  retention 30 days at most (`roll_keep_for 720h`), and the volume holds at most 96 MiB. It is never joined to a user
  account and never exported. Mention it in the privacy notice (spec 13 "Privacy notice").

## One-line commands (on the server, `cd /opt/mechdost`)

The log lives in the volume; read it through the caddy container. JSON fields: `request.uri`, `request.remote_ip`,
`request.headers["User-Agent"][0]`, `status`, `size`, `duration`.

```
# last 20 requests
docker compose exec caddy tail -n 20 /var/log/caddy/access.log

# top 20 user agents (needs jq on the server: sudo apt install jq)
docker compose exec caddy cat /var/log/caddy/access.log | jq -r '.request.headers["User-Agent"][0] // "-"' | sort | uniq -c | sort -rn | head -20

# top 20 paths
docker compose exec caddy cat /var/log/caddy/access.log | jq -r '.request.uri' | sort | uniq -c | sort -rn | head -20

# top 20 client IPs
docker compose exec caddy cat /var/log/caddy/access.log | jq -r '.request.remote_ip' | sort | uniq -c | sort -rn | head -20

# who is fetching product photos (top agents on the image route)
docker compose exec caddy cat /var/log/caddy/access.log | jq -r 'select(.request.uri | test("^/v1/product-photos/")) | .request.headers["User-Agent"][0] // "-"' | sort | uniq -c | sort -rn | head

# requests per status code
docker compose exec caddy cat /var/log/caddy/access.log | jq -r '.status' | sort | uniq -c | sort -rn
```

Without `jq`: `grep -o '"User-Agent":\["[^"]*"' /var/log/caddy/access.log` (inside the container) then `sort | uniq -c`.
Rolled files are `access-<time>.log` (older ones may be gzip-less); add them to `cat` with `/var/log/caddy/access*.log`.

Photo cache hits and misses are in the API log: `docker compose logs api | grep photo_cache` (a summary line every
500 lookups: `hits`, `misses`, `entries`, `bytes`).

## Blocking an abusive bot (only if needed, by hand)

First choice is always robots.txt: add the name to `crawler-blocklist.ts`. A bot that ignores robots.txt can be refused in
Caddy. Edit `deploy/Caddyfile` in a commit (never on the server only), inside the site block, before `reverse_proxy`:

```
	@badbot header_regexp User-Agent (?i)(BadBotName|OtherBot)
	respond @badbot 403
```

An abusive IP: `@badip remote_ip 203.0.113.7` then `respond @badip 403`. Take the address from the top-IP command above,
check it is not Googlebot/Bingbot (reverse-DNS) and not a shared office or mobile-carrier address before blocking. Deploy
with `gh workflow run deploy.yml`, or on the server `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`
after copying the file. Never block by a broad pattern that could match a browser ("Mozilla", "Android", "WhatsApp",
"facebookexternalhit"); those are real visitors and share-card fetchers.

## Applying the log change the first time (lead, on the server)

1. Deploy the commit (the workflow copies `deploy/` and runs `docker compose up -d`); compose creates volume `caddy_logs`.
2. Caddy needs a restart (not only a reload) to start a new output file: `docker compose up -d --force-recreate caddy`.
3. Check: `docker compose exec caddy ls -l /var/log/caddy`, load the site, then `docker compose exec caddy tail -n 3 /var/log/caddy/access.log`.
   A visit to `/auth/action?oobCode=abc` must show `"uri":"/auth/action?REDACTED"`.
4. If Caddy fails to start, `docker compose logs caddy` names the line; the previous Caddyfile is in git.
