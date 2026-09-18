# Self-hosted ambient videos ("xwall originals")

Files in this folder are served by nginx at `https://xwall.co.za/media/…` and
listed automatically in the app — each mode's picker shows them first, and they
become the default background for that mode. They are not stored in git.

```
media/
  fireplace/  cozy-hearth.mp4   cozy-hearth.jpg   ← optional poster
  rain/
  river/
  space/
```

## Add a video

```bash
scripts/prepare-ambient.sh ~/Movies/IMG_1234.MOV fireplace "Cozy Hearth"
scripts/upload-media.sh
```

The first command converts your recording to a web-friendly 1080p MP4 and makes
a poster image; the second uploads it. No deploy is needed.

## Recording tips

- **Landscape**, steady (tripod or propped up), 5–20 minutes. Clips loop.
- Pick a moment that loops well — the end cuts straight back to the start.
- Sound is optional; crackling fire or rain adds a lot. Keep it free of voices,
  music and anything you don't have the rights to.
- Only use footage you own (shot yourself, or bought with a full buyout).
  Free stock sites usually forbid using clips as the product itself.

## Bandwidth

Each viewer streams about 2 GB per hour at 1080p. nginx caps each connection
after a 16 MB head start so one viewer can't saturate the server. If xwall
grows, move `/media/` behind a video CDN.
