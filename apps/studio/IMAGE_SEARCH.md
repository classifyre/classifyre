# Image sources with curl — Pexels, Tumblr, Cosmos


---

## 0. Credentials

| Service | Env vars (`.env`) | Auth | Needed for |
|---|---|---|---|
| Pexels | `PEXELS_API_KEY` | plain `Authorization` header | search, curated, download |
| Tumblr | `TUMBLR_KEY`, `TUMBLR_SECRET` | OAuth 1.0a (HMAC-SHA1 signed) | `/v2/tagged` |
| Cosmos | *(none)* | none, public GraphQL | search |

```sh
export PEXELS_API_KEY=$(grep '^PEXELS_API_KEY=' .env | cut -d= -f2-)
export TUMBLR_KEY=$(grep '^TUMBLR_KEY=' .env  | cut -d= -f2-)
export TUMBLR_SECRET=$(grep '^TUMBLR_SECRET=' .env | cut -d= -f2-)
```

Toggle flags used by the pipeline: `PEXELS_ENABLED`, `TUMBLR_ENABLED`, `COSMOS_ENABLED`.

---

## 1. Pexels — easiest

Base: `https://api.pexels.com/v1`. The key goes in the `Authorization` header **raw** (no `Bearer `).

### Search

```sh
curl -s -H "Authorization: $PEXELS_API_KEY" \
  'https://api.pexels.com/v1/search?query=brutalist+architecture&orientation=landscape&size=large&per_page=15&page=1'
```

Parameters: `query`, `per_page` (1–80), `page`, `orientation` = `landscape|portrait|square`, `size` = `large|medium|small`, `color` (name or hex like `%23ff0000`).

### Pull just what you need

```sh
curl -s -H "Authorization: $PEXELS_API_KEY" \
  'https://api.pexels.com/v1/search?query=office&per_page=5&orientation=landscape' \
| jq -r '.photos[] | [.id, .width, .height, .photographer, .src.large2x] | @tsv'
```

Response shape: `photos[]` with `id`, `url` (page URL), `photographer`, `photographer_url`, `alt`, `width`, `height`, and `src{original,large2x,large,medium,small,portrait,landscape,tiny}`.

### First usable image + download

```sh
curl -s -H "Authorization: $PEXELS_API_KEY" \
  'https://api.pexels.com/v1/search?query=abstract+texture&per_page=10&orientation=landscape&size=large' \
| jq -r '.photos[0].src.landscape' \
| xargs curl -sL -o featured.jpg
```

### Other endpoints

```sh
curl -s -H "Authorization: $PEXELS_API_KEY" 'https://api.pexels.com/v1/curated?per_page=5'
curl -s -H "Authorization: $PEXELS_API_KEY" 'https://api.pexels.com/v1/photos/4328661'
curl -s -H "Authorization: $PEXELS_API_KEY" 'https://api.pexels.com/v1/collections/featured?per_page=5'
curl -s -H "Authorization: $PEXELS_API_KEY" 'https://api.pexels.com/videos/search?query=city&per_page=5'   # video API
```

Gotchas:

- Free tier is rate-limited (~200 req/h, 20k/month).
- No key ⇒ `401`; `per_page` > 80 ⇒ error.
- Attribution to the photographer is required when publishing.

---

## 2. Tumblr — needs OAuth 1.0a signing

`curl` has no built-in OAuth 1.0a signer, so sign with `openssl` + `jq` (both ship with macOS). No user token is needed for `/v2/tagged` — the consumer key/secret pair is enough.

### Reusable helper (verified working)

```sh
tumblr_tagged() {   # $1=tag  $2=limit  $3=before (unix ts, optional)
  local tag="$1" limit="${2:-20}" before="${3:-}" url='https://api.tumblr.com/v2/tagged'
  local key="$TUMBLR_KEY" secret="$TUMBLR_SECRET"
  local enc nonce ts p sig

  enc() { printf %s "$1" | jq -sRr @uri; }

  nonce=$(openssl rand -hex 16)
  ts=$(date +%s)

  # params sorted alphabetically, key and value RFC3986-encoded
  p="filter=raw&limit=${limit}&oauth_consumer_key=$(enc "$key")&oauth_nonce=${nonce}"
  p="${p}&oauth_signature_method=HMAC-SHA1&oauth_timestamp=${ts}&oauth_version=1.0&tag=$(enc "$tag")"
  [ -n "$before" ] && p="before=${before}&${p}"   # keeps sort order: before < filter

  # base string: METHOD&encoded_url&encoded_params ; signing key: secret& (empty token secret)
  sig=$(printf %s "GET&$(enc "$url")&$(enc "$p")" \
        | openssl dgst -sha1 -binary -hmac "${secret}&" | openssl base64 -A)

  curl -s --max-time 30 \
    -H "Authorization: OAuth oauth_consumer_key=\"$(enc "$key")\", oauth_nonce=\"${nonce}\", oauth_signature=\"$(enc "$sig")\", oauth_signature_method=\"HMAC-SHA1\", oauth_timestamp=\"${ts}\", oauth_version=\"1.0\"" \
    "${url}?tag=$(enc "$tag")&limit=${limit}&filter=raw${before:+&before=$before}"
}
```

Call it:

```sh
tumblr_tagged architecture 20 > tagged.json
jq '{posts: (.response|length), photos: [.response[]|select(.type=="photo")]|length}' tagged.json
```

### Extract original-size image URLs (photo posts only)

```sh
jq -r '.response[]
       | select(.type == "photo")
       | .photos[].original_size.url' tagged.json
```

Per photo you also get `alt_sizes[]` (`width`, `height`, `url`). Per post: `post_url`, `blog_name`, `tags`, `summary`. The publisher keeps the post with the most tags as "best".

### Download

```sh
jq -r '.response[] | select(.type=="photo") | .photos[0].original_size.url' tagged.json \
| head -1 | xargs curl -sL -o tumblr.jpg
```

Gotchas:

- The signature must cover **all** query params, sorted and RFC3986-encoded, and the same values must be in the URL — mismatch ⇒ `401`.
- `limit` is capped at **20 posts/page** server-side, even if you ask for 300 (the current code passes `limit=300` and still gets 20). Page with `before=<timestamp of last post>`.
- Only `type == "photo"` posts carry `photos`; skip text/quote/video posts.
- Generate a fresh nonce and timestamp for every request; never reuse a signature.
- Rate limits are per-hour per key — loop over tags gently.

---

## 3. Cosmos (cosmos.so) — public GraphQL, no auth

`POST https://api.www.cosmos.so/graphql` with a JSON body `{operationName, variables, query}`. Always send `Content-Type: application/json` and a browser-ish `User-Agent`.

### Minimal search query (verified)

```sh
curl -s https://api.www.cosmos.so/graphql \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0' \
  --data '{
    "operationName": "SearchGlobalElementsUser",
    "variables": {"searchTerm": "brutalist architecture", "origin": "SEARCH_BOX"},
    "query": "query SearchGlobalElementsUser($searchTerm: String!, $origin: SearchOrigin) { search(searchTerm: $searchTerm, searchOrigin: $origin) { elements(meta: {pageSize: 40}) { items { id image { url width height } } meta { count nextPageCursor } } } }"
  }'
```

The repo's full query (`src/shared/utils/cosmos_so.py`) selects many more fields — `ownerName`, `isPublicDomain`, `notSafeForWorkStatus`, `generatedCaption`, plus fragments for Twitter/Instagram/video elements. The trimmed query above is enough for image sourcing.

### Extract a usable image (≥ 600 px on the short side, like the repo)

```sh
curl -s https://api.www.cosmos.so/graphql \
  -H 'Content-Type: application/json' -H 'User-Agent: Mozilla/5.0' \
  --data '{"operationName":"SearchGlobalElementsUser","variables":{"searchTerm":"moody forest","origin":"SEARCH_BOX"},"query":"query SearchGlobalElementsUser($searchTerm: String!, $origin: SearchOrigin) { search(searchTerm: $searchTerm, searchOrigin: $origin) { elements(meta: {pageSize: 40}) { items { id image { url width height } } meta { count nextPageCursor } } } }"}' \
| jq -r '[.data.search.elements.items[]
          | select(.image.url != null and .image.width >= 600 and .image.height >= 600)][0].image.url'
```

### Pagination

Read `data.search.elements.meta.nextPageCursor` and pass it back as `pageCursor`. Declare it in the query:

```graphql
query SearchGlobalElementsUser($searchTerm: String!, $origin: SearchOrigin, $pageCursor: String) {
  search(searchTerm: $searchTerm, searchOrigin: $origin) {
    elements(meta: {pageSize: 40, pageCursor: $pageCursor}) {
      items { id image { url width height } }
      meta { count nextPageCursor }
    }
  }
}
```

```sh
--data '{"operationName":"SearchGlobalElementsUser",
         "variables":{"searchTerm":"typography","origin":"SEARCH_BOX","pageCursor":"cursor://recsys/search?..."},
         "query":"... elements(meta: {pageSize: 40, pageCursor: $pageCursor}) ..."}'
```

### Download

```sh
curl -sL -o cosmos.jpg 'https://cdn.cosmos.so/546ace82-7662-49f1-b54a-a59a059c3819'
```

Gotchas:

- **No auth, no API key.** `COSMOS_ENABLED` only toggles it inside the pipeline.
- CDN URLs have **no file extension** — sniff the type (see §4).
- Page size is 40; `meta.count` saturates at 500, so deep paging is limited.
- Undocumented/private API used by the website itself: fields and the operation name can change without notice. Keep the `User-Agent` header and expect occasional breakage.

---

## 4. Uniform "download the bytes" step

Pexels and Tumblr return URLs with an extension; Cosmos does not. One shape that handles all three:

```sh
url='https://cdn.cosmos.so/...'
ct=$(curl -sL -o /tmp/img.part -w '%{content_type}' --max-time 30 "$url") || exit 1
case "$ct" in
  image/jpeg) ext=jpg ;;
  image/png)  ext=png ;;
  image/webp) ext=webp ;;
  *)          ext=bin ;;
esac
mv /tmp/img.part "featured.$ext"
```

Sanity check the result: `file featured.$ext` → e.g. `JPEG image data ... 1080x1348`.

---

## 5. Source order and dedupe

Order in `publisher_agent.py`:

1. existing feature image from the blog post (`PUBLISHER_USE_FEATURE_IMAGE=true`),
2. AI image generation (if enabled),
3. **Cosmos** — first blog tag, ≥ 600 px short side,
4. **Tumblr** — all tags, post with the most tags,
5. **Pexels** — first result for the joined tags.

Used URLs are tracked per brand in `out/<brand>/state/publisher_images.json` (`{"cosmos": [...], "tumblr": [...], "pexels": [...]}`) so images are not reused. To mirror that in a shell script:

```sh
# skip URLs already used
grep -vxF -f out/mybrand/state/used_cosmos.txt < candidates.txt | head -1
```

---

## 6. Quick smoke test

```sh
# Pexels
curl -s -o /dev/null -w 'pexels: %{http_code}\n' -H "Authorization: $PEXELS_API_KEY" \
  'https://api.pexels.com/v1/search?query=nature&per_page=1'

# Cosmos
curl -s -o /dev/null -w 'cosmos: %{http_code}\n' https://api.www.cosmos.so/graphql \
  -H 'Content-Type: application/json' -H 'User-Agent: Mozilla/5.0' \
  --data '{"operationName":"SearchGlobalElementsUser","variables":{"searchTerm":"test","origin":"SEARCH_BOX"},"query":"query SearchGlobalElementsUser($searchTerm: String!, $origin: SearchOrigin) { search(searchTerm: $searchTerm, searchOrigin: $origin) { elements(meta: {pageSize: 1}) { meta { count } } } }"}'

# Tumblr (source the helper first, then)
tumblr_tagged architecture 1 | jq -r '.meta.status'
```

Expected: `200`, `200`, `200`.
