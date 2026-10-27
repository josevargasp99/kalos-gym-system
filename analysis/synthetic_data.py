"""Generates synthetic gym data shaped like the Google Sheet exports (students, renewals, attendance).

Every person and number is invented. The behaviour model is an ASSUMPTION made for illustration:
students who attend more per week are more likely to renew, and sign-ups cluster around the start of the month.
Replace the three DataFrames with real exports once the 3-month measurement window (26 Oct 2026 → 26 Jan 2027) closes.
"""
import numpy as np
import pandas as pd

def generate(n_students=420, months=12, seed=7):
    rng = np.random.default_rng(seed)
    start = pd.Timestamp('2025-10-27')
    students, renewals, visits = [], [], []
    plans = {'Monthly': 30, '3x/week': 30, 'Quarterly': 90}
    price = {'Monthly': 100, '3x/week': 80, 'Quarterly': 270}
    slots = [6, 7, 8, 9, 12, 17, 18, 19, 20, 21]
    slot_w = np.array([5, 7, 4, 2, 3, 9, 12, 14, 10, 4], float); slot_w /= slot_w.sum()
    for i in range(n_students):
        sid = f'S{i:04d}'
        join = start + pd.Timedelta(days=int(rng.beta(1.2, 2.2) * months * 30))
        plan = rng.choice(list(plans), p=[.62, .26, .12])
        habit = float(np.clip(rng.normal(3.1, 1.2), 0.3, 5))      # weekday visits per week
        hour = int(rng.choice(slots, p=slot_w))
        students.append(dict(id=sid, join=join, plan=plan, habit=habit, hour=hour))
        period_start, k = join, 0
        while period_start < pd.Timestamp('2026-10-27'):
            end = period_start + pd.Timedelta(days=plans[plan] - 1)
            renewals.append(dict(id=sid, date=period_start, plan=plan, amount=price[plan], kind='Signup' if k == 0 else 'Renewal'))
            d = period_start
            while d <= min(end, pd.Timestamp('2026-10-27')):
                if d.weekday() < 5 and rng.random() < habit / 5:
                    visits.append(dict(date=d, hour=int(np.clip(rng.normal(hour, 1), 5, 21)), id=sid))
                d += pd.Timedelta(days=1)
            n_period = sum(1 for v in visits[-200:] if v['id'] == sid and period_start <= v['date'] <= end)
            weeks = plans[plan] / 7
            p_renew = 1 / (1 + np.exp(-(1.1 * (n_period / weeks) - 2.3)))      # assumed behaviour model
            if rng.random() > p_renew: break
            period_start, k = end + pd.Timedelta(days=int(rng.integers(0, 6))), k + 1
    return pd.DataFrame(students), pd.DataFrame(renewals), pd.DataFrame(visits)
