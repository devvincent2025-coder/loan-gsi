# Backup & recovery strategy

| Asset | Method | Frequency | Retention |
|---|---|---|---|
| MySQL (system of record) | Managed snapshot **or** `mysqldump --single-transaction --routines --triggers` | Daily full | 35 days |
| MySQL point-in-time | Binary log shipping (`binlog_expire_logs_seconds` ≥ 7 d), restore = last full + replay to target time | Continuous | 7 days |
| Redis | **Non-authoritative** (queues, schedulers). AOF on; losing it loses in-flight jobs only. Repeatable schedulers are re-registered on boot | n/a | n/a |
| Encryption keys (`ENCRYPTION_KEYS`) | Secret manager with versioning; **backups are useless without keys**. Keep every historical key id until `rotate-keys` has migrated all rows | On change | Indefinite |
| Audit log | Included in MySQL backups. Verify with `GET /api/v1/audit/verify` after every restore; ship daily hash-head (`AuditChainHead`) to WORM storage for external tamper evidence | Daily | 7 years (CBN record retention) |

## Restore drill (quarterly)
1. Restore latest full into an isolated instance, replay binlogs to target time.
2. Run `prisma migrate status`, boot the API against it, call `/health/ready`.
3. Run `/audit/verify`: must return `valid: true`.
4. Record RTO/RPO. Targets: **RPO ≤ 5 min, RTO ≤ 2 h**.

## Production notes
- Migrations run with a privileged user; the app user gets `INSERT, SELECT` only on `AuditLog` (the immutability triggers are defence in depth).
- Encrypt backups at rest; store off-region (data-residency: keep within Nigeria / approved jurisdictions per NDPA).
