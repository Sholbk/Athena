"""Reads Stephanie's private Google Calendar iCal links (calendar_feeds) and lists the
events in a date range as plain lines in Mountain time, for Athena's prompts.

Needs `icalendar` and `recurring-ical-events` (installed by the Athena workflow).
Never prints a feed address: those links are private.
"""
import datetime, urllib.request
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Denver')


def _fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Athena calendar reader'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def _clock(dt):
    return dt.strftime('%-I:%M %p').replace(':00 ', ' ')


def _day(d):
    return d.strftime('%a %b %-d')


def events(feeds, start, days):
    """Events from start (a date) for `days` days. Returns (rows, problems)."""
    import icalendar, recurring_ical_events
    lo = datetime.datetime.combine(start, datetime.time(0), TZ)
    hi = lo + datetime.timedelta(days=days)
    rows, problems = [], []
    for f in feeds:
        try:
            cal = icalendar.Calendar.from_ical(_fetch(f['ical_url']))
            for ev in recurring_ical_events.of(cal).between(lo, hi):
                if str(ev.get('STATUS', '')).upper() == 'CANCELLED':
                    continue
                s = ev['DTSTART'].dt
                e = ev['DTEND'].dt if ev.get('DTEND') else s
                title = str(ev.get('SUMMARY', '(no title)')).strip() or '(no title)'
                if isinstance(s, datetime.datetime):
                    s = s.astimezone(TZ) if s.tzinfo else s.replace(tzinfo=TZ)
                    e = e.astimezone(TZ) if getattr(e, 'tzinfo', None) else (e.replace(tzinfo=TZ) if isinstance(e, datetime.datetime) else s)
                    rows.append((s, f'{_day(s)}, {_clock(s)} to {_clock(e)}: {title} ({f["name"]})'))
                else:
                    first = datetime.datetime.combine(s, datetime.time(0), TZ)
                    rows.append((first, f'{_day(s)}, all day: {title} ({f["name"]})'))
        except Exception as ex:  # one bad feed never hides the others
            problems.append(f'The "{f["name"]}" calendar could not be read ({type(ex).__name__}).')
    rows.sort(key=lambda r: r[0])
    return [line for _, line in rows], problems


def block(api, start, days, label):
    """The calendar section of a prompt. Always says plainly when it has nothing."""
    try:
        feeds = api('GET', 'calendar_feeds?enabled=is.true&select=name,ical_url')
    except Exception as ex:
        return f'## Her calendar, {label}\n\nThe calendar could not be read ({type(ex).__name__}).'
    if not feeds:
        return f'## Her calendar, {label}\n\nHer calendar is not linked yet. She can add it in the app under Settings.'
    try:
        lines, problems = events(feeds, start, days)
    except ImportError:
        return f'## Her calendar, {label}\n\nThe calendar could not be read: the calendar reader is not installed.'
    body = '\n'.join(f'- {l}' for l in lines) if lines else 'Nothing on the calendar.'
    if problems:
        body += '\n\n' + '\n'.join(problems)
    return f'## Her calendar, {label} (Mountain time)\n\n{body}'
