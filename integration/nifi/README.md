# Apache NiFi: order intake

`tourwerk-order-intake.json` is a NiFi 2.x flow definition with two pipelines.

**Webshop → Tourwerk** (every 30 s)

```
ListFile (/data/webshop/incoming/webshop-orders-*.csv)
  → FetchFile (moves the file to /processed)
  → ConvertRecord  CSVReader → JsonRecordSetWriter
  → JoltTransformJSON  [...] → { "orders": [...] }
  → InvokeHTTP  POST /api/integration/orders   (header x-integration-token)
      Response → PutFile /reports    (per-row result: created / duplicate / rejected)
      Retry | No Retry | Failure → PutFile /failed
```

**ERP export trigger** (every 5 min): `GenerateFlowFile → InvokeHTTP POST /api/integration/erp/export`.

The API side is built to be called by NiFi:

* **Idempotent:** `externalRef` is unique. A file that NiFi delivers twice creates no duplicates, and the report marks those rows `duplicate`.
* **Partial success:** each row is validated on its own. One bad row (wrong postcode, missing reference) is rejected without failing the batch. The response is 422 only if *every* row was rejected.
* **CSV-friendly:** strings are converted to numbers, `HH:MM` windows to minutes, and empty cells to "missing".

## Try it

```bash
docker compose --profile nifi up --build      # NiFi UI: https://localhost:8443/nifi (admin / see compose file)
```

1. In NiFi: *Upload flow definition* → `tourwerk-order-intake.json`. Set the parameter `integration_token` to the API's `INTEGRATION_TOKEN`, enable the controller services, then start the group.
2. Copy `sample/webshop-orders-2026-11-17.csv` (change the date to tomorrow) into the `nifi-inbox` volume at `/data/webshop/incoming`.
3. Five orders appear in Tourwerk under *Orders*. The sixth row (a Munich postcode) is listed as rejected in the report.

Without NiFi, the same call works directly:

```bash
curl -X POST localhost:4600/api/integration/orders \
  -H 'x-integration-token: dev-integration-token-change-me' -H 'content-type: application/json' \
  -d '{"orders":[{"externalRef":"SHOP-1","customer":"Optik Brandt","street":"Schulterblatt 61","postcode":"20357","weightKg":"6","windowStart":"10:00","windowEnd":"14:00","deliveryDay":"2026-11-17"}]}'
```

> Status: the API endpoint and its behaviour are covered by automated tests. The flow
> definition was written by hand and has not yet been imported into a running NiFi.
