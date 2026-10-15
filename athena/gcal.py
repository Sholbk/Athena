#!/usr/bin/env python3
"""Athena's pen for Stephanie's Google Calendar: adds an event when she asks for one.

  python3 athena/gcal.py check
  python3 athena/gcal.py add --title TITLE --date YYYY-MM-DD [--start "9:00 AM" --end "10:00 AM"] [--notes-file FILE]

check  says whether her Google Calendar is connected (Settings, Google Calendar).
add    puts one event on her main Google Calendar, in Mountain time. With no --start it is an
       all-day event. It prints the event's day, time and link.

Adds only. There is no way here to change or delete an event.
Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Standard library only.
"""
import argparse, datetime, json, re, sys, urllib.error, urllib.parse, urllib.request

from db import api

TZ = 'America/Denver'
EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
TOKEN = 'https://oauth2.googleapis.com/token'


def creds():
    rows = api('GET', 'connections?key=eq.google&select=data')
    data = (rows or [{}])[0].get('data') or {}
    if not data.get('refresh_token'):
        sys.exit('Her Google Calendar is not connected. She connects it in Settings, under Google Calendar.')
    return data


def post(url, body, headers=None, form=False):
    data = urllib.parse.urlencode(body).encode() if form else json.dumps(body).encode()
    h = {'Content-Type': 'application/x-www-form-urlencoded' if form else 'application/json', **(headers or {})}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method='POST', headers=h), timeout=30) as r:
            return json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        if 'invalid_grant' in detail:
            sys.exit('Google says the connection expired. She reconnects it in Settings, under Google Calendar.')
        sys.exit(f'Google said no: {e.code} {detail}')


def access_token(c):
    t = post(TOKEN, {
        'client_id': c['client_id'], 'client_secret': c['client_secret'],
        'refresh_token': c['refresh_token'], 'grant_type': 'refresh_token',
    }, form=True)
    return t['access_token']


def clock(text):
    m = re.fullmatch(r'\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?\s*', text or '')
    if not m:
        sys.exit(f'Write times like 9:00 AM or 2:30 PM, not "{text}".')
    h, mins = int(m.group(1)) % 12, int(m.group(2) or 0)
    if m.group(3).lower() == 'p':
        h += 12
    return f'{h:02d}:{mins:02d}:00'


def nice(day, start=None, end=None):
    d = datetime.date.fromisoformat(day).strftime('%A, %B %-d')
    return f'{d}, all day' if not start else f'{d}, {start} to {end}'


def main():
    p = argparse.ArgumentParser(description='Add an event to her Google Calendar. Adds only.')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('check')
    a_ = sub.add_parser('add')
    a_.add_argument('--title', required=True)
    a_.add_argument('--date', required=True)
    a_.add_argument('--start'); a_.add_argument('--end')
    a_.add_argument('--notes-file')
    a = p.parse_args()

    c = creds()
    if a.cmd == 'check':
        access_token(c)
        print(json.dumps({'connected': True, 'account': c.get('email')}))
        return
    try:
        datetime.date.fromisoformat(a.date)
    except ValueError:
        sys.exit('--date is YYYY-MM-DD.')
    if bool(a.start) != bool(a.end):
        sys.exit('Give both --start and --end, or neither for an all-day event.')
    event = {'summary': a.title.strip()}
    if a.notes_file:
        with open(a.notes_file, encoding='utf-8') as f:
            event['description'] = f.read().strip()
    if a.start:
        s, e = clock(a.start), clock(a.end)
        if e <= s:
            sys.exit('The end time has to be after the start time.')
        event['start'] = {'dateTime': f'{a.date}T{s}', 'timeZone': TZ}
        event['end'] = {'dateTime': f'{a.date}T{e}', 'timeZone': TZ}
    else:
        nxt = (datetime.date.fromisoformat(a.date) + datetime.timedelta(days=1)).isoformat()
        event['start'] = {'date': a.date}
        event['end'] = {'date': nxt}
    made = post(EVENTS, event, {'Authorization': f'Bearer {access_token(c)}'})
    print(json.dumps({'added': made.get('summary'), 'when': nice(a.date, a.start, a.end), 'link': made.get('htmlLink')}))


if __name__ == '__main__':
    main()
