/**
 * Senkronizasyon sağlayıcısı (Faz 09) — React entegrasyonu.
 *
 * - Açılışta SQLite depo açılır (başarısızsa bellek içi depoya düşer — veri
 *   kaybı yerine oturumluk kuyruk; kullanıcıya durum ekranında dürüst gösterilir).
 * - NetInfo bağlantı olayları ve uygulamanın öne gelmesi (AppState) syncNow tetikler.
 * - 401 refresh başarısızsa oturum kapatılır (login ekranına dönüş); outbox
 *   SQLite'ta kaldığı için giriş sonrası kuyruk kaldığı yerden devam eder.
 *
 * Testler SyncProvider yerine doğrudan SyncEngine + MemorySyncStorage kullanır.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { SyncMutationType } from '@santiyepro/contracts';
import { authApi } from '../api';
import { tokenStorage } from '../secure-store';
import { SyncEngine, type SyncEngineOptions } from './engine';
import { MemorySyncStorage } from './memory-storage';
import { SqliteSyncStorage } from './sqlite-storage';
import { createMediaFlusher } from './media-flush';
import { createNetInfoObserver, type ConnectivityObserver } from './connectivity';
import type { OutboxItem, SyncSnapshot, SyncStorage } from './types';

export interface SyncContextValue {
  snapshot: SyncSnapshot;
  syncNow: () => Promise<void>;
  enqueue: (type: SyncMutationType, payload: Record<string, unknown>, clientMutationId: string) => Promise<OutboxItem>;
  /** Çevrimdışı rapor fotoğrafı — localRef ile rapor mutation'ına bağlanır. */
  enqueueMedia: (
    file: { uri: string; mimeType: string; sizeBytes: number },
    localRef: string,
    projectId: string,
  ) => Promise<void>;
  retry: (clientMutationId: string) => Promise<void>;
  retryAll: () => Promise<number>;
  clearDone: () => Promise<number>;
  /** Kuyruk ekranı satırları için depo erişimi (listeleme). */
  listOutbox: () => Promise<OutboxItem[]>;
  storageReady: boolean;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export interface SyncProviderProps {
  children: ReactNode;
  /** Testlerde depoyu değiştirmek için. */
  storageOverride?: SyncStorage;
  /** Testlerde bağlantı gözlemcisini değiştirmek için. */
  connectivityOverride?: ConnectivityObserver;
  /** Refresh başarısızında oturum kapatma davranışını dışarıdan kesmek için (test). */
  onAuthExpired?: () => void;
}

async function openStorage(): Promise<SyncStorage> {
  try {
    return await SqliteSyncStorage.open();
  } catch {
    return new MemorySyncStorage();
  }
}

export function SyncProvider({ children, storageOverride, connectivityOverride, onAuthExpired }: SyncProviderProps) {
  const [storage, setStorage] = useState<SyncStorage | null>(storageOverride ?? null);
  const [snapshot, setSnapshot] = useState<SyncSnapshot>({
    online: true,
    syncing: false,
    pendingCount: 0,
    failedCount: 0,
    conflictCount: 0,
    rejectedCount: 0,
    doneCount: 0,
    lastSyncAt: null,
    lastError: null,
    authExpired: false,
  });
  const engineRef = useRef<SyncEngine | null>(null);
  const authExpiredRef = useRef(onAuthExpired);
  authExpiredRef.current = onAuthExpired;

  // 1) Depo aç (SQLite → fallback bellek).
  useEffect(() => {
    if (storageOverride) {
      setStorage(storageOverride);
      return;
    }
    let cancelled = false;
    void openStorage().then((resolved) => {
      if (!cancelled) setStorage(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [storageOverride]);

  // 2) Motoru kur ve abone ol.
  useEffect(() => {
    if (!storage) return;
    const engineOptions: SyncEngineOptions = {
      storage,
      pushApi: (mutations, token) => import('../api').then(({ syncApi }) => syncApi.push(token, mutations)),
      pullApi: (cursor, token) => import('../api').then(({ syncApi }) => syncApi.pull(token, cursor)),
      getToken: () => tokenStorage.loadAccessToken(),
      refreshSession: async () => {
        try {
          const tokens = await tokenStorage.load();
          if (!tokens?.refreshToken) return false;
          await authApi.refresh(tokens.refreshToken);
          return true;
        } catch {
          // Refresh token da geçersiz: oturum temizlenir; outbox SQLite'ta durur.
          await tokenStorage.clear();
          return false;
        }
      },
      flushMedia: createMediaFlusher(storage),
      onAuthExpired: () => authExpiredRef.current?.(),
    };
    const engine = new SyncEngine(engineOptions);
    engineRef.current = engine;
    const unsubscribe = engine.subscribe(setSnapshot);

    // Bağlantı gözlemi: online'a geçişte senkron.
    const observer = connectivityOverride ?? createNetInfoObserver();
    let wasOnline = true;
    const stopConnectivity = observer.start((online) => {
      engine.setOnline(online);
      if (online && !wasOnline) {
        void engine.syncNow();
      }
      wasOnline = online;
    });

    // Uygulama öne geldiğinde (background → active) senkron.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void engine.syncNow();
      }
    });

    // Açılışta ilk deneme (outbox'ta bekleyen olabilir).
    void engine.syncNow();

    return () => {
      unsubscribe();
      stopConnectivity();
      appStateSub.remove();
      engineRef.current = null;
    };
  }, [storage, connectivityOverride]);

  const value = useMemo<SyncContextValue>(() => {
    const engine = () => {
      if (!engineRef.current) throw new Error('Senkronizasyon motoru henüz hazır değil');
      return engineRef.current;
    };
    return {
      snapshot,
      syncNow: async () => {
        await engine().syncNow();
      },
      enqueue: async (type, payload, clientMutationId) => {
        const item = await engine().enqueue(type, payload, clientMutationId);
        // Kayıt eklendi; bağlantı varsa hemen boşaltmayı dene (arka plan, bekletmez).
        void engine().flush().catch(() => undefined);
        return item;
      },
      enqueueMedia: async (file, localRef, projectId) => {
        await engine().enqueueMedia(file, localRef, projectId);
      },
      retry: async (clientMutationId) => {
        await engine().retry(clientMutationId);
        await engine().syncNow();
      },
      retryAll: async () => {
        const requeued = await engine().retryAll();
        await engine().syncNow();
        return requeued;
      },
      clearDone: async () => engine().clearDone(),
      listOutbox: async () => (storage ? storage.listOutbox() : []),
      storageReady: storage !== null,
    };
  }, [snapshot, storage]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync, SyncProvider içinde kullanılmalıdır');
  return ctx;
}

/**
 * Sağlayıcı dışında null döner — çevrimdışı fallback ekleyen ekranlar,
 * sağlayıcı olmadan render edilen test/özel akışlarda çökmez.
 */
export function useSyncOptional(): SyncContextValue | null {
  return useContext(SyncContext);
}
