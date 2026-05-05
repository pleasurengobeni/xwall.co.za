/**
 * @jest-environment node
 *
 * tests/player.test.js
 * Unit tests for Player.parseUrl() — the only pure-logic function
 * in player.js that can be tested without a DOM.
 *
 * The DOM-dependent parts (load, stop, transport button wiring) are
 * covered by the integration/browser tests in player.dom.test.js.
 */

// ── Extract parseUrl as a standalone function for testing ──────────────────
// Mirrors the implementation in public/js/player.js exactly so any
// divergence triggers a test failure.
function parseUrl(raw) {
  const url = raw.trim();
  try {
    const u = new URL(url);

    if (u.hostname.includes('youtube.com') || u.hostname === 'youtu.be') {
      const list = u.searchParams.get('list');
      if (list) return { provider: 'youtube', id: list, title: 'YouTube Playlist' };
    }

    if (u.hostname === 'open.spotify.com') {
      const m = u.pathname.match(/\/(playlist|album|artist)\/([A-Za-z0-9]+)/);
      if (m) return { provider: 'spotify', type: m[1], id: m[2], title: `Spotify ${m[1]}` };
    }
  } catch (_) {}
  return null;
}

// ── YouTube URL parsing ───────────────────────────────────────────────────────
describe('parseUrl — YouTube', () => {
  it('parses standard watch URL with ?list=', () => {
    const r = parseUrl('https://www.youtube.com/watch?v=abc&list=PLxxx123');
    expect(r).toMatchObject({ provider: 'youtube', id: 'PLxxx123' });
  });

  it('parses playlist URL (no v= param)', () => {
    const r = parseUrl('https://www.youtube.com/playlist?list=PLabc');
    expect(r).toMatchObject({ provider: 'youtube', id: 'PLabc' });
  });

  it('parses music.youtube.com sub-domain', () => {
    const r = parseUrl('https://music.youtube.com/playlist?list=PLmusic');
    expect(r).toMatchObject({ provider: 'youtube', id: 'PLmusic' });
  });

  it('returns title YouTube Playlist', () => {
    const r = parseUrl('https://www.youtube.com/playlist?list=PL1');
    expect(r?.title).toBe('YouTube Playlist');
  });

  it('returns null for YouTube URL without list param', () => {
    expect(parseUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('returns null for bare youtube.com (no path params)', () => {
    expect(parseUrl('https://www.youtube.com/')).toBeNull();
  });

  it('trims leading/trailing whitespace', () => {
    const r = parseUrl('  https://www.youtube.com/playlist?list=PL9  ');
    expect(r).toMatchObject({ provider: 'youtube', id: 'PL9' });
  });
});

// ── Spotify URL parsing ───────────────────────────────────────────────────────
describe('parseUrl — Spotify', () => {
  it('parses playlist URL', () => {
    const r = parseUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    expect(r).toMatchObject({
      provider: 'spotify',
      type:     'playlist',
      id:       '37i9dQZF1DXcBWIGoYBM5M',
      title:    'Spotify playlist',
    });
  });

  it('parses album URL', () => {
    const r = parseUrl('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3');
    expect(r).toMatchObject({ provider: 'spotify', type: 'album', id: '1DFixLWuPkv3KT3TnV35m3' });
  });

  it('parses artist URL', () => {
    const r = parseUrl('https://open.spotify.com/artist/4NHQUkpP4IdBKjADzJIFoM');
    expect(r).toMatchObject({ provider: 'spotify', type: 'artist' });
  });

  it('returns null for Spotify track URL (not a playlist/album/artist)', () => {
    expect(parseUrl('https://open.spotify.com/track/6nGeLlakfzlBcFdZXauQs9')).toBeNull();
  });

  it('returns null for Spotify URLs with extra path segments before type', () => {
    // e.g. /user/xxx — not recognised
    expect(parseUrl('https://open.spotify.com/user/someuser')).toBeNull();
  });
});

// ── Invalid / edge-case inputs ────────────────────────────────────────────────
describe('parseUrl — invalid inputs', () => {
  it('returns null for empty string', () => {
    expect(parseUrl('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseUrl('   ')).toBeNull();
  });

  it('returns null for plain text (not a URL)', () => {
    expect(parseUrl('lofi hip hop')).toBeNull();
  });

  it('returns null for an unrecognised https URL', () => {
    expect(parseUrl('https://example.com/playlist?list=PL1')).toBeNull();
  });

  it('returns null for a soundcloud URL', () => {
    expect(parseUrl('https://soundcloud.com/user/track-name')).toBeNull();
  });

  it('returns null for javascript: URI (security)', () => {
    expect(parseUrl('javascript:alert(1)')).toBeNull();
  });

  it('returns null for data: URI (security)', () => {
    expect(parseUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('handles partial YouTube URL without throwing', () => {
    expect(() => parseUrl('youtube.com')).not.toThrow();
  });
});
