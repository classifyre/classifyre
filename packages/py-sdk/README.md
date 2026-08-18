# classifyre-sdk

The surface a **custom source notebook** is written against.

A custom source is a [marimo](https://docs.marimo.io) notebook that defines
three top-level functions. Classifyre imports the notebook and calls them; the
notebook never constructs a Classifyre asset, computes a hash, or reads
`os.environ`.

```python
with app.setup:
    from classifyre import AssetContent, AssetRef, context
    ctx = context()

@app.function
def check(ctx) -> None:
    """Raise to fail 'Test connection'."""

@app.function
def discover(ctx) -> list[AssetRef]:
    """Phase 1: list what exists. Cheap - no content fetching."""

@app.function
def fetch(ctx, ref: AssetRef) -> AssetContent:
    """Phase 2: return the content for one ref."""
```

Configuration reaches the notebook through `ctx`:

- `ctx.variables["BASE_URL"]` - the source's non-secret key/value pairs.
- `ctx.secrets["API_TOKEN"]` - the source's encrypted key/value pairs, injected
  at run time. They are never written into the notebook file, so a notebook that
  is saved, versioned or exported carries no credential material.
- `ctx.run_id`, `ctx.source_id`, `ctx.mode`, `ctx.workspace` - run metadata.

`ctx.mode` is `"interactive"` while you are editing the notebook and
`"scan"` during a real run, which is the hook for keeping development cheap:

```python
limit = 10 if ctx.is_interactive else None
```
