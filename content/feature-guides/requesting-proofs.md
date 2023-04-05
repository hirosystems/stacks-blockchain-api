---
Title: Requesting proofs
---

# Requesting Proofs

Several endpoints will request the [MARF Merkel Proof](https://github.com/stacksgov/sips/blob/main/sips/sip-004/sip-004-materialized-view.md#marf-merkle-proofs) by default.

Provided with the proof, a client can verify the value, cumulative energy spent, and the number of confirmation for the response value provided by the API.

Requesting the proof requires more resources (computation time, response time, and response body size). To avoid the additional resources, in case verification is not required, API endpoints allow setting the request parameter: `proof=0`. The returned response object will not have any proof fields.
