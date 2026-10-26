#!/usr/bin/env python3
"""Unit tests for athena/granola.py, with reply shapes seen from Granola's MCP on 2026-10-26.
Every call, name and address here is made up. Run: python3 athena/test_granola.py"""
import datetime, json, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.join(HERE, '..', 'sync'))
import granola  # noqa: E402
import sync  # noqa: E402

LIST = """<requested_range time_range="last_30_days" timezone="America/Denver">Queried meetings.</requested_range>
<meetings_data connected_user_email="owner@example.com" count="2">
<meeting id="aaaa1111-0000-0000-0000-000000000001" title="Plan the launch: next steps" date="Oct 25, 2026 5:06 PM MDT" meeting_at="2026-10-25T17:06:37.949-06:00" created_at="2026-10-25T17:06:37.949-06:00" updated_at="2026-10-25T17:35:55.826-06:00" captured_by_me="true" url="https://notes.granola.ai/d/aaaa1111-0000-0000-0000-000000000001">
    <known_participants>
    Stephanie Holbrook (note creator) from Example Designs LLC (owner@example.com)
    </known_participants>
    <folders />
  </meeting>

<meeting id="bbbb2222-0000-0000-0000-000000000002" title="Weekly sync " date="Oct 16, 2026 11:30 AM MDT" meeting_at="2026-10-16T11:30:00.000-06:00" created_at="2026-10-16T11:30:17.730-06:00" updated_at="2026-10-16T12:07:17.833-06:00" url="https://notes.granola.ai/d/bbbb2222-0000-0000-0000-000000000002">
    <known_participants total="2" omitted="1">
    Stephanie Holbrook (note creator) from Example Designs LLC (owner@example.com)
    </known_participants>
    <folders />
  </meeting>
</meetings_data>

<pagination has_more="false" total_count="2" remaining_count="0" />"""

DETAILS = """<connected_user_email>owner@example.com</connected_user_email>
<meetings_data from="Oct 16, 2026" to="Oct 18, 2026" count="2">
<meeting id="cccc3333-0000-0000-0000-000000000003" title="Talk to Pat" date="Oct 18, 2026 9:00 AM MDT" meeting_at="2026-10-18T09:00:00.000-06:00" created_at="2026-10-18T08:59:08.792-06:00" updated_at="2026-10-18T08:59:14.540-06:00" url="https://notes.granola.ai/d/cccc3333-0000-0000-0000-000000000003">
  <known_participants>
  Stephanie Holbrook (note creator) from Example Designs LLC (owner@example.com), Pat (pat@example.com)
  </known_participants>
    <folders />
  <private_notes status="empty" />
  <summary>
No summary. This note is empty: it has no notes and no AI summary has been generated for it.
</summary>
</meeting>

<meeting id="bbbb2222-0000-0000-0000-000000000002" title="Weekly sync " date="Oct 16, 2026 11:30 AM MDT" meeting_at="2026-10-16T11:30:00.000-06:00" created_at="2026-10-16T11:30:17.730-06:00" updated_at="2026-10-16T12:07:17.833-06:00" url="https://notes.granola.ai/d/bbbb2222-0000-0000-0000-000000000002">
  <known_participants>
  Stephanie Holbrook (note creator) from Example Designs LLC (owner@example.com), Sam Rivers from Rivers &amp; Co (sam@example.com), Lee (lee@example.com)
  </known_participants>
    <folders />
  <private_notes>
[ ] bring the &lt;draft&gt; deck
  </private_notes>
  <summary>
# Topics

- Price at $99 &amp; up

# Next Steps

- **Send the report** (Stephanie)
[ ] follow up Friday
</summary>
</meeting>
</meetings_data>"""

TRANSCRIPT_1 = json.dumps({
    "id": "bbbb2222-0000-0000-0000-000000000002", "truncated": True, "offset": 0, "next_offset": 60,
    "transcript": "Microphone: Hello there.\n\nSystem audio (Pat Example \\u0028Patty\\u0029): Hi.\n\n"})
TRANSCRIPT_2 = json.dumps({
    "id": "bbbb2222-0000-0000-0000-000000000002", "truncated": False, "offset": 60,
    "transcript": "System audio: Bye now.\n\nSpeaker A: See you."})
NO_TRANSCRIPT = json.dumps({"id": "x", "transcript": None,
                            "transcript_unavailable": {"reason": "no_transcript", "message": "None stored."}})

AT = datetime.datetime(2026, 10, 26, 20, 0, tzinfo=datetime.timezone.utc)


class Parsing(unittest.TestCase):
    def test_list_reply(self):
        calls = granola.parse_meetings(LIST)
        self.assertEqual([c['id'][:4] for c in calls], ['aaaa', 'bbbb'])
        self.assertEqual(calls[0]['title'], 'Plan the launch: next steps')
        self.assertEqual(calls[1]['title'], 'Weekly sync')
        self.assertEqual(calls[0]['people'], [])
        self.assertEqual(granola.next_cursor(LIST), '')

    def test_next_page(self):
        self.assertEqual(granola.next_cursor('<pagination has_more="true" next_cursor="abc=" total_count="300" />'), 'abc=')

    def test_empty_note(self):
        empty = granola.parse_meetings(DETAILS)[0]
        self.assertEqual((empty['summary'], empty['notes']), ('', ''))
        self.assertEqual(empty['people'], ['Pat'])

    def test_full_note(self):
        full = granola.parse_meetings(DETAILS)[1]
        self.assertEqual(full['people'], ['Sam Rivers', 'Lee'])  # her own name and every email left out
        self.assertEqual(full['notes'], '- [ ] bring the <draft> deck')
        self.assertIn('Price at $99 & up', full['summary'])
        self.assertIn('\n- [ ] follow up Friday', full['summary'])
        self.assertTrue(full['summary'].startswith('# Topics'))

    def test_transcript_labels(self):
        t = granola.tidy_transcript(json.loads(TRANSCRIPT_1)['transcript'] + json.loads(TRANSCRIPT_2)['transcript'])
        self.assertEqual(t, '**Me:** Hello there.\n\n**Pat Example (Patty):** Hi.\n\n**Them:** Bye now.\n\nSpeaker A: See you.')

    def test_sse_reply(self):
        text = 'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"ok":1}}\n\n'
        self.assertEqual(granola.sse_message(text, 3)['result'], {'ok': 1})
        self.assertIsNone(granola.sse_message(text, 4))


class Pages(unittest.TestCase):
    def setUp(self):
        self.full = granola.parse_meetings(DETAILS)[1]

    def test_page_shape(self):
        row = granola.page_for(self.full, '**Me:** Hi.', set())
        self.assertEqual(row['title'], '2026-10-16 Weekly sync')
        self.assertEqual(row['folder'], 'Meetings')
        self.assertTrue(row['body'].startswith('## Notes\n\n- [ ] bring'))
        self.assertIn('\n\n## Summary\n\n# Topics', row['body'])
        self.assertTrue(row['body'].endswith('## Transcript\n\n**Me:** Hi.\n'))
        self.assertEqual(row['extra']['granola_id'], 'bbbb2222-0000-0000-0000-000000000002')
        self.assertEqual(row['extra']['tags'], ['meeting', 'granola'])

    def test_title_is_a_safe_file_name_and_never_repeats(self):
        call = granola.parse_meetings(LIST)[0]
        call.update(notes='', summary='x')
        row = granola.page_for(call, '', {'2026-10-25 Plan the launch next steps'})
        self.assertEqual(row['title'], '2026-10-25 Plan the launch next steps (2)')
        self.assertEqual(row['extra']['title'], 'Plan the launch: next steps')

    def test_date_is_mountain_time(self):
        call = dict(self.full, meeting_at='2026-10-26T03:30:00Z')  # 9:30 PM Oct 25 in Denver
        self.assertEqual(granola.call_date(call), '2026-10-25')

    def test_vault_sync_keeps_the_page_as_is(self):
        row = granola.page_for(self.full, '**Me:** Hi.', set())
        rel = f'Meetings/{sync.safe_name(row["title"])}.md'
        back = sync.note_to_row('pages', rel, sync.row_to_note('pages', row, ''))
        self.assertEqual(back['title'], row['title'])
        self.assertEqual(back['folder'], 'Meetings')
        self.assertEqual(back['extra'], row['extra'])
        self.assertEqual(back['body'], row['body'].strip('\n'))


class Timing(unittest.TestCase):
    def test_ready(self):
        call = {'summary': '', 'updated_at': '2026-10-26T13:30:00-06:00', 'meeting_at': ''}
        self.assertEqual(granola.ready(call, AT), 'wait')
        call['updated_at'] = '2026-10-24T13:30:00-06:00'
        self.assertEqual(granola.ready(call, AT), 'late')
        call['summary'] = 'notes'
        self.assertEqual(granola.ready(call, AT), 'save')

    def test_prune_seen(self):
        seen = {'old': '2026-09-01', 'new': '2026-10-20', 'bad': None}
        self.assertEqual(granola.prune_seen(seen, AT), {'new': '2026-10-20'})


class FakeMcp:
    def __init__(self, token):
        self.calls = []

    def start(self):
        pass

    def tool(self, name, args):
        self.calls.append(name)
        if name == 'list_meetings':
            return LIST + DETAILS  # one already in the app, one listed twice, one empty
        if name == 'get_meetings':
            return DETAILS
        if name == 'get_meeting_transcript':
            if args['meeting_id'].startswith('bbbb'):
                return TRANSCRIPT_2 if args.get('offset') else TRANSCRIPT_1
            return NO_TRANSCRIPT
        raise AssertionError(name)


class Pull(unittest.TestCase):
    def test_one_run(self):
        posted, saved = [], []

        def api(method, path, body=None):
            if method == 'GET' and path.startswith('pages'):
                return [{'title': '2026-10-25 Plan the launch next steps', 'folder': 'Meetings',
                         'gid': 'aaaa1111-0000-0000-0000-000000000001'},
                        {'title': 'Daily brief', 'folder': 'Athena', 'gid': None}]
            if method == 'POST' and path == 'pages':
                posted.append(body)
                return [body]
            if method == 'PATCH':
                saved.append((path, json.loads(json.dumps(body))))
                return []
            raise AssertionError((method, path))

        real = (granola.api, granola.Mcp, granola.now, granola.access_token)
        granola.api, granola.Mcp, granola.now = api, FakeMcp, lambda: AT
        granola.access_token = lambda data, fresh=False: 'token'
        try:
            data = {'client_id': 'c', 'refresh_token': 'r', 'connected_at': '2026-10-26T19:00:00+00:00',
                    'seen': {'gone': '2026-08-01'}}
            counts = granola.pull(data)
        finally:
            granola.api, granola.Mcp, granola.now, granola.access_token = real

        self.assertEqual(counts, {'saved': 1, 'waiting': 0, 'empty': 1, 'later': 0})
        self.assertEqual([p['title'] for p in posted], ['2026-10-16 Weekly sync'])
        self.assertIn('**Pat Example (Patty):** Hi.', posted[0]['body'])
        self.assertIn('**Them:** Bye now.', posted[0]['body'])
        path, body = saved[-1]
        self.assertIn('data->>connected_at=eq.2026-10-26T19%3A00%3A00%2B00%3A00', path)
        self.assertEqual(set(body['data']['seen']), {'bbbb2222-0000-0000-0000-000000000002',
                                                     'cccc3333-0000-0000-0000-000000000003'})
        self.assertEqual((body['data']['status'], body['data']['saved_total']), ('ok', 1))


class Status(unittest.TestCase):
    def test_lines(self):
        real = granola.now
        granola.now = lambda: AT
        try:
            self.assertIn('not connected', granola.status_line(None))
            self.assertIn('reconnect it in Settings', granola.status_line({'refresh_token': 'r', 'status': 'reconnect'}))
            ok = {'refresh_token': 'r', 'status': 'ok', 'last_run_at': '2026-10-26T19:45:00+00:00'}
            self.assertEqual(granola.status_line(ok), 'Granola: connected, last checked Mon Oct 26, 1:45 PM.')
            ok['last_run_at'] = '2026-10-26T10:00:00+00:00'
            self.assertIn('not checked since', granola.status_line(ok))
        finally:
            granola.now = real


if __name__ == '__main__':
    unittest.main()
