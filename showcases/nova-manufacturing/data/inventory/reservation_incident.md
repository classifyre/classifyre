# Reservation service trace RES-51

Warehouse management · Friday 2 October 2026, 08:04 UTC

TR51 and TR52 both originally read the Hamburg bearing-kit stock at version 7. Each successful new reservation changes the version once. Requests carry full requested quantities, not inventory movements. On a retry the service may return the existing decision.

The idempotency key is scoped to the request payload; reusing it with a different quantity or proposal is an error. The later stock snapshot includes only these reservations and the original 40-kit safety buffer. There has been no physical dispatch.
