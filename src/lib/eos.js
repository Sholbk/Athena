// Values spelled exactly as the vault's CLAUDE.md lists them.
export const ROCK_STATUSES = ['On track', 'Off track', 'Done'];
export const QUARTERS = ['Q3 2026', 'Q4 2026', 'Q1 2027', 'Q2 2027'];
export const ISSUE_STATUSES = ['Open', 'Solved', 'Parked'];
// The measurables Metis asks for at every Level 10. Any other number already on
// the Scorecard shows up too, so nothing recorded is ever hidden.
export const MEASURABLES = [
  'Active paying accounts', 'Beta testers active', 'Producing affiliates', 'Waitlist added', 'Waitlist total',
  'Emails sent', 'Open rate', 'Social posts', 'Critical bugs open', 'Support response time (hrs)', 'Net revenue retention',
];
export const ROCK_TONE = { 'On track': 'ok', 'Off track': 'danger', Done: 'info' };
export const ISSUE_TONE = { Open: 'warn', Solved: 'ok', Parked: '' };

export function currentQuarter(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}
// Level 10s run Fridays, so a Scorecard week ends on Friday.
export function fridayOf(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  const add = (5 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}
