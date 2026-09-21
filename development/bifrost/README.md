# Bifrost (dev) — config only

Dev LLM router config for Classifyre developers. You run Bifrost yourself
(pinned image `maximhq/bifrost:v2.2.0`) and mount this file as its config.
Apps talk OpenAI-protocol to Bifrost; it routes across **3 OpenRouter
accounts**, failing over on rate limits, 5xx, network errors, or timeouts.

`config.json` holds real keys, so **it is git-ignored** — fill in your three
`sk-or-...` keys and a random 32-byte `encryption_key` locally.

## Mount

```bash
docker run -d --name bifrost-dev -p 8888:8080 \
  -v "$PWD/config.json:/app/data/config.json" \
  maximhq/bifrost:v2.2.0
```

File-only mode (`config_store.enabled: false`): the file is the source of
truth — **restart the container after editing it**.

## Routing

Apps send `model: "house-model"` (or anything — the rule ignores it). Each
account's **key alias** rewrites it to `meta-llama/llama-3.3-70b-instruct`.
One catch-all rule (`request_type == 'chat_completion'`) sends everything to
account A, falling over to B, then C. Each account gets `max_retries: 2`
with 500ms → 5000ms backoff and a 60s request timeout.

## Verify

```bash
curl -s http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "literally-anything",
       "messages": [{"role": "user", "content": "say hi"}]}' \
| python3 -c "import json,sys; print(json.load(sys.stdin)['extra_fields']['routing_info'])"
```

`routing_info` shows the serving account, the resolved model id, and
`is_fallback: true` when a backup account served the request. To exercise
failover, point account A's key at an invalid value or its `base_url` at a
dead port, restart, and confirm B serves with `is_fallback: true` — then
revert.

## Gotchas

- Alias 404s don't fail over: if an alias names a model OpenRouter doesn't
  have, you get a hard 404, not a switch to the next account. Verify aliases
  against OpenRouter's model list after editing.
- Gateway auth is off: anything reaching port 8080 spends your credits —
  keep it on localhost.
- Only chat is enabled. If streamed requests bypass the catch-all, change its
  expression to `"true"`.
