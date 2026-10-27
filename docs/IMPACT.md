# Impact measurement plan

**Launch:** 26 October 2026 · **Measurement window:** 3 months, closing **26 January 2027**.

## Baseline honesty
Before launch there was no structured record: renewals and attendance lived on paper and in chats. Digital history therefore starts at launch, so "before vs. after" comparisons use the operator's earlier records where they exist and are labelled as estimates. Anything measured by the system itself is labelled as measured.

## KPIs
| KPI | Definition | Where it comes from |
|---|---|---|
| Active members | Members with a valid paid period on the last day of each month | `Alumnos`, `Renovaciones` |
| App adoption | Share of active members with ≥ 1 check-in in the month | `Asistencia` |
| Renewal rate | Periods that ended in the month and were followed by a new one within 10 days | owner panel ("Tasa de renovación") |
| Reminders enabled | Members with at least one push device | `Avisos` |
| Admin time saved | Hours/day previously spent on expiry follow-ups, reminders and attendance, minus time now spent | weekly time log by the operator |

## Operator expectations (hypotheses, not results)
More active members, near-universal app adoption, a higher renewal rate, and at least one hour of administrative work saved per day.

## Reporting
Results will be added to the README with the method, the data window and any caveats. The notebook in [`analysis/`](../analysis/retention_analysis.ipynb) is re-run on real exports at that point.
