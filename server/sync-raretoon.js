import fs from 'node:fs';
import path from 'node:path';

// Clean string
function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#038;/g, '&')
    .replace(/➣➣➣/g, '')
    .trim();
}

async function fetchSafe(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    return { ok: true, text, status: 200, finalUrl: res.url };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function crawlRareToon() {
  console.log('=== Starting Full RareToon India Crawl & Ingestion ===');

  const rawEntries = new Map(); // canonicalUrl -> { title, canonicalUrl, imageUrl, description, source }

  // 1. Post Sitemap
  console.log('Fetching post-sitemap.xml...');
  const sitemapRes = await fetchSafe('https://raretoonindia.in/post-sitemap.xml');
  if (sitemapRes.ok) {
    const blocks = sitemapRes.text.split('<url>').slice(1);
    console.log(`Found ${blocks.length} entries in post-sitemap.xml`);
    for (const b of blocks) {
      const locMatch = b.match(/<loc>(.*?)<\/loc>/);
      const imgMatch = b.match(/<image:loc>(.*?)<\/image:loc>/);
      const titleMatch = b.match(/<image:title>(.*?)<\/image:title>/);
      if (locMatch) {
        const url = locMatch[1].trim();
        const img = imgMatch ? imgMatch[1].trim() : null;
        const title = titleMatch ? cleanText(titleMatch[1]) : '';
        rawEntries.set(url, {
          canonicalUrl: url,
          title: title,
          imageUrl: img,
          description: '',
          source: 'sitemap'
        });
      }
    }
  }

  // 2. Crawl Paginated Archives
  const archivePages = [
    'https://raretoonindia.in/',
    'https://raretoonindia.in/latest/',
    'https://raretoonindia.in/animes/',
    'https://raretoonindia.in/doraemon/',
    'https://raretoonindia.in/doraemon/all-movies/',
    'https://raretoonindia.in/doraemon/episodes/',
    'https://raretoonindia.in/pokemon/',
    'https://raretoonindia.in/disney/',
    'https://raretoonindia.in/movies/',
    'https://raretoonindia.in/movies/shin-chan-movies/'
  ];

  // Also iterate /animes/page/2..10 and /latest/page/2..10
  for (let p = 2; p <= 10; p++) {
    archivePages.push(`https://raretoonindia.in/animes/page/${p}/`);
    archivePages.push(`https://raretoonindia.in/latest/page/${p}/`);
  }

  console.log(`Crawling ${archivePages.length} archive/catalogue listing pages...`);

  for (const pageUrl of archivePages) {
    const res = await fetchSafe(pageUrl);
    if (!res.ok) continue;
    
    // Parse anchor cards containing images
    const linkMatches = [...res.text.matchAll(/<a[^>]+href=[\"'](https:\/\/raretoonindia\.in\/[^\/\"']+\/?)[\"'][^>]*>([\s\S]*?)<\/a>/g)];
    for (const m of linkMatches) {
      const url = m[1].trim();
      const inner = m[2];
      
      // Filter out non-content paths
      if (
        url === 'https://raretoonindia.in/' ||
        url.includes('/feed') ||
        url.includes('/wp-') ||
        url.includes('/comments') ||
        url.includes('/dmca') ||
        url.includes('/privacy') ||
        url.includes('/about') ||
        url.includes('/contact') ||
        url.includes('/copyright') ||
        url.includes('/disclaimer') ||
        url.includes('/xmlrpc') ||
        url.includes('/latest') ||
        url.includes('/page/')
      ) {
        continue;
      }

      const imgMatch = inner.match(/data-src=[\"']([^\"']+)[\"']/) || inner.match(/src=[\"']([^\"']+)[\"']/);
      const altMatch = inner.match(/alt=[\"']([^\"']+)[\"']/);

      let img = null;
      if (imgMatch && !imgMatch[1].startsWith('data:')) {
        img = imgMatch[1].trim();
      }

      const title = altMatch ? cleanText(altMatch[1]) : '';

      if (rawEntries.has(url)) {
        const existing = rawEntries.get(url);
        if (!existing.imageUrl && img) existing.imageUrl = img;
        if (!existing.title && title) existing.title = title;
      } else {
        rawEntries.set(url, {
          canonicalUrl: url,
          title: title,
          imageUrl: img,
          description: '',
          source: 'archive_card'
        });
      }
    }
  }

  console.log(`Discovered ${rawEntries.size} total unique RareToon India URLs!`);

  // Now, for all entries missing a title or image, let's fetch their page to extract exact og:title and og:image and og:description
  const entriesArray = Array.from(rawEntries.values());
  let enrichedCount = 0;
  
  console.log('Enriching entries with exact metadata and verifying images...');
  for (let i = 0; i < entriesArray.length; i++) {
    const entry = entriesArray[i];
    // If title is missing or generic or starts with data or image is missing
    const needsFetch = !entry.title || entry.title.length < 3 || !entry.imageUrl || !entry.description;
    
    if (needsFetch) {
      const pageRes = await fetchSafe(entry.canonicalUrl);
      if (pageRes.ok) {
        enrichedCount++;
        const html = pageRes.text;
        
        // Extract title
        const titleMatch = html.match(/<meta property=[\"']og:title[\"'] content=[\"']([^\"']+)[\"']/i)
          || html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch && (!entry.title || entry.title.length < 3)) {
          let t = cleanText(titleMatch[1]);
          t = t.replace(/- Rare Toon India.*/i, '')
               .replace(/- Rare Toons India.*/i, '')
               .replace(/Rare Toon India.*/i, '')
               .trim();
          entry.title = t;
        }

        // Extract image
        const imgMatch = html.match(/<meta property=[\"']og:image[\"'] content=[\"']([^\"']+)[\"']/i)
          || html.match(/data-src=[\"'](https:\/\/raretoonindia\.in\/wp-content\/uploads\/[^\"']+)[\"']/i);
        if (imgMatch && !entry.imageUrl) {
          entry.imageUrl = imgMatch[1].trim();
        }

        // Extract description
        const descMatch = html.match(/<meta property=[\"']og:description[\"'] content=[\"']([^\"']+)[\"']/i)
          || html.match(/<meta name=[\"']description[\"'] content=[\"']([^\"']+)[\"']/i);
        if (descMatch) {
          entry.description = cleanText(descMatch[1]);
        }
      }
    }
  }

  console.log(`Enriched ${enrichedCount} entries directly from their canonical pages.`);

  // Write raw result to disk for inspection
  fs.writeFileSync('server/raretoon-raw.json', JSON.stringify(entriesArray, null, 2));
  console.log(`Saved ${entriesArray.length} items to server/raretoon-raw.json`);
}

crawlRareToon().catch(console.error);
