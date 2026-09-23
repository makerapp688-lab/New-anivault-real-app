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
  if (!accountId || accountId === 'guest_user') return;
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
        fetch('/api/user/avatar', {
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
        const avatar = getAccountAvatar(parsed.id);
        return {
          id: parsed.id,
          username: parsed.username || parsed.name || 'AnimeExplorer',
          name: parsed.name || parsed.username || 'AnimeExplorer',
          email: parsed.email,
          avatar: avatar || undefined,
          provider: parsed.provider,
          role: parsed.role || 'user',
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
          const avatar = getAccountAvatar(rec.id);
          return {
            id: rec.id,
            username: rec.username || rec.name || 'AnimeExplorer',
            name: rec.name || rec.username,
            email: rec.email,
            avatar: avatar || undefined,
            provider: rec.provider,
            role: (rec as any).role || 'user',
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
      return {
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
        completed: Array.isArray(parsed.completed) ? parsed.completed : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
        theme: parsed.theme === 'light' || parsed.theme === 'system' ? parsed.theme : 'dark'
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
  const data = getUserData();
  const exists = data.favorites.includes(animeId);
  const updatedFavorites = exists
    ? data.favorites.filter(id => id !== animeId)
    : [...data.favorites, animeId];
  saveUserData({ ...data, favorites: updatedFavorites });
  return !exists;
}

export function toggleWatchlist(animeId: string): boolean {
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
  const data = getUserData();
  saveUserData({ ...data, theme });
  applyThemeClass(theme);
}

let systemThemeMediaQuery: MediaQueryList | null = null;
let systemThemeHandler: ((e: MediaQueryListEvent) => void) | null = null;

export function applyThemeClass(theme: ThemeMode): void {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;

  if (!systemThemeMediaQuery) {
    systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemThemeHandler = () => {
      const currentTheme = getUserData().theme;
      if (currentTheme === 'system') {
        applyThemeClass('system');
      }
    };
    try {
      systemThemeMediaQuery.addEventListener('change', systemThemeHandler);
    } catch {
      systemThemeMediaQuery.addListener(systemThemeHandler);
    }
  }

  let isDark = true;
  if (theme === 'system') {
    isDark = systemThemeMediaQuery.matches;
  } else {
    isDark = theme === 'dark';
  }

  if (isDark) {
    root.classList.add('dark');
    root.classList.remove('light');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    root.style.colorScheme = 'light';
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
 * Sign In with Verified 3P Provider (Google / Apple)
 */
export function authenticateWithProvider(
  provider: 'google' | 'apple',
  email: string,
  providerName: string,
  customUsername?: string
): { success: boolean; account: UserAccount } {
  const cleanEmail = email.trim().toLowerCase();
  const id = `${provider}_${btoa(cleanEmail).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
  const db = getAccountsDb();
  const existing = db[id];

  let chosenName = customUsername?.trim();
  if (!chosenName && existing?.username) {
    chosenName = existing.username;
  }
  if (!chosenName) {
    chosenName = cleanEmail.split('@')[0] || 'AnimeExplorer';
  }

  const accountRecord: StoredAccountRecord = {
    id,
    username: chosenName,
    name: providerName || (provider === 'google' ? 'Google User' : 'Apple User'),
    email: cleanEmail,
    provider,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  };

  db[id] = accountRecord;
  saveAccountsDb(db);

  const userAcc: UserAccount = {
    id: accountRecord.id,
    username: accountRecord.username,
    name: accountRecord.name,
    email: accountRecord.email,
    provider: accountRecord.provider,
    createdAt: accountRecord.createdAt
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

    const accountWithAvatar: UserAccount = {
      ...account,
      avatar
    };

    // 1. Ensure account is stored in ACCOUNTS_DB with its stable internal ID
    const db = getAccountsDb();
    const existingNormalCount = Object.values(db).filter(
      a => a.id && a.id !== 'guest_user' && a.id !== 'usr_owner' && (a as any).role !== 'owner'
    ).length;

    // Allow saving if it's the Owner, or already in DB, or normal accounts < 3
    const isOwner = account.id === 'usr_owner' || account.role === 'owner';
    const alreadyInDb = !!db[account.id];

    if (isOwner || alreadyInDb || existingNormalCount < 3) {
      db[account.id] = {
        id: account.id,
        username: account.username || account.name || 'AnimeExplorer',
        name: account.name || account.username || 'AnimeExplorer',
        email: account.email,
        avatar,
        provider: account.provider,
        role: account.role || 'user',
        createdAt: account.createdAt || new Date().toISOString(),
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
  if (sessionToken) {
    try {
      if (account.role === 'owner') {
        localStorage.setItem('anivault_owner_session_token', sessionToken);
        setClientPersistentCookie('anivault_owner_session', sessionToken, 30);
        saveSessionTokenForAccount('usr_owner', sessionToken);
      } else {
        localStorage.setItem('anivault_user_session_token', sessionToken);
        setClientPersistentCookie('anivault_user_session', sessionToken, 30);
        saveSessionTokenForAccount(account.id, sessionToken);
      }
    } catch {}
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
    const userToken = localStorage.getItem('anivault_user_session_token') || getClientCookie('anivault_user_session');
    const ownerToken = localStorage.getItem('anivault_owner_session_token') || getClientCookie('anivault_owner_session');
    const token = ownerToken || userToken;

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      if (ownerToken) {
        headers['x-anivault-owner-session'] = ownerToken;
      }
      if (userToken) {
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
        const serverAcc: UserAccount = {
          id: data.user.id,
          username: data.user.username,
          name: data.user.name || data.user.username,
          email: data.user.email,
          avatar: getAccountAvatar(data.user.id) || data.user.avatar || undefined,
          provider: data.user.provider || 'email',
          role: data.user.role || 'user',
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

export const loginWithProvider = (
  provider: 'google' | 'apple',
  email: string,
  providerName: string,
  customUsername?: string
) => authenticateWithProvider(provider, email, providerName, customUsername).account;

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
      const res = await fetch('/api/owner/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.owner) {
          const ownerAcc: UserAccount = {
            id: 'usr_owner',
            username: data.owner.username,
            name: data.owner.username,
            email: data.owner.email,
            avatar: getAccountAvatar('usr_owner') || undefined,
            provider: 'email',
            role: 'owner',
            createdAt: data.owner.createdAt || new Date().toISOString()
          };
          setSessionAccount(ownerAcc, data.sessionToken);
          return { success: true, account: ownerAcc };
        }
      }

      // Local fallback if server unreachable
      const db = getAccountsDb();
      if (db['usr_owner']) {
        const localOwner = db['usr_owner'];
        const ownerAcc: UserAccount = {
          id: 'usr_owner',
          username: localOwner.username,
          name: localOwner.username,
          email: localOwner.email,
          avatar: getAccountAvatar('usr_owner') || undefined,
          provider: 'email',
          role: 'owner',
          createdAt: localOwner.createdAt
        };
        setSessionAccount(ownerAcc, undefined);
        return { success: true, account: ownerAcc };
      }
      return { success: false, requireOwnerLogin: true, error: 'Owner account is not created yet.' };
    } catch (err: any) {
      console.warn('Network error during owner switch:', err);
      const db = getAccountsDb();
      if (db['usr_owner']) {
        const localOwner = db['usr_owner'];
        const ownerAcc: UserAccount = {
          id: 'usr_owner',
          username: localOwner.username,
          name: localOwner.username,
          email: localOwner.email,
          avatar: getAccountAvatar('usr_owner') || undefined,
          provider: 'email',
          role: 'owner',
          createdAt: localOwner.createdAt
        };
        setSessionAccount(ownerAcc, undefined);
        return { success: true, account: ownerAcc };
      }
      return { success: false, error: 'Network error. Could not switch to Owner.' };
    }
  }

  // 2. Handle switching to Normal user account
  try {
    const res = await fetch('/api/auth/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
      credentials: 'include'
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.user) {
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

    // Local fallback from accounts DB
    const db = getAccountsDb();
    if (db[accountId]) {
      const rec = db[accountId];
      const localAcc: UserAccount = {
        id: rec.id,
        username: rec.username,
        name: rec.name || rec.username,
        email: rec.email,
        avatar: getAccountAvatar(rec.id) || rec.avatar || undefined,
        provider: rec.provider,
        role: (rec as any).role || 'user',
        createdAt: rec.createdAt
      };
      setSessionAccount(localAcc, undefined);
      return { success: true, account: localAcc };
    }

    return {
      success: false,
      requireLogin: true,
      error: 'Account not found. Please sign in.'
    };
  } catch (err) {
    const db = getAccountsDb();
    if (db[accountId]) {
      const rec = db[accountId];
      const localAcc: UserAccount = {
        id: rec.id,
        username: rec.username,
        name: rec.name || rec.username,
        email: rec.email,
        avatar: getAccountAvatar(rec.id) || rec.avatar || undefined,
        provider: rec.provider,
        role: (rec as any).role || 'user',
        createdAt: rec.createdAt
      };
      setSessionAccount(localAcc, undefined);
      return { success: true, account: localAcc };
    }
    return { success: false, error: 'Network error. Could not switch account.' };
  }
}
