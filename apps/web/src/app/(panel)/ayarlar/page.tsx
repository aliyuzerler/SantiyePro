'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/lib/auth';
import { ApiError, orgApi } from '@/lib/api';
import { permissionsForRoles, type BackupStatus, type CustomAttendanceStatus } from '@santiyepro/contracts';

/**
 * Ayarlar (Faz 10).
 *
 * - Özel devam durumları (Faz 06 org ayarı): firm.settings.manage izniyle düzenlenir.
 * - Yedekleme durumu (docs/10): backup script'inin status.json dosyası salt
 *   okunur gösterilir — panelde restore düğmesi BİNLİÇLİ yoktur; restore
 *   yalnızca kontrollü operasyon script'iyle (infra/scripts/restore.sh) yapılır.
 */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}

function formatTr(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'medium' });
}

export default function SettingsPage() {
  const { user, getToken } = useAuth();
  const token = getToken() ?? '';
  const canManage = permissionsForRoles(user?.roles ?? []).has('firm.settings.manage');

  // Özel devam durumları
  const [statuses, setStatuses] = useState<CustomAttendanceStatus[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [settingsError, setSettingsError] = useState<string>();
  const [settingsNotice, setSettingsNotice] = useState<string>();
  const [saving, setSaving] = useState(false);

  // Yedekleme durumu
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupError, setBackupError] = useState<string>();

  const loadSettings = useCallback(async () => {
    if (!token) return;
    try {
      const res = await orgApi.settings(token);
      setStatuses(res.attendanceCustomStatuses);
    } catch (e) {
      setSettingsError(e instanceof ApiError ? e.message : 'Kurum ayarları yüklenemedi');
    }
  }, [token]);

  const loadBackup = useCallback(async () => {
    if (!token || !canManage) return;
    try {
      setBackup(await orgApi.backupStatus(token));
      setBackupError(undefined);
    } catch (e) {
      setBackupError(e instanceof ApiError ? e.message : 'Yedekleme durumu yüklenemedi');
    }
  }, [token, canManage]);

  useEffect(() => {
    void loadSettings();
    void loadBackup();
  }, [loadSettings, loadBackup]);

  const addStatus = (event: FormEvent) => {
    event.preventDefault();
    setSettingsError(undefined);
    const key = newKey.trim().toUpperCase();
    if (!key || !newLabel.trim()) {
      setSettingsError('Anahtar ve etiket zorunludur');
      return;
    }
    if (!/^[A-Z0-9_]{2,20}$/.test(key)) {
      setSettingsError('Anahtar 2–20 karakter, yalnızca A-Z, 0-9 ve alt çizgi olmalıdır');
      return;
    }
    if (statuses.some((s) => s.key === key)) {
      setSettingsError('Bu anahtar zaten var');
      return;
    }
    setStatuses([...statuses, { key, label: newLabel.trim() }]);
    setNewKey('');
    setNewLabel('');
  };

  const saveSettings = async () => {
    setSaving(true);
    setSettingsError(undefined);
    setSettingsNotice(undefined);
    try {
      await orgApi.updateSettings(token, { attendanceCustomStatuses: statuses });
      setSettingsNotice('Kurum ayarları kaydedildi (değişiklik denetim günlüğüne yazıldı)');
    } catch (e) {
      setSettingsError(e instanceof ApiError ? e.message : 'Kaydedilemedi');
      await loadSettings(); // sunucudaki son doğrulanan hale dön
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="Ayarlar">
      <PageHeader
        title="Ayarlar"
        description="Kurum düzeyi ayarlar ve sistem durum görünümleri."
      />

      {!canManage && (
        <ErrorState title="Erişim yok" message="Ayarları görüntüleme/değiştirme izniniz yok (firm.settings.manage)." />
      )}

      {canManage && (
        <div className="flex flex-col gap-4">
          {/* Yedekleme durumu — docs/10 */}
          <SectionCard
            title="Yedekleme"
            description="Durum, yedekleme script'inin (infra/scripts/backup.sh) yazdığı status.json dosyasından salt okunur okunur. Restore, panel değil yalnızca kontrollü operasyon script'iyle yapılır (docs/10)."
            action={<Button variant="tertiary" onClick={() => void loadBackup()}>Yenile</Button>}
          >
            {backupError && <ErrorState title="Yedekleme durumu okunamadı" message={backupError} />}
            {!backupError && !backup && <LoadingSkeleton rows={2} />}
            {!backupError && backup && (
              backup.statusFileFound ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-card border border-border-default p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">Son Çalışma</p>
                    <p className="mt-1 text-sm font-bold text-brand-900">{formatTr(backup.lastRunAt)}</p>
                  </div>
                  <div className="rounded-card border border-border-default p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">Son Başarılı Yedek</p>
                    <p className="mt-1 text-sm font-bold text-brand-900">{formatTr(backup.lastSuccessAt)}</p>
                    {backup.lastError ? (
                      <p className="mt-1"><StatusBadge tone="error">Hata</StatusBadge></p>
                    ) : (
                      <p className="mt-1"><StatusBadge tone="approved">Sağlıklı</StatusBadge></p>
                    )}
                  </div>
                  <div className="rounded-card border border-border-default p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">DB Yedeği</p>
                    <p className="mt-1 text-sm font-bold text-brand-900">{formatBytes(backup.lastDbBackupSizeBytes)}</p>
                    <p className="text-[11px] text-text-secondary">{backup.lastDbBackupFile ?? '—'}</p>
                  </div>
                  <div className="rounded-card border border-border-default p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">Depolama Yedeği</p>
                    <p className="mt-1 text-sm font-bold text-brand-900">{formatBytes(backup.lastStorageBackupSizeBytes)}</p>
                    <p className="text-[11px] text-text-secondary">{backup.lastStorageBackupFile ?? '—'}</p>
                  </div>
                  <div className="rounded-card border border-border-default p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">Retention</p>
                    <p className="mt-1 text-sm font-bold text-brand-900">{backup.retentionDays === null ? '—' : `${backup.retentionDays} gün`}</p>
                  </div>
                  {backup.lastError && (
                    <div className="rounded-card border border-danger-600/30 bg-[#f9e5e4]/40 p-3 sm:col-span-2 lg:col-span-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-danger-600">Son Hata</p>
                      <p className="mt-1 text-xs text-text-primary">{backup.lastError}</p>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  title="Henüz yedek alınmamış"
                  description="BACKUP_STATUS_FILE tanımlı değil veya script henüz çalışmadı. Kurulum için docs/backup-restore.md dosyasına bakın."
                />
              )
            )}
          </SectionCard>

          {/* Özel devam durumları — org ayarı */}
          <SectionCard
            title="Özel Devam Durumları"
            description="Puantajda varsayılan durumların (PRESENT/ABSENT/...) yanında kullanılacak kurum tanımlı durumlar."
            action={<Button loading={saving} onClick={() => void saveSettings()}>Kaydet</Button>}
          >
            {settingsNotice && (
              <p role="status" className="rounded-card border border-border-default bg-surface-50 px-4 py-3 text-xs text-brand-900">
                {settingsNotice}
              </p>
            )}
            {settingsError && <ErrorState title="Ayarlar kaydedilemedi" message={settingsError} />}

            {statuses.length === 0 ? (
              <EmptyState title="Özel durum yok" description="Yalnızca varsayılan durumlar kullanılıyor. Eklemek için aşağıdaki formu kullanın." />
            ) : (
              <ul className="flex flex-wrap gap-2">
                {statuses.map((s) => (
                  <li key={s.key} className="flex items-center gap-1">
                    <StatusBadge tone="neutral">{`${s.label} (${s.key})`}</StatusBadge>
                    <button
                      type="button"
                      aria-label={`${s.label} durumunu kaldır`}
                      className="text-sm text-text-secondary hover:text-danger-600"
                      onClick={() => setStatuses(statuses.filter((x) => x.key !== s.key))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={addStatus} className="grid gap-3 sm:grid-cols-3">
              <TextField label="Anahtar" placeholder="IZINLI" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
              <TextField label="Etiket" placeholder="Ücretli İzin" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
              <div className="flex items-end">
                <Button variant="secondary" type="submit">Durum Ekle</Button>
              </div>
            </form>
          </SectionCard>
        </div>
      )}
    </AppShell>
  );
}
