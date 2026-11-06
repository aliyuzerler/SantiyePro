/**
 * Bağlantı gözlemcisi (Faz 09 — docs/09 connectivity).
 *
 * Gerçek cihazda @react-native-community/netinfo kullanır; modül dinamik
 * import edilir (jest/node ortamı yüklemez, testler manuel gözlemci verir).
 * `isInternetReachable === false` çevrimdışı sayılır; null (henüz bilinmiyor)
 * bağlantı var sayılır — yanlış çevrimdışı alarmı, veri kaybından iyidir.
 */

export type ConnectivityListener = (online: boolean) => void;
export type ConnectivityUnsubscribe = () => void;

export interface ConnectivityObserver {
  /** Dinlemeye başlar; unsubscribe döner. İlk durum anında bildirilir. */
  start(listener: ConnectivityListener): ConnectivityUnsubscribe;
}

export function createNetInfoObserver(): ConnectivityObserver {
  return {
    start(listener: ConnectivityListener): ConnectivityUnsubscribe {
      let stopped = false;
      let stopNative: (() => void) | null = null;

      void (async () => {
        try {
          const NetInfo = (await import('@react-native-community/netinfo')).default;
          if (stopped) return;
          const state = await NetInfo.fetch();
          if (stopped) return;
          listener(!!state.isConnected && state.isInternetReachable !== false);
          const unsubscribe = NetInfo.addEventListener((next) => {
            listener(!!next.isConnected && next.isInternetReachable !== false);
          });
          stopNative = unsubscribe;
        } catch {
          // NetInfo yoksa (test/web edge) iyimser davran: flush güvenlidir,
          // hata durumunda engine zaten backoff'a geçer.
          listener(true);
        }
      })();

      return () => {
        stopped = true;
        stopNative?.();
      };
    },
  };
}
