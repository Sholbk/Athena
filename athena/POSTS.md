## Making posts

Stephanie posts herself, by hand or in Blotato. When she asks you to make a post, you make it ready to post: the caption, plus the image made in her Blotato account. She copies the caption and downloads the images in her app, or opens the design in Blotato.

**You never post or schedule anything.** blotato.py can't post or schedule, and there is no other way to do it from here. The app's content drawer has a "Send to Blotato" button that she presses herself; that is hers, not yours.

Your tools for this, besides db.py:

    python3 athena/blotato.py templates [--search WORDS]
    python3 athena/blotato.py make --template ID --title TITLE [--prompt-file FILE] [--inputs-file FILE]
    python3 athena/blotato.py wait ID
    python3 athena/media.py link MEDIA_ID
    python3 athena/media.py fetch MEDIA_ID --out FILE
    python3 athena/media.py add --url URL [--url URL ...] --title TITLE --content CONTENT_ID [--seed N] [--source LINK] [--tags a|b]
    python3 athena/media.py attach MEDIA_ID --content CONTENT_ID

### "Make the post for content piece ID" (from the idea bank)

1. Read the piece with `python3 athena/db.py get content ID`. Its notes name the idea bank seed.
2. Read "ColibriOS Brand Files" before writing anything: the seed, "Brand voice", "My person", "Brand look" (colors with hex codes) and "Offer".
3. Write the caption in her voice:
   - a hook in the first line
   - the point
   - the one CTA as the last line
   - three to five hashtags at the very end
   Save the caption in `body` (a file under /tmp, then `--set-file body=...`), and the CTA in `cta`. Set `channel` to Instagram unless the piece already has one, and give it a short real title in place of "Seed N: ...".
   If the piece has no `target_date`, give it the first weekday (Monday to Friday) after today that no other open piece has: check with `python3 athena/db.py ls content --open --fields target_date`. Her posting days calendar shows each post on that date, and she can move it.
4. Make the image (below). Then set the status to Awaiting approval. If the image could not be made, still save the caption, set the status to Awaiting approval, and add one line to `notes`: "Image not made: <why, in plain words>".

### Making the image

Pick the one template that fits the seed best. Use these ids exactly as written:

| Template | id | Use it for |
|---|---|---|
| Tutorial carousel | `/base/v2/tutorial-carousel/e095104b-e6c5-4a81-a89d-b0df3d7c5baf/v1` | steps, how-tos, "3 ways" |
| Quote card carousel | `/base/v2/quote-card/77f65d2b-48cc-4adb-bfbb-5bc86f8c01bd/v1` | a few sharp lines, myths vs truths |
| Tweet card on her photo | `/base/v2/tweet-card/9714ae5c-7e6b-4878-be4a-4b1ba5d0cd66/v1` | one or two blunt lines over a photo of hers |
| Single quote | `9f4e66cd-b784-4c02-b2ce-e6d0765fd4c0` | one line that stands alone |

Write the words yourself, then pass them as inputs in a JSON file (`--inputs-file`), so Blotato does not rewrite them. What to put in each template:

- **Every template:** `"aspectRatio": "4:5"`.
- **Tutorial carousel:**
  - `title` (5 to 50 characters) and `hashtag` (one word with #).
  - `contentSlides`: 3 to 5 items of `{"heading", "description"}`.
  - `authorName` is "Stephanie Holbrook" and `companyName` is "@colibrios.app".
  - `ctaGreeting` is "Hi, I'm Stephanie", and `ctaDescription` is the one CTA.
  - `ctaButtons` is ["Save", "Share"].
  - Brand hex codes for `introBackgroundColor`, `accentColor`, `contentBackgroundColor` and `ctaBackgroundColor`.
  - Font: `font-playfair` for a serif feel, or `font-dmsans`.
- **Quote card carousel:** `title` (up to 50 characters), `quotes` (3 to 6 lines, each one card), and `font` (`font-playfair`).
- **Tweet card on her photo:**
  - `quotes` (1 to 3 lines, up to 280 characters each).
  - `authorName` is "Stephanie Holbrook" and `handle` is "colibrios.app".
  - `verified`: false.
  - `backgroundMedia`: the link from `media.py link` for one of her photos.
  - `profileImage`: a link the same way, only if a photo tagged headshot exists.
  - `accentColor` from the brand.
- **Single quote:** `quotes` with one line.

Her photos: `python3 athena/db.py ls media --where shelf=photo` lists titles, tags and notes. Use one only when its title or tags fit the post. If you want to be sure what a photo shows, use `media.py fetch` and look at it with Read. A `media.py link` lasts one hour, so make it right before `make`.

Then:

1. `python3 athena/blotato.py make --template ID --title "<piece title>" --inputs-file /tmp/inputs.json`
2. `python3 athena/blotato.py wait <id>`. Run it again while it says "Still working". Most designs finish in a few minutes. Stop after 6 tries and say it is still rendering, with its Blotato page link in `notes`.
3. When it is done: `python3 athena/media.py add --url <each image url> --title "<piece title>" --content <content id> --seed <N> --source <blotato_page>`. A video comes back as `video_url`. Pass that the same way.

Never start a second design for the same piece in one run: each one uses her Blotato balance. If `make` or `wait` says no (a missing key, an out-of-balance message, a failed design), stop making images and use the "Image not made" line.

### "Write a caption for the Media file ID, for content piece ID"

Something she made herself, often in WonderReel.

1. Read the file's title, tags and notes with `python3 athena/db.py get media MEDIA_ID`. If it is a picture, `media.py fetch` it and look at it. A video you can't watch, so write from its title, tags and notes.
2. Read the brand files, and write the caption the same way as above.
3. Save it to the content piece (body, cta, channel, a short title), and set the status to Awaiting approval.
4. Make no image. The file is already tied to the piece.

### Your reply

Two lines at most: what the post says, which template you used (or why there is no image).
