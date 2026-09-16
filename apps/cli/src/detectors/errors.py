"""Detector errors whose *type* the pipeline acts on.

Kept free of heavy imports so the pipeline can recognise them without loading
any engine, and kept to a single string argument so they survive pickling
across the detector worker-pool process boundary with their class intact.
"""

from __future__ import annotations


class ProviderRefusedError(RuntimeError):
    """A provider refused the request in a way retrying cannot fix.

    Quota exhausted for the day, a rejected key, billing. The next asset will be
    refused the same way, so the pipeline disables the detector for the rest of
    the run on the first one instead of paying for the same answer on every
    asset — which is what held the only runner slot for 10 hours a day when a
    free-tier LLM provider started refusing its key.
    """
