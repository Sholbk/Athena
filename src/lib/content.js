export const CONTENT_STATUSES = ['Idea', 'Drafted', 'Awaiting approval', 'Scheduled', 'Shipped', 'Skipped'];
export const CHANNELS = ['Instagram', 'Facebook', 'LinkedIn', 'Email', 'Newsletter', 'Blog', 'YouTube', 'TikTok', 'Skool', 'Other'];
export const DEFAULT_CTA = 'Start a 30 day free trial.';
export const CONTENT_COLS = 'id,title,status,channel,product,target_date,cta,notes,body,posted_at,post_url,created_at,updated_at,vault_path';
export const STATUS_TONE = { Idea: '', Drafted: 'info', 'Awaiting approval': 'warn', Scheduled: 'ok', Shipped: 'ok', Skipped: '' };

// House rules every piece is checked against before it goes out.
export function copyChecks(row) {
  const out = [];
  const text = `${row.title || ''}\n${row.body || ''}\n${row.cta || ''}`;
  if (/[—–]/.test(text)) out.push('Has a dash (— or –). Swap it for a comma, period or parentheses.');
  if (!row.cta || !row.cta.trim()) out.push('No CTA yet. Every piece gets exactly one.');
  const links = (row.body || '').match(/https?:\/\/\S+/g) || [];
  if (new Set(links).size > 1) out.push(`The copy has ${new Set(links).size} different links. One CTA per piece, two asks is zero asks.`);
  if (/\b\d+%|\$\d/.test(row.body || '')) out.push('The copy has a number or price. Make sure it is real and on record.');
  return out;
}
