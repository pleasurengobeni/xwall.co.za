/**
 * @jest-environment node
 *
 * tests/layout.test.js
 * Regression checks for home layout structure and critical CSS rules.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../public/index.html');
const CSS_PATH = path.resolve(__dirname, '../public/css/style.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

describe('home layout regressions', () => {
  let html;
  let css;

  beforeAll(() => {
    html = read(INDEX_PATH);
    css = read(CSS_PATH);
  });

  it('uses space mode key on the Space card', () => {
    expect(html).toContain('data-wallpaper="space"');
    expect(html).toContain('<span class="wpc-name">Space</span>');
  });

  it('keeps logo structure as X [logo] W ALL', () => {
    const logoPattern = /<h1 class="home-logo">[\s\S]*?<span class="home-logo-text">X<\/span>[\s\S]*?<img[^>]*class="home-logo-mark"[^>]*>[\s\S]*?<span class="home-logo-text">W<\/span>[\s\S]*?<span class="home-logo-tail">ALL<\/span>[\s\S]*?<\/h1>/;
    expect(html).toMatch(logoPattern);
  });

  it('keeps video rail below categories in DOM order', () => {
    const cardsIdx = html.indexOf('<nav class="wp-cards"');
    const libraryIdx = html.indexOf('<div id="video-library"');
    const musicIdx = html.indexOf('<div class="music-section">');

    expect(cardsIdx).toBeGreaterThan(-1);
    expect(libraryIdx).toBeGreaterThan(cardsIdx);
    expect(musicIdx).toBeGreaterThan(libraryIdx);
  });

  it('keeps video rail visibility/spacing safeguards in CSS', () => {
    expect(css).toMatch(/\.video-library\s*\{[\s\S]*min-height:\s*132px;[\s\S]*z-index:\s*5;[\s\S]*\}/);
    expect(css).toMatch(/\.wp-cards\s*\{[\s\S]*margin-bottom:\s*0\.35rem;[\s\S]*\}/);
  });

  it('keeps top-aligned home content to avoid overlap on short displays', () => {
    expect(css).toMatch(/\.home-content\s*\{[\s\S]*justify-content:\s*flex-start;[\s\S]*\}/);
  });

  it('includes empty-state styling for playlists and suggestion rail', () => {
    expect(css).toContain('.saved-playlists-empty');
    expect(css).toContain('.vlib-empty');
  });
});
