# catalogue-v2 import status

Last real run. Brands imported: castrol, gulf, exide, tata-green, kelvinn, cerafence, elvi. One row per product of catalogue-v2 is in
`catalogue-v2-import-status.csv` (3386 rows). A dry run shows what the import WOULD do.

- Products on the list: 3386
- Imported / updated / unchanged: 219 (740 packs, 695 with an MRP)
- Skipped: 3167

| Section | Products | Imported | Updated | Unchanged | Skipped |
| ------- | -------- | -------- | ------- | --------- | ------- |
| lub     | 1067     | 0        | 129     | 25        | 913     |
| bat     | 83       | 0        | 15      | 17        | 51      |
| car     | 61       | 0        | 33      | 0         | 28      |
| tyr     | 894      | 0        | 0       | 0         | 894     |
| flt     | 1281     | 0        | 0       | 0         | 1281    |

### Status

|           | Products |
| --------- | -------- |
| skipped   | 3167     |
| updated   | 177      |
| unchanged | 42       |

### Skip reasons

|                        | Products |
| ---------------------- | -------- |
| not_price_list_brand   | 3089     |
| representative_picture | 78       |

### Brand (imported products)

|            | Products |
| ---------- | -------- |
| Castrol    | 82       |
| Gulf       | 72       |
| KELVINN    | 32       |
| Exide      | 17       |
| Tata Green | 15       |
| CERAFENCE  | 1        |

Skip reasons: `not_price_list_brand` (brand not in the `--brands` list), `representative_picture` (the picture is of a
similar product), `no_picture_bytes` (no picture entry, or the bytes are empty or do not decode), `invalid`
(the source row could not be planned; `detail` says why).

## How to re-run

```
pnpm db:import:catalogue --dir <catalogue-v2/site> --dry-run     # writes this report, changes nothing
pnpm db:import:catalogue --dir <catalogue-v2/site> --staff-user <uuid>
pnpm db:import:catalogue --dir <site> --brands castrol,gulf,motul   # other brands later, no code change
```

See `docs/runbooks/catalogue-import.md`.
