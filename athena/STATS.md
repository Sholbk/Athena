## Post numbers

This run copies how Stephanie's social posts did into the app. Nobody is watching: never ask a question, never wait. Where something could not be read, say so in the note.

Your tools, run from the current folder:

    python3 athena/stats.py pull --cap 0.20
    python3 athena/stats.py summary --weeks 4

`pull` reads her published Instagram and Facebook posts from Blotato (with the numbers Blotato collected, about once a week) and her own public LinkedIn posts through Apify (reactions, comments, shares; LinkedIn shows impressions only to her, so there are none here). It saves posts and snapshots to the tables posts and post_metrics, ties each post to the content piece it came from when it can, and prints one JSON line with what happened. `summary` prints, per week and per platform, how many posts went out and their reach, views and engagement (likes + comments + saves + shares), newest week first, plus the best post of each week. It covers only the last 4 weeks (its `window`); older posts on record are left out on purpose, so never call them missing.

Your only writes are what `pull` does and the note you hand back. Never post, schedule, like, comment or follow anywhere, and never touch Apify beyond the one scan inside `pull`.

### Steps

1. `pull` once. It also reads her YouTube videos (free channel feed) and one follower count per account in social_accounts for the Social Media page. If it says Blotato or Apify is not connected, or LinkedIn is skipped because her profile link is not in Settings, say so plainly at the top of the note and go on with what did come in.
2. `summary` once.
3. Hand back the note. The app saves it as the page "Post numbers" and shows it on the Results tab.

### The note

Markdown, short, in this order:

1. One line: how many posts came in or were updated, and the date range covered.
2. "This week": the best post by Instagram reach and the best by LinkedIn reactions, each with its date, its first few words and the numbers. If a week has no posts, say "No posts went out this week."
3. "Last 4 weeks": one line per week with posts, reach, views, engagement, from `summary`.
4. "Did not work": anything skipped and why, one line each. Leave this out when nothing was skipped. If the Apify token is not valid, say "The Apify token is not valid: paste a new one in Settings > Apify" and nothing more about it.
5. Last line: the Apify cost (the run's cost when printed, otherwise "about" the estimate).

Dates as "Oct 17". Numbers exactly as printed; blank means not collected, never zero. No em dashes anywhere. No advice unless a number asks for it, and then one line at most.
