# TuCajero V3 — Reporte de Pruebas de Estrés

**Fecha:** 2026-09-04T20:48:14.677Z
**Total iteraciones:** 46000
**Pasaron:** 36591
**Fallos inesperados:** 0
**Fallos esperados (validación):** 9409
**Tasa de éxito:** 79.55%

---

## Resumen por Módulo

| Módulo | Iteraciones | Pasaron | Fallos | Esperados | Tasa fallo |
|--------|------------|---------|--------|-----------|------------|
| inventory | 9000 | 8291 | 0 | 709 | 0.00% |
| sales | 7500 | 5800 | 0 | 1700 | 0.00% |
| cash | 7500 | 5500 | 0 | 2000 | 0.00% |
| customers | 7500 | 6500 | 0 | 1000 | 0.00% |
| quotes | 3000 | 2000 | 0 | 1000 | 0.00% |
| purchase | 5500 | 4000 | 0 | 1500 | 0.00% |
| reports | 3000 | 3000 | 0 | 0 | 0.00% |
| tenant | 3000 | 1500 | 0 | 1500 | 0.00% |

## Fallos por Criticidad

| Criticidad | Cantidad |
|------------|----------|

## Detalle de Fallos por Error

| Error Code | Ocurrencias | Ejemplo | Escenarios |
|------------|-------------|---------|------------|

## Mensajes de Error Más Frecuentes

| Mensaje | Ocurrencias | Escenarios |
|---------|-------------|------------|

## Estado de cada Escenario

| Escenario | Iteraciones | Pasaron | Fallos | Esperados |
|-----------|------------|---------|--------|-----------|
| crud | 3500 | 3500 | 0 | 0 |
| valid_sale | 3000 | 3000 | 0 | 0 |
| create_valid | 2000 | 2000 | 0 | 0 |
| open_close | 2000 | 2000 | 0 | 0 |
| adjust_valid | 1791 | 1791 | 0 | 0 |
| search_like | 1000 | 1000 | 0 | 0 |
| bulk_import | 1000 | 1000 | 0 | 0 |
| alerts | 1000 | 1000 | 0 | 0 |
| barcode_lookup | 1000 | 1000 | 0 | 0 |
| discount | 1000 | 1000 | 0 | 0 |
| expense_valid | 1000 | 1000 | 0 | 0 |
| summary_valid | 1000 | 1000 | 0 | 0 |
| search | 1000 | 1000 | 0 | 0 |
| pay_debt | 1000 | 1000 | 0 | 0 |
| history | 1000 | 1000 | 0 | 0 |
| convert | 1000 | 1000 | 0 | 0 |
| lifecycle | 1000 | 1000 | 0 | 0 |
| edit_non_draft | 1000 | 0 | 0 | 1000 |
| edit_guard | 1000 | 1000 | 0 | 0 |
| partial_receive | 1000 | 1000 | 0 | 0 |
| dashboard | 1000 | 1000 | 0 | 0 |
| read_queries | 800 | 800 | 0 | 0 |
| duplicate_code | 500 | 0 | 0 | 500 |
| no_rotation | 500 | 500 | 0 | 0 |
| credit_sale | 500 | 500 | 0 | 0 |
| insufficient_stock | 500 | 0 | 0 | 500 |
| empty_cart | 500 | 0 | 0 | 500 |
| payment_mismatch | 500 | 0 | 0 | 500 |
| cancel_sale | 500 | 500 | 0 | 0 |
| session_already_open | 500 | 0 | 0 | 500 |
| expense_zero_neg | 500 | 0 | 0 | 500 |
| summary_cross_account | 500 | 0 | 0 | 500 |
| close_other_user | 500 | 0 | 0 | 500 |
| auto_close | 500 | 500 | 0 | 0 |
| touch_activity | 500 | 500 | 0 | 0 |
| daily_totals | 500 | 500 | 0 | 0 |
| pay_exceeds | 500 | 0 | 0 | 500 |
| not_found | 500 | 0 | 0 | 500 |
| empty | 500 | 0 | 0 | 500 |
| list | 500 | 500 | 0 | 0 |
| convert_insufficient | 500 | 0 | 0 | 500 |
| cross_account | 500 | 500 | 0 | 0 |
| delete_supplier_with_orders | 500 | 0 | 0 | 500 |
| supplier_guard | 500 | 500 | 0 | 0 |
| summary | 500 | 500 | 0 | 0 |
| payroll | 500 | 500 | 0 | 0 |
| audit | 500 | 500 | 0 | 0 |
| cross_account_sale | 500 | 500 | 0 | 0 |
| cross_account_inventory | 500 | 500 | 0 | 0 |
| cross_account_customer | 500 | 500 | 0 | 0 |
| branch_isolation | 500 | 0 | 0 | 500 |
| null_account | 500 | 0 | 0 | 500 |
| cash_cross_account | 500 | 0 | 0 | 500 |
| adjust_negative_overflow | 209 | 0 | 0 | 209 |
| double_cancel | 200 | 0 | 0 | 200 |
| export_noRotation_xlsx | 111 | 111 | 0 | 0 |
| export_inventory_csv | 106 | 106 | 0 | 0 |
| export_inventory_xlsx | 106 | 106 | 0 | 0 |
| export_sales_xlsx | 104 | 104 | 0 | 0 |
| export_cash_csv | 103 | 103 | 0 | 0 |
| export_cash_xlsx | 101 | 101 | 0 | 0 |
| export_audit_csv | 101 | 101 | 0 | 0 |
| export_audit_xlsx | 96 | 96 | 0 | 0 |
| export_noRotation_csv | 93 | 93 | 0 | 0 |
| export_sales_csv | 79 | 79 | 0 | 0 |

---

*Generado automáticamente por massive-stress.test.ts*