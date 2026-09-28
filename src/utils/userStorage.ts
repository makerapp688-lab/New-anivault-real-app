import { UserAccount, UserData, ThemeMode } from '../types.ts';

export interface StoredAccountRecord extends UserAccount {
  lastLoginAt: string;
}

const GUEST_ACCOUNT: UserAccount = {
  id: 'guest_user',
  username: 'AnimeExplorer',
  name: 'Guest Explorer',
  provider: 'guest',
  createdAt: '2025-01-01T00:00:00.000Z'
};

const DEFAULT_USER_DATA: UserData = {
  favorites: [],
  watchlist: [],
  completed: [],
  history: [],
  theme: 'dark'
};

export interface ZenimeThemeDefinition {
  id: ThemeMode;
  name: string;
  category: 'basic' | 'visual';
  tagline: string;
  description: string;
  buttonPreviewStyle: string;
  accentDotClass: string;
  badgeText: string;
}

export const ZENIME_THEMES: ZenimeThemeDefinition[] = [
  // BASIC APPEARANCE MODES (1-3)
  {
    id: 'dark',
    name: 'Black',
    category: 'basic',
    tagline: 'Default obsidian black & crimson',
    description: 'Signature Zenime obsidian black appearance with crimson and metallic silver accents',
    buttonPreviewStyle: 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
    accentDotClass: 'bg-rose-500 shadow-[0_0_8px_#f43f5e]',
    badgeText: 'Default Black'
  },
  {
    id: 'light',
    name: 'White',
    category: 'basic',
    tagline: 'Clean daylight appearance',
    description: 'Bright high-contrast white surface mode with crisp slate typography',
    buttonPreviewStyle: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
    accentDotClass: 'bg-white border border-slate-400 shadow-[0_0_6px_rgba(255,255,255,0.8)]',
    badgeText: 'Clean White'
  },
  {
    id: 'system',
    name: 'System',
    category: 'basic',
    tagline: 'Follows device setting',
    description: 'Automatically adapts between Black and White modes based on your OS preference',
    buttonPreviewStyle: 'linear-gradient(135deg, #475569 0%, #e11d48 100%)',
    accentDotClass: 'bg-slate-300 shadow-[0_0_8px_#cbd5e1]',
    badgeText: 'Auto OS'
  },
  // ADDITIONAL VISUAL THEMES (4-12)
  {
    id: 'zenime-signature',
    name: 'Zenime Signature',
    category: 'visual',
    tagline: 'Official logo cyan, blue, purple & neon pink glow',
    description: 'Signature pitch-black abyssal canvas matching both official Zenime logos with electric cyan, sapphire blue, royal violet, and neon magenta-pink metallic gradients',
    buttonPreviewStyle: 'linear-gradient(135deg, #ff1e9b 0%, #9333ea 34%, #2563eb 68%, #00f0ff 100%)',
    accentDotClass: 'bg-[#00d4ff] shadow-[0_0_10px_#ff1e9b,0_0_14px_#00f0ff]',
    badgeText: 'Official Signature'
  },
  {
    id: 'cyber-neon',
    name: 'Cyber Neon',
    category: 'visual',
    tagline: 'Neon cyan & purple accents',
    description: 'Glowing futuristic buttons with subtle cybernetic luminance',
    buttonPreviewStyle: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
    accentDotClass: 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]',
    badgeText: 'Futuristic Glow'
  },
  {
    id: 'calm-ocean',
    name: 'Calm Ocean',
    category: 'visual',
    tagline: 'Smooth blue & turquoise accents',
    description: 'Clean and peaceful appearance with soft ocean-inspired tones',
    buttonPreviewStyle: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
    accentDotClass: 'bg-teal-400 shadow-[0_0_8px_#2dd4bf]',
    badgeText: 'Serene Aqua'
  },
  {
    id: 'modern-tech',
    name: 'Modern Tech',
    category: 'visual',
    tagline: 'Graphite, white & cobalt blue',
    description: 'Clean premium buttons with sleek modern engineering aesthetics',
    buttonPreviewStyle: 'linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)',
    accentDotClass: 'bg-blue-400 shadow-[0_0_8px_#60a5fa]',
    badgeText: 'Sleek Precision'
  },
  {
    id: 'aurora',
    name: 'Aurora',
    category: 'visual',
    tagline: 'Green, cyan & purple glow',
    description: 'Soft multicolor northern lights glow and atmospheric depth',
    buttonPreviewStyle: 'linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%)',
    accentDotClass: 'bg-emerald-400 shadow-[0_0_8px_#34d399]',
    badgeText: 'Atmospheric'
  },
  {
    id: 'midnight-premium',
    name: 'Midnight Premium',
    category: 'visual',
    tagline: 'Charcoal base & silver/violet',
    description: 'Elegant dark metallic buttons on a deep obsidian foundation',
    buttonPreviewStyle: 'linear-gradient(145deg, #6d28d9 0%, #4c1d95 55%, #334155 100%)',
    accentDotClass: 'bg-violet-400 shadow-[0_0_8px_#a78bfa]',
    badgeText: 'Dark Metallic'
  },
  {
    id: 'pixel',
    name: 'Pixel',
    category: 'visual',
    tagline: 'Retro arcade visual details',
    description: 'Polished pixel-style beveled buttons and crisp arcade borders',
    buttonPreviewStyle: 'linear-gradient(180deg, #ec4899 0%, #db2777 100%)',
    accentDotClass: 'bg-pink-400 shadow-[0_0_8px_#f472b6]',
    badgeText: 'Retro Arcade'
  },
  {
    id: 'space',
    name: 'Space',
    category: 'visual',
    tagline: 'Deep navy, stars & nebula',
    description: 'Cosmic glowing buttons with subtle starfield and nebula gradients',
    buttonPreviewStyle: 'linear-gradient(135deg, #4f46e5 0%, #9333ea 55%, #ec4899 100%)',
    accentDotClass: 'bg-purple-400 shadow-[0_0_8px_#c084fc]',
    badgeText: 'Cosmic Nebula'
  },
  {
    id: 'golden-sunset',
    name: 'Golden Sunset',
    category: 'visual',
    tagline: 'Warm golden & orange highlights',
    description: 'Sunset-inspired gradients with a premium cinematic appearance',
    buttonPreviewStyle: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 55%, #e11d48 100%)',
    accentDotClass: 'bg-amber-400 shadow-[0_0_8px_#fbbf24]',
    badgeText: 'Warm Cinematic'
  }
];

export const BASIC_THEMES = ZENIME_THEMES.filter(t => t.category === 'basic');
export const VISUAL_THEMES = ZENIME_THEMES.filter(t => t.category === 'visual');

export const VALID_THEME_IDS = new Set<ThemeMode>(ZENIME_THEMES.map(t => t.id));

export function normalizeThemeMode(raw?: string | null): ThemeMode {
  if (!raw) return 'dark';
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'black') return 'dark';
  if (cleaned === 'white') return 'light';
  if (
    cleaned === 'zenime' ||
    cleaned === 'zenime_signature' ||
    cleaned === 'zenime signature' ||
    cleaned === 'electric-sapphire' ||
    cleaned === 'zenime-crest'
  ) {
    return 'zenime-signature';
  }
  if (VALID_THEME_IDS.has(cleaned as ThemeMode)) {
    return cleaned as ThemeMode;
  }
  return 'dark';
}

export type RestrictedGuestFeature = 'favorites' | 'watchlist' | 'avatar' | 'compare' | 'theme';

type GuestRestrictionListener = (feature: RestrictedGuestFeature) => void;
const guestRestrictionListeners = new Set<GuestRestrictionListener>();

export function subscribeGuestRestriction(callback: GuestRestrictionListener): () => void {
  guestRestrictionListeners.add(callback);
  return () => {
    guestRestrictionListeners.delete(callback);
  };
}

export function triggerGuestRestriction(feature: RestrictedGuestFeature): void {
  guestRestrictionListeners.forEach(fn => {
    try {
      fn(feature);
    } catch (err) {
      console.error('Error notifying guestRestrictionListener:', err);
    }
  });
}

export function isGuestAccount(account?: UserAccount): boolean {
  const acc = account || getCurrentAccount();
  return !acc || acc.id === 'guest_user' || acc.provider === 'guest';
}

export const STORAGE_KEYS = {
  CURRENT_SESSION: 'anivault_current_session',
  CURRENT_ACCOUNT: 'anivault_current_account',
  ACCOUNTS_DB: 'anivault_accounts_db',
  ACCOUNTS_LIST: 'anivault_accounts_list',
  GUEST_DATA: 'anivault_guest_data',
  USER_DATA_PREFIX: 'anivault_user_data_'
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners() {
  listeners.forEach(fn => {
    try {
      fn();
    } catch (err) {
      console.error('Error notifying userStorage listener:', err);
    }
  });
}

export function subscribeUserStorage(callback: Listener): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Retrieve the accounts registry from persistent storage
 */
export function getAccountsDb(): Record<string, StoredAccountRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACCOUNTS_DB);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Failed to parse accounts db:', err);
  }
  return {};
}

export function saveAccountsDb(db: Record<string, StoredAccountRecord>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ACCOUNTS_DB, JSON.stringify(db));
  } catch (err) {
    console.warn('Failed to save accounts db:', err);
  }
}

/**
 * Retrieve isolated avatar for a specific account identity
 */
export function getAccountAvatar(accountId: string): string | null {
  if (!accountId || accountId === 'guest_user') return null;
  try {
    if (accountId === 'usr_owner') {
      const ownerAvatar = localStorage.getItem('anivault_owner_avatar');
      if (ownerAvatar) return ownerAvatar;
      const direct = localStorage.getItem('anivault_avatar_usr_owner');
      if (direct) return direct;
      return null;
    }
    const stored = localStorage.getItem(`anivault_avatar_${accountId}`);
    if (stored) return stored;

    const db = getAccountsDb();
    if (db[accountId]?.avatar) {
      return db[accountId].avatar!;
    }
  } catch {}
  return null;
}

/**
 * Persist isolated avatar for a specific account identity
 */
export function setAccountAvatar(accountId: string, avatarDataUrl: string | null): void {
  if (!accountId || accountId === 'guest_user' || isGuestAccount()) {
    triggerGuestRestriction('avatar');
    return;
  }
  try {
    const key = `anivault_avatar_${accountId}`;
    if (avatarDataUrl) {
      localStorage.setItem(key, avatarDataUrl);
      if (accountId === 'usr_owner') {
        localStorage.setItem('anivault_owner_avatar', avatarDataUrl);
        localStorage.setItem('anivault_avatar_usr_owner', avatarDataUrl);
      }
    } else {
      localStorage.removeItem(key);
      if (accountId === 'usr_owner') {
        localStorage.removeItem('anivault_owner_avatar');
        localStorage.removeItem('anivault_avatar_usr_owner');
      }
    }

    // Update in CURRENT_ACCOUNT if it matches the active account
    const current = getCurrentAccount();
    if (current.id === accountId) {
      const updated = { ...current, avatar: avatarDataUrl || undefined };
      localStorage.setItem(STORAGE_KEYS.CURRENT_ACCOUNT, JSON.stringify(updated));
    }

    // Update in ACCOUNTS_DB
    const db = getAccountsDb();
    if (db[accountId]) {
      db[accountId].avatar = avatarDataUrl || undefined;
      saveAccountsDb(db);
    }

    // Update in ACCOUNTS_LIST
    const rawList = localStorage.getItem(STORAGE_KEYS.ACCOUNTS_LIST);
    if (rawList) {
      try {
        const list: UserAccount[] = JSON.parse(rawList);
        const updatedList = list.map(a => (a.id === accountId ? { ...a, avatar: avatarDataUrl || undefined } : a));
        localStorage.setItem(STORAGE_KEYS.ACCOUNTS_LIST, JSON.stringify(updatedList));
      } catch {}
    }

    // Sync to backend if user session exists
    if (accountId !== 'usr_owner') {
      const token = localStorage.getItem('anivault_user_session_token');
      if (token) {
        fetch('/api/auth/user/avatar', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ avatar: avatarDataUrl })
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('Failed to save account avatar:', err);
  }
  notifyListeners();
}

export function resolveOwnerUsername(username?: string): string {
  if (!username || username.trim() === '' || username.trim() === 'Owner') {
    return 'Death197';
  }
  return username.trim();
}

/**
 * Gets the current active account. Restores session before render.
 * Guarantees that refreshing or reopening the app keeps the user signed in.
 */
export function getCurrentAccount(): UserAccount {
  try {
    // 1. Check primary current account key
    const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_ACCOUNT);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id && parsed.id !== 'guest_user') {
        const isOwner = parsed.id === 'usr_owner' || parsed.role === 'owner';
        const avatar = getAccountAvatar(isOwner ? 'usr_owner' : parsed.id);
        const resolvedUsername = isOwner
          ? resolveOwnerUsername(parsed.username || parsed.name)
          : (parsed.username || parsed.name || 'AnimeExplorer');
        return {
          id: isOwner ? 'usr_owner' : parsed.id,
          username: resolvedUsername,
          name: isOwner ? resolvedUsername : (parsed.name || parsed.username || 'AnimeExplorer'),
          email: parsed.email,
          avatar: avatar || undefined,
          provider: parsed.provider,
          role: isOwner ? 'owner' : (parsed.role || 'user'),
          createdAt: parsed.createdAt || new Date().toISOString()
        };
      }
    }

    // 2. Check session token / accountId in accounts db
    const sessionRaw = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION);
    if (sessionRaw) {
      const session = JSON.parse(sessionRaw);
      if (session?.accountId && session.accountId !== 'guest_user') {
        const db = getAccountsDb();
        if (db[session.accountId]) {
          const rec = db[session.accountId];
          const isOwner = rec.id === 'usr_owner' || (rec as any).role === 'owner';
          const avatar = getAccountAvatar(isOwner ? 'usr_owner' : rec.id);
          const resolvedUsername = isOwner
            ? resolveOwnerUsername(rec.username || rec.name)
            : (rec.username || rec.name || 'AnimeExplorer');
          return {
            id: isOwner ? 'usr_owner' : rec.id,
            username: resolvedUsername,
            name: isOwner ? resolvedUsername : (rec.name || rec.username),
            email: rec.email,
            avatar: avatar || undefined,
            provider: rec.provider,
            role: isOwner ? 'owner' : ((rec as any).role || 'user'),
            createdAt: rec.createdAt
          };
        }
      }
    }
  } catch (err) {
    console.warn('Failed to get current account:', err);
  }
  return { ...GUEST_ACCOUNT };
}

/**
 * Update the username and persist it permanently with the user's account
 */
export function updateUsername(newUsername: string): UserAccount {
  const current = getCurrentAccount();
  const trimmed = newUsername.trim() || 'AnimeExplorer';
  const updatedAccount: UserAccount = {
    ...current,
    username: trimmed
  };

  try {
    // Update active session and account
    localStorage.setItem(STORAGE_KEYS.CURRENT_ACCOUNT, JSON.stringify(updatedAccount));

    // Update in Accounts DB
    if (current.id !== 'guest_user') {
      const db = getAccountsDb();
      if (db[current.id]) {
        db[current.id].username = trimmed;
        saveAccountsDb(db);
      }
    }

    // Update in saved accounts list
    const rawList = localStorage.getItem(STORAGE_KEYS.ACCOUNTS_LIST);
    if (rawList) {
      const list: UserAccount[] = JSON.parse(rawList);
      const updatedList = list.map(a => (a.id === updatedAccount.id ? updatedAccount : a));
      localStorage.setItem(STORAGE_KEYS.ACCOUNTS_LIST, JSON.stringify(updatedList));
    }
  } catch (err) {
    console.warn('Failed to update username:', err);
  }

  notifyListeners();
  return updatedAccount;
}

/**
 * Retrieves isolated UserData for an account
 */
export function getUserData(accountId?: string): UserData {
  const currentId = accountId || getCurrentAccount().id;
  try {
    const key =
      currentId === 'guest_user'
        ? STORAGE_KEYS.GUEST_DATA
        : `${STORAGE_KEYS.USER_DATA_PREFIX}${currentId}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (currentId === 'guest_user') {
        return {
          favorites: [],
          watchlist: [],
          completed: Array.isArray(parsed.completed) ? parsed.completed : [],
          history: Array.isArray(parsed.history) ? parsed.history : [],
          theme: 'dark'
        };
      }
      return {
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
        completed: Array.isArray(parsed.completed) ? parsed.completed : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
        theme: normalizeThemeMode(parsed.theme)
      };
    }
  } catch (err) {
    console.warn('Failed to load user data:', err);
  }
  return { ...DEFAULT_USER_DATA };
}

/**
 * Saves isolated UserData for an account
 */
export function saveUserData(data: UserData, accountId?: string): void {
  const currentId = accountId || getCurrentAccount().id;
  try {
    const key =
      currentId === 'guest_user'
        ? STORAGE_KEYS.GUEST_DATA
        : `${STORAGE_KEYS.USER_DATA_PREFIX}${currentId}`;
    localStorage.setItem(key, JSON.stringify(data));
    notifyListeners();
  } catch (err) {
    console.warn('Failed to save user data:', err);
  }
}

export function toggleFavorite(animeId: string): boolean {
  if (isGuestAccount()) {
    triggerGuestRestriction('favorites');
    return false;
  }
  const data = getUserData();
  const exists = data.favorites.includes(animeId);
  const updatedFavorites = exists
    ? data.favorites.filter(id => id !== animeId)
    : [...data.favorites, animeId];
  saveUserData({ ...data, favorites: updatedFavorites });
  return !exists;
}

export function toggleWatchlist(animeId: string): boolean {
  if (isGuestAccount()) {
    triggerGuestRestriction('watchlist');
    return false;
  }
  const data = getUserData();
  const exists = data.watchlist.includes(animeId);
  const updatedWatchlist = exists
    ? data.watchlist.filter(id => id !== animeId)
    : [...data.watchlist, animeId];
  saveUserData({ ...data, watchlist: updatedWatchlist });
  return !exists;
}

export function toggleCompleted(animeId: string): boolean {
  const data = getUserData();
  const exists = data.completed.includes(animeId);
  const updatedCompleted = exists
    ? data.completed.filter(id => id !== animeId)
    : [...data.completed, animeId];
  saveUserData({ ...data, completed: updatedCompleted });
  return !exists;
}

export function addToHistory(animeId: string): void {
  const data = getUserData();
  const filtered = data.history.filter(h => h.animeId !== animeId);
  const updatedHistory = [{ animeId, timestamp: Date.now() }, ...filtered].slice(0, 30);
  saveUserData({ ...data, history: updatedHistory });
}

export function clearHistory(): void {
  const data = getUserData();
  saveUserData({ ...data, history: [] });
}

export function setThemeMode(theme: ThemeMode): void {
  if (isGuestAccount()) {
    triggerGuestRestriction('theme');
    return;
  }
  const validTheme = normalizeThemeMode(theme);
  const current = getCurrentAccount();
  const data = getUserData(current.id);
  saveUserData({ ...data, theme: validTheme }, current.id);
  applyThemeClass(validTheme);

  // Sync to backend for signed-in normal user accounts
  if (current.id !== 'guest_user' && current.id !== 'usr_owner') {
    const token = localStorage.getItem('anivault_user_session_token') || getClientCookie('anivault_user_session');
    if (token) {
      fetch('/api/auth/user/theme', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-anivault-user-session': token
        },
        body: JSON.stringify({ theme: validTheme })
      }).catch(() => {});
    }
  }
}

let systemMediaListenerAttached = false;

export function applyThemeClass(theme: ThemeMode): void {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  const validTheme = normalizeThemeMode(theme);

  root.setAttribute('data-theme', validTheme);
  for (const t of ZENIME_THEMES) {
    root.classList.remove(`theme-${t.id}`);
  }
  root.classList.add(`theme-${validTheme}`);

  let isLight = false;
  if (validTheme === 'light') {
    isLight = true;
  } else if (validTheme === 'system') {
    isLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  }

  if (isLight) {
    root.classList.add('light');
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  } else {
    root.classList.add('dark');
    root.classList.remove('light');
    root.style.colorScheme = 'dark';
  }

  if (!systemMediaListenerAttached && typeof window.matchMedia === 'function') {
    systemMediaListenerAttached = true;
    try {
      const mql = window.matchMedia('(prefers-color-scheme: light)');
      const onSystemChange = () => {
        const currentTheme = getUserData().theme;
        if (currentTheme === 'system') {
          applyThemeClass('system');
        }
      };
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onSystemChange);
      }
    } catch {}
  }
}

export function getGuestData(): UserData {
  return getUserData('guest_user');
}

export function hasGuestDataToMigrate(): boolean {
  const guestData = getGuestData();
  return (
    guestData.favorites.length > 0 ||
    guestData.watchlist.length > 0 ||
    guestData.completed.length > 0
  );
}

export function migrateGuestDataToAccount(targetAccountId: string): {
  favoritesCount: number;
  watchlistCount: number;
  completedCount: number;
} {
  const guestData = getGuestData();
  const targetData = getUserData(targetAccountId);

  const mergedFavorites = Array.from(new Set([...targetData.favorites, ...guestData.favorites]));
  const mergedWatchlist = Array.from(new Set([...targetData.watchlist, ...guestData.watchlist]));
  const mergedCompleted = Array.from(new Set([...targetData.completed, ...guestData.completed]));

  const historyMap = new Map<string, number>();
  for (const h of [...targetData.history, ...guestData.history]) {
    if (!historyMap.has(h.animeId) || historyMap.get(h.animeId)! < h.timestamp) {
      historyMap.set(h.animeId, h.timestamp);
    }
  }
  const mergedHistory = Array.from(historyMap.entries())
    .map(([animeId, timestamp]) => ({ animeId, timestamp }))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 30);

  saveUserData(
    {
      ...targetData,
      favorites: mergedFavorites,
      watchlist: mergedWatchlist,
      completed: mergedCompleted,
      history: mergedHistory
    },
    targetAccountId
  );

  // Reset guest data after migration
  saveUserData({ ...DEFAULT_USER_DATA }, 'guest_user');

  return {
    favoritesCount: mergedFavorites.length,
    watchlistCount: mergedWatchlist.length,
    completedCount: mergedCompleted.length
  };
}

/**
 * Register or Sign In with Email & Password
 */
export function authenticateWithEmail(
  email: string,
  password?: string,
  customUsername?: string
): { success: boolean; account?: UserAccount; error?: string } {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, error: 'Please enter a valid email address.' };
  }

  const id = `user_${btoa(cleanEmail).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
  const db = getAccountsDb();
  const existing = db[id];

  if (existing) {
    // Update username if explicitly changed
    if (customUsername?.trim()) {
      existing.username = customUsername.trim();
    }
    existing.lastLoginAt = new Date().toISOString();
    db[id] = existing;
    saveAccountsDb(db);

    const userAcc: UserAccount = {
      id: existing.id,
      username: existing.username,
      name: existing.name,
      email: existing.email,
      provider: existing.provider,
      createdAt: existing.createdAt
    };

    saveSession(userAcc);
    return { success: true, account: userAcc };
  }

  // Create new account
  const defaultUsername = customUsername?.trim() || cleanEmail.split('@')[0] || 'AnimeExplorer';
  const newAccountRecord: StoredAccountRecord = {
    id,
    username: defaultUsername,
    name: cleanEmail.split('@')[0],
    email: cleanEmail,
    provider: 'email',
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  };

  db[id] = newAccountRecord;
  saveAccountsDb(db);

  const userAcc: UserAccount = {
    id: newAccountRecord.id,
    username: newAccountRecord.username,
    name: newAccountRecord.name,
    email: newAccountRecord.email,
    provider: newAccountRecord.provider,
    createdAt: newAccountRecord.createdAt
  };

  saveSession(userAcc);
  return { success: true, account: userAcc };
}

/**
 * Check if switcher capacity allows adding another normal account (max 3)
 */
export function canAddNormalAccount(): boolean {
  return getSavedAccounts().length < 3;
}

/**
 * Save active session securely in localStorage
 */
function saveSession(account: UserAccount) {
  try {
    if (!account || !account.id || account.id === 'guest_user') {
      localStorage.setItem(
        STORAGE_KEYS.CURRENT_SESSION,
        JSON.stringify({
          accountId: 'guest_user',
          timestamp: Date.now()
        })
      );
      localStorage.setItem(STORAGE_KEYS.CURRENT_ACCOUNT, JSON.stringify(GUEST_ACCOUNT));
      notifyListeners();
      return;
    }

    const avatar = getAccountAvatar(account.id) || account.avatar || undefined;
    if (avatar && !getAccountAvatar(account.id)) {
      const key = `anivault_avatar_${account.id}`;
      localStorage.setItem(key, avatar);
    }

    const isOwner = account.id === 'usr_owner' || account.role === 'owner';
    const resolvedUsername = isOwner
      ? resolveOwnerUsername(account.username || account.name)
      : (account.username || account.name || 'AnimeExplorer');

    const accountWithAvatar: UserAccount = {
      ...account,
      id: isOwner ? 'usr_owner' : account.id,
      username: resolvedUsername,
      name: isOwner ? resolvedUsername : (account.name || account.username || 'AnimeExplorer'),
      role: isOwner ? 'owner' : (account.role || 'user'),
      avatar
    };

    // 1. Ensure account is stored in ACCOUNTS_DB with its stable internal ID
    const db = getAccountsDb();
    const existingNormalCount = Object.values(db).filter(
      a => a.id && a.id !== 'guest_user' && a.id !== 'usr_owner' && (a as any).role !== 'owner'
    ).length;

    // Allow saving if it's the Owner, or already in DB, or normal accounts < 3
    const alreadyInDb = !!db[accountWithAvatar.id];

    if (isOwner || alreadyInDb || existingNormalCount < 3) {
      db[accountWithAvatar.id] = {
        id: accountWithAvatar.id,
        username: accountWithAvatar.username,
        name: accountWithAvatar.name || accountWithAvatar.username,
        email: accountWithAvatar.email,
        avatar,
        provider: accountWithAvatar.provider,
        role: accountWithAvatar.role || 'user',
        createdAt: accountWithAvatar.createdAt || new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };
      saveAccountsDb(db);
    }

    localStorage.setItem(
      STORAGE_KEYS.CURRENT_SESSION,
      JSON.stringify({
        accountId: account.id,
        timestamp: Date.now()
      })
    );
    localStorage.setItem(STORAGE_KEYS.CURRENT_ACCOUNT, JSON.stringify(accountWithAvatar));

    // Save in accounts list for account switcher (maximum 3 normal accounts)
    const rawList = localStorage.getItem(STORAGE_KEYS.ACCOUNTS_LIST);
    let list: UserAccount[] = [];
    if (rawList) {
      try {
        list = JSON.parse(rawList);
      } catch {
        list = [];
      }
    }
    const filtered = list.filter(
      a => a.id !== account.id && a.id !== 'guest_user' && a.id !== 'usr_owner' && a.role !== 'owner'
    );
    if (account.id !== 'guest_user' && account.id !== 'usr_owner' && account.role !== 'owner') {
      if (filtered.length < 3) {
        filtered.push(accountWithAvatar);
      }
    }
    localStorage.setItem(STORAGE_KEYS.ACCOUNTS_LIST, JSON.stringify(filtered.slice(0, 3)));
  } catch (err) {
    console.warn('Failed to persist session:', err);
  }
  notifyListeners();
}

export function getSavedAccounts(): UserAccount[] {
  try {
    const db = getAccountsDb();
    const normalAccounts = Object.values(db)
      .filter(r => r.id && r.id !== 'guest_user' && r.id !== 'usr_owner' && (r as any).role !== 'owner')
      .map(r => ({
        id: r.id,
        username: r.username,
        name: r.name,
        email: r.email,
        avatar: getAccountAvatar(r.id) || r.avatar,
        provider: r.provider,
        role: ((r as any).role || 'user') as 'user',
        createdAt: r.createdAt
      }))
      .slice(0, 3); // Maximum 3 accounts total

    if (normalAccounts.length > 0) return normalAccounts;

    const raw = localStorage.getItem(STORAGE_KEYS.ACCOUNTS_LIST);
    if (raw) {
      const list: UserAccount[] = JSON.parse(raw);
      return list
        .filter(a => a.id !== 'guest_user' && a.id !== 'usr_owner' && a.role !== 'owner')
        .map(a => ({
          ...a,
          avatar: getAccountAvatar(a.id) || a.avatar
        }))
        .slice(0, 3);
    }
  } catch {
    // ignore
  }
  return [];
}

export function switchAccount(account: UserAccount): void {
  saveSession(account);
}

// Client-side persistent cookie helpers to solve browser-close resets
export function setClientPersistentCookie(name: string, value: string, days: number): void {
  try {
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    const isSecure = window.location.protocol === 'https:';
    const secureFlags = isSecure ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${secureFlags}; Max-Age=${days * 24 * 60 * 60}; Expires=${expires}`;
    console.log(`[userStorage] Persistent client-side cookie set for ${name}:`, value.slice(0, 10) + '...');
  } catch (err) {
    console.warn('Failed to set persistent client cookie:', err);
  }
}

export function getClientCookie(name: string): string | null {
  try {
    const matches = document.cookie.match(new RegExp(
      "(?:^|; )" + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + "=([^;]*)"
    ));
    return matches ? decodeURIComponent(matches[1]) : null;
  } catch {
    return null;
  }
}

export function deleteClientCookie(name: string): void {
  try {
    document.cookie = `${name}=; Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    const isSecure = window.location.protocol === 'https:';
    const secureFlags = isSecure ? '; Secure' : '';
    document.cookie = `${name}=; Path=/; SameSite=Lax${secureFlags}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  } catch {}
}

/**
 * Explicit logout ending the session and returning to Guest
 */
export function logoutToGuest(): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.CURRENT_SESSION,
      JSON.stringify({
        accountId: 'guest_user',
        timestamp: Date.now()
      })
    );
    localStorage.setItem(STORAGE_KEYS.CURRENT_ACCOUNT, JSON.stringify(GUEST_ACCOUNT));
    deleteClientCookie('anivault_user_session');
    deleteClientCookie('anivault_owner_session');
  } catch (err) {
    console.warn('Failed to log out:', err);
  }
  notifyListeners();
}

export function getSavedSessionTokens(): Record<string, string> {
  try {
    const raw = localStorage.getItem('anivault_accounts_tokens');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveSessionTokenForAccount(accountId: string, token: string): void {
  try {
    const tokens = getSavedSessionTokens();
    tokens[accountId] = token;
    localStorage.setItem('anivault_accounts_tokens', JSON.stringify(tokens));
  } catch {}
}

export function removeSessionTokenForAccount(accountId: string): void {
  try {
    const tokens = getSavedSessionTokens();
    delete tokens[accountId];
    localStorage.setItem('anivault_accounts_tokens', JSON.stringify(tokens));
  } catch {}
}

/**
 * Set active session from server verified account
 */
export function setSessionAccount(account: UserAccount, sessionToken?: string): void {
  const isOwner = account.role === 'owner' || account.id === 'usr_owner';
  if (isOwner) {
    try {
      localStorage.removeItem('anivault_user_session_token');
      deleteClientCookie('anivault_user_session');
    } catch {}

    if (sessionToken) {
      try {
        localStorage.setItem('anivault_owner_session_token', sessionToken);
        setClientPersistentCookie('anivault_owner_session', sessionToken, 30);
        saveSessionTokenForAccount('usr_owner', sessionToken);
      } catch {}
    }
  } else {
    // Normal user account: End active Owner session/context immediately
    try {
      localStorage.removeItem('anivault_owner_session_token');
      deleteClientCookie('anivault_owner_session');
    } catch {}

    if (sessionToken) {
      try {
        localStorage.setItem('anivault_user_session_token', sessionToken);
        setClientPersistentCookie('anivault_user_session', sessionToken, 30);
        saveSessionTokenForAccount(account.id, sessionToken);
      } catch {}
    }
  }
  saveSession(account);
}

/**
 * Remove an account from this device
 */
export function removeSavedAccount(accountId: string): void {
  try {
    const db = getAccountsDb();
    if (db[accountId]) {
      delete db[accountId];
      saveAccountsDb(db);
    }

    const rawList = localStorage.getItem(STORAGE_KEYS.ACCOUNTS_LIST);
    if (rawList) {
      try {
        const list: UserAccount[] = JSON.parse(rawList);
        const filtered = list.filter(a => a.id !== accountId);
        localStorage.setItem(STORAGE_KEYS.ACCOUNTS_LIST, JSON.stringify(filtered));
      } catch {}
    }

    removeSessionTokenForAccount(accountId);
    try {
      localStorage.removeItem(`anivault_avatar_${accountId}`);
    } catch {}

    const current = getCurrentAccount();
    if (current.id === accountId) {
      logoutToGuest();
    }
    notifyListeners();
  } catch (err) {
    console.warn('Failed to remove saved account:', err);
  }
}

let initialSyncCompleted = false;

export function isInitialSyncCompleted(): boolean {
  return initialSyncCompleted;
}

/**
 * Check and synchronize session with backend server
 */
export async function syncWithServerSession(): Promise<UserAccount | null> {
  try {
    const current = getCurrentAccount();
    const isCurrentOwner = current.id === 'usr_owner' || current.role === 'owner';
    const userToken = localStorage.getItem('anivault_user_session_token') || getClientCookie('anivault_user_session');
    const ownerToken = isCurrentOwner ? (localStorage.getItem('anivault_owner_session_token') || getClientCookie('anivault_owner_session')) : null;
    const token = isCurrentOwner ? (ownerToken || userToken) : (userToken || ownerToken);

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      if (isCurrentOwner && ownerToken) {
        headers['x-anivault-owner-session'] = ownerToken;
      } else if (!isCurrentOwner && userToken) {
        headers['x-anivault-user-session'] = userToken;
      }
    }

    const res = await fetch('/api/auth/session', {
      headers,
      credentials: 'include'
    });

    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        if (data.user.avatar && !getAccountAvatar(data.user.id)) {
          setAccountAvatar(data.user.id, data.user.avatar);
        }
        if (data.user.theme && VALID_THEME_IDS.has(data.user.theme)) {
          const existingData = getUserData(data.user.id);
          if (existingData.theme !== data.user.theme) {
            saveUserData({ ...existingData, theme: data.user.theme }, data.user.id);
          }
        }
        const isOwnerUser = data.user.id === 'usr_owner' || data.user.role === 'owner';
        const resolvedUsername = isOwnerUser
          ? resolveOwnerUsername(data.user.username)
          : data.user.username;
        const serverAcc: UserAccount = {
          id: isOwnerUser ? 'usr_owner' : data.user.id,
          username: resolvedUsername,
          name: isOwnerUser ? resolvedUsername : (data.user.name || data.user.username),
          email: data.user.email,
          avatar: getAccountAvatar(isOwnerUser ? 'usr_owner' : data.user.id) || data.user.avatar || undefined,
          provider: data.user.provider || 'email',
          role: isOwnerUser ? 'owner' : (data.user.role || 'user'),
          createdAt: data.user.createdAt
        };
        const activeToken = token || data.sessionToken;
        setSessionAccount(serverAcc, activeToken || undefined);
        return serverAcc;
      } else {
        // If server says not authenticated, clean up stale tokens & revert session
        localStorage.removeItem('anivault_user_session_token');
        localStorage.removeItem('anivault_owner_session_token');
        deleteClientCookie('anivault_user_session');
        deleteClientCookie('anivault_owner_session');
        const localCurrent = getCurrentAccount();
        if (localCurrent.id !== 'guest_user') {
          logoutToGuest();
        }
      }
    }
  } catch (err) {
    console.warn('Failed to sync server session:', err);
  } finally {
    initialSyncCompleted = true;
    notifyListeners();
  }
  return null;
}

/**
 * Terminate server session and local session
 */
export async function logoutFromServer(): Promise<void> {
  try {
    const userToken = localStorage.getItem('anivault_user_session_token') || getClientCookie('anivault_user_session');
    const ownerToken = localStorage.getItem('anivault_owner_session_token') || getClientCookie('anivault_owner_session');
    const token = ownerToken || userToken;

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      if (ownerToken) headers['x-anivault-owner-session'] = ownerToken;
      if (userToken) headers['x-anivault-user-session'] = userToken;
    }

    await fetch('/api/auth/logout', {
      method: 'POST',
      headers,
      credentials: 'include'
    });

    if (ownerToken) {
      await fetch('/api/owner/logout', {
        method: 'POST',
        headers,
        credentials: 'include'
      }).catch(() => {});
    }

    localStorage.removeItem('anivault_user_session_token');
    localStorage.removeItem('anivault_owner_session_token');
    deleteClientCookie('anivault_user_session');
    deleteClientCookie('anivault_owner_session');
  } catch (err) {
    console.warn('Error during server logout:', err);
  }
  logoutToGuest();
}

// Backwards compatibility aliases
export const loginWithEmail = (email: string, customUsername?: string) =>
  authenticateWithEmail(email, undefined, customUsername).account!;

/**
 * Switch the active device session to a different logged-in account
 */
export async function switchActiveAccount(accountId: string): Promise<{
  success: boolean;
  error?: string;
  requireLogin?: boolean;
  requireOwnerLogin?: boolean;
  account?: UserAccount;
}> {
  if (accountId === 'guest_user') {
    logoutToGuest();
    return { success: true };
  }

  // 1. Handle switching to Owner account
  if (accountId === 'usr_owner') {
    try {
      const ownerToken =
        localStorage.getItem('anivault_owner_session_token') ||
        getClientCookie('anivault_owner_session') ||
        getSavedSessionTokens()['usr_owner'];
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (ownerToken) {
        headers['Authorization'] = `Bearer ${ownerToken}`;
        headers['x-anivault-owner-session'] = ownerToken;
      }

      const res = await fetch('/api/owner/switch', {
        method: 'POST',
        headers,
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.owner) {
          const resolvedUsername = resolveOwnerUsername(data.owner.username);
          const ownerAcc: UserAccount = {
            id: 'usr_owner',
            username: resolvedUsername,
            name: resolvedUsername,
            email: data.owner.email,
            avatar: getAccountAvatar('usr_owner') || undefined,
            provider: 'email',
            role: 'owner',
            createdAt: data.owner.createdAt || new Date().toISOString()
          };
          setSessionAccount(ownerAcc, data.sessionToken);
          return { success: true, account: ownerAcc };
        }
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.requireOwnerLogin) {
          return { success: false, requireOwnerLogin: true, error: data.error || 'Owner authentication required.' };
        }
        return { success: false, error: data.error || 'Failed to switch to Owner account.' };
      }
      return { success: false, error: 'Failed to switch to Owner account.' };
    } catch (err: any) {
      console.warn('Network error during owner switch:', err);
      return { success: false, error: 'Network error. Could not switch to Owner.' };
    }
  }

  // 2. Handle switching to Normal user account
  try {
    const ownerToken = localStorage.getItem('anivault_owner_session_token') || getClientCookie('anivault_owner_session');
    const savedUserToken = getSavedSessionTokens()[accountId];
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ownerToken) {
      headers['x-anivault-owner-session'] = ownerToken;
      headers['Authorization'] = `Bearer ${ownerToken}`;
    }
    if (savedUserToken) {
      headers['x-anivault-user-session'] = savedUserToken;
    }

    const res = await fetch('/api/auth/switch', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountId,
        sessionToken: savedUserToken
      }),
      credentials: 'include'
    });

    // End active owner session tokens locally
    localStorage.removeItem('anivault_owner_session_token');
    deleteClientCookie('anivault_owner_session');

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.user) {
        if (data.user.theme && VALID_THEME_IDS.has(data.user.theme)) {
          const existingData = getUserData(data.user.id);
          if (existingData.theme !== data.user.theme) {
            saveUserData({ ...existingData, theme: data.user.theme }, data.user.id);
          }
        }
        const serverAcc: UserAccount = {
          id: data.user.id,
          username: data.user.username,
          name: data.user.name || data.user.username,
          email: data.user.email,
          avatar: getAccountAvatar(data.user.id) || data.user.avatar || undefined,
          provider: data.user.provider || 'email',
          role: 'user',
          createdAt: data.user.createdAt
        };
        setSessionAccount(serverAcc, data.sessionToken);
        return { success: true, account: serverAcc };
      }
    }

    const errData = await res.json().catch(() => ({}));
    if (res.status === 404) {
      removeSavedAccount(accountId);
    }

    return {
      success: false,
      requireLogin: true,
      error: errData.error || 'Account session expired or not found. Please sign in.'
    };
  } catch (err) {
    return { success: false, error: 'Network error. Could not switch account.' };
  }
}
