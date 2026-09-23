import fs from 'node:fs';

async function main() {
  console.log('--- Starting RareToon Ingestion Analysis ---');

  // Check how many pages /animes/ has
  let lastValidPage = 0;
  for (let p = 1; p <= 15; p++) {
    const url = p === 1 ? 'https://raretoonindia.in/animes/' : `https://raretoonindia.in/animes/page/${p}/`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.status === 200) {
        lastValidPage = p;
        const html = await res.text();
        const matches = [...html.matchAll(/<h2 class="entry-title"><a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
        console.log(`Page ${p}: status 200, items found: ${matches.length}`);
      } else {
        console.log(`Page ${p}: status ${res.status}`);
        break;
      }
    } catch (e) {
      console.log(`Page ${p} err: ${e.message}`);
      break;
    }
  }

  // Also check sitemaps: category-sitemap.xml, post-sitemap.xml, etc.
  const sitemapUrls = [
    'https://raretoonindia.in/sitemap_index.xml',
    'https://raretoonindia.in/post-sitemap.xml',
    'https://raretoonindia.in/category-sitemap.xml',
    'https://raretoonindia.in/animes-sitemap.xml',
    'https://raretoonindia.in/post_tag-sitemap.xml'
  ];

  for (const s of sitemapUrls) {
    try {
      const res = await fetch(s, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`Sitemap ${s}: status ${res.status}`);
      if (res.ok) {
        const text = await res.text();
        const locs = [...text.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
        console.log(`  -> Found ${locs.length} entries`);
      }
    } catch (e) {
      console.log(`Sitemap err: ${e.message}`);
    }
  }
}

main();
