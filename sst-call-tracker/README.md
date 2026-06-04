# SST Call Time Tracker

Standalone HTML tool (not part of CMSO Signal). Time how long a Software Systems Technologist spends on each activity during a live support call.

## Open

```powershell
start sst-call-tracker\index.html
```

## How to use

1. Optional: enter a **session label** (ticket ID, symptom).
2. Click **Start session** when the call begins.
3. Whenever the SST switches tasks, click the matching **activity** button.
4. Time accrues to the previous activity until you click the next one.
5. Click **End session** when the call ends.
6. Review **Time by activity** (pie chart, bars, table) and the **Call timeline** card.
7. Use **Copy report**, **Download .txt**, or **Download .csv** below the timeline (includes segment detail in exports).

**Custom activity:** type a label and click **Mark custom**.

## Default activities

- Instructing customer
- Searching for information
- Writing ticket information
- Copy / pasting information
- Switching tabs / apps
- Thinking / pausing
- Asking for help
- Waiting for customer
- Questioning customer for details
- On hold / queue
- Reading KB / manual
- Testing / verifying device
- Wrap-up / closing call

Edit the `ACTIVITIES` array in `tracker.js` to add or rename buttons.

## Notes

- Session can recover from `localStorage` if the tab reloads mid-call.
- **Reset** only works when a session is not running.
- Observer should click buttons in real time (or replay from notes afterward).
