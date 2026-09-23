import { useState, useEffect } from 'react';
import { UserAccount, UserData, ThemeMode } from '../types.ts';
import {
  getCurrentAccount,
  getUserData,
  subscribeUserStorage,
  toggleFavorite as toggleFavAction,
  toggleWatchlist as toggleWatchAction,
  toggleCompleted as toggleCompAction,
  setThemeMode,
  addToHistory,
  clearHistory,
  logoutToGuest,
  isInitialSyncCompleted
} from '../utils/userStorage.ts';

export function useUserData() {
  const [account, setAccount] = useState<UserAccount>(getCurrentAccount());
  const [userData, setUserData] = useState<UserData>(getUserData());
  const [synced, setSynced] = useState<boolean>(isInitialSyncCompleted());

  useEffect(() => {
    const update = () => {
      setAccount(getCurrentAccount());
      setUserData(getUserData());
      setSynced(isInitialSyncCompleted());
    };
    update();
    const unsubscribe = subscribeUserStorage(update);
    return () => unsubscribe();
  }, []);

  const isFavorite = (animeId: string) => userData.favorites.includes(animeId);
  const isWatchlist = (animeId: string) => userData.watchlist.includes(animeId);
  const isCompleted = (animeId: string) => userData.completed.includes(animeId);

  const authStatus: 'AUTH_LOADING' | 'AUTHENTICATED' | 'GUEST' = !synced
    ? 'AUTH_LOADING'
    : account.provider !== 'guest'
    ? 'AUTHENTICATED'
    : 'GUEST';

  return {
    account,
    userData,
    isFavorite,
    isWatchlist,
    isCompleted,
    toggleFavorite: toggleFavAction,
    toggleWatchlist: toggleWatchAction,
    toggleCompleted: toggleCompAction,
    addToHistory,
    clearHistory,
    setTheme: setThemeMode,
    logout: logoutToGuest,
    authStatus,
    isGuest: authStatus === 'GUEST'
  };
}
