# Security notes

Threat model: a **public endpoint** (anyone can reach the web app), members' **phone numbers and plan data**, and a card code that acts as the member's credential.

## Controls in this edition
| Area | Control |
|---|---|
| Secrets | Push private key only in *Script properties*; never in code. `.gitignore` blocks keys and data exports. |
| Admin functions | Every global (client-callable) maintenance function checks the caller is the script owner. Bulk notification jobs only run from a real time trigger or the owner. |
| Presence | Check-in and phone→card lookup need a **door code** that rotates every 60 s (HMAC-SHA-256 of the time window, 3-window tolerance). A daily receipt lets the member open their calendar afterwards. |
| Abuse | Global limits plus **per-phone** limits; unknown card codes have their own quota so guessing cannot lock out real members; push registration capped per member and per minute. |
| Instructor access | Long random key, constant-time comparison, failed-attempt throttle, sent in the URL *fragment* (never in server logs). |
| Injection | User text is stripped of control characters and leading `= + - @`; front-ends use `textContent`; the fallback page uses escaped templates. |
| Privacy | The public API never returns phone numbers, notes or amounts. QR codes are generated locally instead of calling external QR services. |
| Push | Only HTTPS endpoints on the official push hosts are accepted; payload-less pushes mean the service never sends member data through push vendors. |

## Known limitations
- The **card code is a bearer credential**: whoever has it can read that member's plan and attendance and write to their notes. Codes are random (about 10⁹ combinations) and rate-limited, but a photographed card works.
- Google Apps Script offers no client IP, so rate limits are per identifier, not per source.
- A door code is a *proof of recent presence*, not identity: someone standing in the gym could still type another member's number. A per-member PIN would be the next step.
- Spreadsheet owners (and anyone with edit access) see all data; sharing the sheet is the real access boundary.

## Reporting
Please open a private security advisory on this repository.
