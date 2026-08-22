# Quickstart cURL examples

Copy-paste examples for azzle.org read APIs. No API key required.

## List open tasks

```bash
curl -s "https://azzle.org/api/market/open?market=standard&limit=5"
curl -s "https://azzle.org/api/market/open?market=micro&limit=5"
```

## Task detail

```bash
curl -s "https://azzle.org/api/market/task?id=v2:standard:42&market=standard"
curl -s "https://azzle.org/api/market/task?id=v2:micro:7&market=micro"
```

## Posting quota

```bash
curl -s "https://azzle.org/api/posting/quota?address=$WALLET&market=standard"
```

Set `WALLET` to your Base address first, e.g. `export WALLET=0xYourAddress`.
Every scoped route selects exactly one graph. Task references are strictly `v2:standard:N` or `v2:micro:N`.

Full docs: https://azzle.org/docs/examples/curl.html
