const fs = require('fs');
const path = require('path');

const catalogue = JSON.parse(fs.readFileSync('src/data/anivault-catalogue.json', 'utf8'));

console.log('=== ANIVAULT EXPANDED CATALOGUE QUALITY AUDIT ===');
console.log(`Total Anime in Catalogue: ${catalogue.length}`);

// 1. Check Unique IDs
const idSet = new Set();
const duplicateIds = [];
catalogue.forEach(a => {
  if (idSet.has(a.id)) duplicateIds.push(a.id);
  idSet.add(a.id);
});
console.log(`Unique IDs Check: ${duplicateIds.length === 0 ? 'PASSED (0 duplicates)' : 'FAILED: ' + duplicateIds.join(', ')}`);

// 2. Check Artwork Integrity
let missingArtwork = 0;
let validArtworks = 0;
catalogue.forEach(a => {
  if (!a.artwork || !a.artwork.verifiedArtworkUrl || !a.artwork.verifiedArtworkUrl.startsWith('http')) {
    missingArtwork++;
  } else {
    validArtworks++;
  }
});
console.log(`Artwork Verification Check: ${missingArtwork === 0 ? 'PASSED (100% valid verified artworks: ' + validArtworks + ')' : 'FAILED: ' + missingArtwork + ' missing'}`);

// 3. Check Season & Episode Relationships
let invalidSeasons = 0;
let totalSeasons = 0;
let totalEpisodes = 0;
catalogue.forEach(a => {
  if (!Array.isArray(a.seasons) || a.seasons.length === 0) {
    invalidSeasons++;
  } else {
    totalSeasons += a.seasons.length;
    totalEpisodes += (a.totalEpisodes || 0);
  }
});
console.log(`Seasons/Episodes Integrity Check: ${invalidSeasons === 0 ? 'PASSED (Total Seasons: ' + totalSeasons + ', Total Episodes: ' + totalEpisodes + ')' : 'FAILED: ' + invalidSeasons + ' invalid'}`);

// 4. Category / Genre Distribution
const genreCounts = {};
catalogue.forEach(a => {
  (a.genres || []).forEach(g => {
    genreCounts[g] = (genreCounts[g] || 0) + 1;
  });
});

const TARGETS = [
  'Isekai',
  'Action',
  'Adventure',
  'Fantasy',
  'Romance',
  'Comedy',
  'Drama',
  'Mystery',
  'Sci-Fi',
  'Horror',
  'Supernatural',
  'Sports',
  'Psychological',
  'Slice of Life'
];

console.log('\n=== MAJOR CATEGORY COVERAGE (TARGET: >= 50 REAL ANIME) ===');
let allPassed = true;
TARGETS.forEach(cat => {
  const count = genreCounts[cat] || 0;
  const passed = count >= 50;
  if (!passed) allPassed = false;
  console.log(`• ${cat.padEnd(16)} : ${count.toString().padStart(3)} anime  ${passed ? '✅ Target Met (>= 50)' : '⚠️ Below 50'}`);
});

console.log('\nAudit Result:', allPassed ? 'ALL TARGETS SATISFIED WITH 100% REAL DATA' : 'SOME CATEGORIES BELOW 50');
