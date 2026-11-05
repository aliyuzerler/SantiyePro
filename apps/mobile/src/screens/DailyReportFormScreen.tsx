import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { X } from 'lucide-react-native';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { TextField } from '../components/ui/TextField';
import { tokenStorage } from '../lib/secure-store';
import { dailyReportsApi, mediaApi, projectsApi, type ProjectDto } from '../lib/api';
import {
  generateClientMutationId,
  offlineMediaQueue,
} from '../lib/offline-media-queue';
import { colors, radius, spacing, typography } from '../theme/tokens';

/**
 * Günlük rapor formu (Faz 05 — mobil öncelikli, design/02 §4):
 * bölümlü form; proje/şantiye, tarih, hava durumu, yapılan işler, ekip özeti,
 * ekipman, sorun/gecikme, İSG notu, ertesi gün planı, fotoğraf ekleri.
 *
 * Metin korunumu: TASLAK ÖNCE kaydedilir, fotoğraflar SONRA yüklenir; yükleme
 * başarısız olursa metin sunucuda güvende kalır ve dosya çevrimdışı kuyruğa
 * alınır (Faz 09'da otomatik yeniden yükleme).
 */

interface PickedImage {
  uri: string;
  mimeType: string;
  sizeBytes: number;
}

interface WorkerRow {
  name: string;
  jobTitle: string;
  workerCount: number;
  hours: string;
}

const emptyWorker: WorkerRow = { name: '', jobTitle: '', workerCount: 1, hours: '8' };

export function DailyReportFormScreen({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sites, setSites] = useState<Array<{ id: string; name: string }>>([]);
  const [siteId, setSiteId] = useState<string | null>(null);

  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [weather, setWeather] = useState('');
  const [workSummary, setWorkSummary] = useState('');
  const [workforceSummary, setWorkforceSummary] = useState('');
  const [equipmentSummary, setEquipmentSummary] = useState('');
  const [issues, setIssues] = useState('');
  const [safetyNotes, setSafetyNotes] = useState('');
  const [nextDayPlan, setNextDayPlan] = useState('');
  const [workers, setWorkers] = useState<WorkerRow[]>([]);

  const [images, setImages] = useState<PickedImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await tokenStorage.loadAccessToken();
      if (!token) return;
      try {
        const res = await projectsApi.list(token, { sort: 'name', order: 'asc' });
        setProjects(res.data);
      } catch {
        setProjects([]);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const token = await tokenStorage.loadAccessToken();
      if (!token || !projectId) {
        setSites([]);
        return;
      }
      try {
        const detail = await projectsApi.get(token, projectId);
        setSites(detail.sites.map((s) => ({ id: s.id, name: s.name })));
      } catch {
        setSites([]);
      }
    })();
  }, [projectId]);

  const pickImages = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setWarning('Galeri izni verilmedi; fotoğraf eklenemedi (metin yine de kaydedilir).');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.7,
      exif: false, // GPS/metadata istemci tarafında hiç istenmez; sunucu ayrıca soyar
      selectionLimit: 10,
    });
    if (result.canceled) return;
    const picked: PickedImage[] = result.assets.map((asset) => ({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      sizeBytes: asset.fileSize ?? 0,
    }));
    setImages((prev) => [...prev, ...picked].slice(0, 10));
  }, []);

  function removeImage(uri: string) {
    setImages((prev) => prev.filter((img) => img.uri !== uri));
  }

  function addWorkerRow() {
    setWorkers((rows) => [...rows, { ...emptyWorker }]);
  }

  function updateWorkerRow(index: number, patch: Partial<WorkerRow>) {
    setWorkers((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeWorkerRow(index: number) {
    setWorkers((rows) => rows.filter((_, i) => i !== index));
  }

  async function uploadImages(draftReportId: string, targetProjectId: string): Promise<void> {
    const token = await tokenStorage.loadAccessToken();
    if (!token) return;
    const failures: string[] = [];
    const uploadedIds: string[] = [];

    for (const image of images) {
      const mutationId = generateClientMutationId();
      try {
        const urlRes = await mediaApi.requestUploadUrl(token, {
          filename: `gunluk-rapor-${mutationId.slice(0, 8)}.jpg`,
          mimeType: image.mimeType,
          sizeBytes: Math.max(1, image.sizeBytes),
          projectId: targetProjectId,
        });
        await mediaApi.uploadBinary(urlRes.uploadUrl, image.uri);
        await mediaApi.complete(token, urlRes.mediaId);
        uploadedIds.push(urlRes.mediaId);
        await offlineMediaQueue.markDone(mutationId);
      } catch (err) {
        // Metin zaten taslakta güvende; dosya kuyruğa alınır (Faz 09'da otomatik yeniden yükleme).
        await offlineMediaQueue.enqueue({
          clientMutationId: mutationId,
          localUri: image.uri,
          targetReportId: draftReportId,
          mimeType: image.mimeType,
          sizeBytes: Math.max(1, image.sizeBytes),
        });
        failures.push(err instanceof Error ? err.message : 'Dosya yüklenemedi');
      }
    }

    if (uploadedIds.length > 0) {
      await dailyReportsApi.update(token, draftReportId, { mediaIds: uploadedIds });
    }
    if (failures.length > 0) {
      setWarning(
        `${failures.length} fotoğraf yüklenemedi ve çevrimdışı kuyruğa alındı. Rapor metnin taslakta korundu. (${failures[0] ?? ''})`,
      );
    }
  }

  async function onSaveDraft() {
    const token = await tokenStorage.loadAccessToken();
    if (!token || !projectId) return;
    setSaving(true);
    setError(undefined);
    setWarning(undefined);
    try {
      // 1) Metni ÖNCE kaydet — yükleme başarısız olsa da rapor metni kaybolmaz.
      const draft = await dailyReportsApi.create(token, {
        projectId,
        siteId: siteId ?? undefined,
        reportDate,
        weather: weather || undefined,
        workSummary: workSummary.trim(),
        workforceSummary: workforceSummary || undefined,
        equipmentSummary: equipmentSummary || undefined,
        issues: issues || undefined,
        safetyNotes: safetyNotes || undefined,
        nextDayPlan: nextDayPlan || undefined,
        workers: workers.filter((w) => w.name.trim().length > 0),
      });
      setSavedDraftId(draft.id);

      // 2) Fotoğrafları yükle; başarısızlar kuyruğa girer.
      await uploadImages(draft.id, projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rapor kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit() {
    if (!savedDraftId) return;
    const token = await tokenStorage.loadAccessToken();
    if (!token) return;
    setSaving(true);
    try {
      await dailyReportsApi.submit(token, savedDraftId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rapor gönderilemedi');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={typography.screenTitle}>Günlük Rapor</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Formu kapat" onPress={onClose} style={styles.closeButton}>
          <X size={20} color={colors.brand[900]} />
        </Pressable>
      </View>

      {error ? <ErrorState message={error} onRetry={() => void onSaveDraft()} /> : null}
      {warning ? (
        <Card>
          <Text style={styles.warningText}>{warning}</Text>
        </Card>
      ) : null}

      {/* Proje seçimi */}
      <Text style={typography.sectionTitle}>Proje</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {projects.map((p) => {
          const active = projectId === p.id;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Proje: ${p.name}`}
              accessibilityState={{ selected: active }}
              onPress={() => {
                setProjectId(p.id);
                setSiteId(null);
              }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.code}</Text>
            </Pressable>
          );
        })}
        {projects.length === 0 && <Text style={typography.secondary}>Proje bulunamadı.</Text>}
      </ScrollView>

      {/* Şantiye seçimi */}
      {sites.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Şantiye: genel"
            accessibilityState={{ selected: !siteId }}
            onPress={() => setSiteId(null)}
            style={[styles.chip, !siteId && styles.chipActive]}
          >
            <Text style={[styles.chipText, !siteId && styles.chipTextActive]}>Genel</Text>
          </Pressable>
          {sites.map((s) => {
            const active = siteId === s.id;
            return (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`Şantiye: ${s.name}`}
                accessibilityState={{ selected: active }}
                onPress={() => setSiteId(s.id)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <TextField
        label="Rapor Tarihi (YYYY-MM-DD)"
        value={reportDate}
        onChangeText={setReportDate}
        accessibilityLabel="Rapor tarihi"
      />
      <TextField label="Hava Durumu" value={weather} onChangeText={setWeather} placeholder="Güneş / Yağmurlu…" accessibilityLabel="Hava durumu" />
      <TextField
        label="Yapılan İşler"
        value={workSummary}
        onChangeText={setWorkSummary}
        multiline
        numberOfLines={4}
        accessibilityLabel="Yapılan işler"
      />
      <TextField
        label="Ekip / Personel Özeti"
        value={workforceSummary}
        onChangeText={setWorkforceSummary}
        multiline
        accessibilityLabel="Ekip özeti"
      />
      <TextField
        label="Ekipman ve Makine"
        value={equipmentSummary}
        onChangeText={setEquipmentSummary}
        multiline
        accessibilityLabel="Ekipman"
      />
      <TextField
        label="Sorun / Gecikme"
        value={issues}
        onChangeText={setIssues}
        multiline
        accessibilityLabel="Sorun gecikme"
      />
      <TextField
        label="İş Güvenliği Notu"
        value={safetyNotes}
        onChangeText={setSafetyNotes}
        multiline
        accessibilityLabel="İş güvenliği notu"
      />
      <TextField
        label="Ertesi Gün Planı"
        value={nextDayPlan}
        onChangeText={setNextDayPlan}
        multiline
        accessibilityLabel="Ertesi gün planı"
      />

      {/* Ekip satırları */}
      <View style={styles.rowBetween}>
        <Text style={typography.sectionTitle}>Ekip Satırları</Text>
        <Button label="Satır Ekle" variant="secondary" onPress={addWorkerRow} />
      </View>
      {workers.map((row, index) => (
        <Card key={index}>
          <TextField label="Ad" value={row.name} onChangeText={(v) => updateWorkerRow(index, { name: v })} accessibilityLabel={`Ekip adı ${index + 1}`} />
          <TextField label="Görev" value={row.jobTitle} onChangeText={(v) => updateWorkerRow(index, { jobTitle: v })} accessibilityLabel={`Ekip görevi ${index + 1}`} />
          <View style={styles.workerRow}>
            <TextField
              label="Kişi"
              value={String(row.workerCount)}
              onChangeText={(v) => updateWorkerRow(index, { workerCount: Math.max(1, Number(v) || 1) })}
              keyboardType="number-pad"
              accessibilityLabel={`Ekip kişi sayısı ${index + 1}`}
            />
            <TextField
              label="Saat"
              value={row.hours}
              onChangeText={(v) => updateWorkerRow(index, { hours: v })}
              accessibilityLabel={`Ekip saati ${index + 1}`}
            />
          </View>
          <Button label="Satırı Sil" variant="secondary" onPress={() => removeWorkerRow(index)} />
        </Card>
      ))}

      {/* Fotoğraflar */}
      <View style={styles.rowBetween}>
        <Text style={typography.sectionTitle}>Fotoğraflar ({images.length})</Text>
        <Button label="Fotoğraf Seç" variant="secondary" onPress={() => void pickImages()} />
      </View>
      {images.length > 0 && (
        <View style={styles.previewRow}>
          {images.map((img) => (
            <View key={img.uri} style={styles.previewWrap}>
              <Image source={{ uri: img.uri }} style={styles.previewImage} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Fotoğrafı kaldır: ${img.uri.slice(-8)}`}
                onPress={() => removeImage(img.uri)}
                style={styles.removeBadge}
              >
                <X size={12} color="#FFFFFF" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.note}>
        Fotoğraflar taslak kaydından sonra yüklenir; yüklenemeyen dosyalar çevrimdışı kuyruğa alınır ve
        rapor metni kaybolmaz. Görsellerin EXIF/GPS verisi sunucuda soyulur.
      </Text>

      {!savedDraftId ? (
        <Button
          label="Taslağı Kaydet"
          disabled={!projectId || saving}
          loading={saving}
          onPress={() => void onSaveDraft()}
        />
      ) : (
        <View style={styles.savedActions}>
          <Text style={styles.savedText}>Taslak kaydedildi ✓ — metin güvende.</Text>
          <Button label="Gönderime Al" disabled={saving} loading={saving} onPress={() => void onSubmit()} />
          <Button label="Kapat" variant="secondary" onPress={onClose} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface[50] },
  content: { padding: spacing['4'], gap: spacing['3'] },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  chipRow: { gap: spacing['2'], paddingVertical: 2 },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface[0],
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.brand[900], borderColor: colors.brand[900] },
  chipText: { fontSize: 12, color: colors.text.primary },
  chipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  workerRow: { flexDirection: 'row', gap: spacing['2'] },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing['2'] },
  previewWrap: { width: 72, height: 72 },
  previewImage: { width: 72, height: 72, borderRadius: radius.input },
  removeBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.semantic.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningText: { fontSize: 12, fontWeight: '600', color: colors.semantic.danger },
  savedActions: { gap: spacing['2'] },
  savedText: { fontSize: 13, fontWeight: '700', color: colors.text.primary },
  note: { ...typography.secondary, textAlign: 'center', marginTop: spacing['1'] },
});
