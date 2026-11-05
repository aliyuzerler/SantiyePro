import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { TextField } from '../components/ui/TextField';
import { tokenStorage } from '../lib/secure-store';
import { attendanceApi, personnelApi, projectsApi, type PersonnelDto, type ProjectDto } from '../lib/api';
import { generateClientMutationId } from '../lib/offline-media-queue';
import { offlineAttendanceQueue } from '../lib/offline-attendance-queue';
import { colors, radius, spacing, typography } from '../theme/tokens';

/**
 * Puantaj işaretleme (Faz 06 — mobil saha akışı, design/02):
 * hızlı personel arama + satır bazlı tek dokunuşla işaretleme.
 *
 * Kurallar (prompts/phase-06-development.md):
 * - GPS YOKTUR: konum izni istenmez, konum toplanmaz (docs/07).
 * - Çevrimdışıyken işaretlemeler kuyruğa alınır; aynı personel/gün/vardiya
 *   için tek bekleyen kayıt tutulur (duplicate/local conflict koruması).
 *   Bağlantı varken anında sunucuya yazılır (idempotent clientMutationId).
 */

const todayWorkDate = () => new Date().toISOString().slice(0, 10);

interface AttendanceRow {
  personnel: PersonnelDto;
  recordId: string | null;
  recordStatus: string | null;
  /** Satırda seçilmiş durum (kuyruk/sunucuya gönderilen). */
  markedStatus: string | null;
  /** Yerel çakışma: kuyruktaki işaretleme daha önce farklıydı. */
  conflict: boolean;
  pendingOffline: boolean;
}

export function AttendanceScreen({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState(todayWorkDate());
  const [shiftKey] = useState('GUNDUZ');

  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>({});

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await tokenStorage.loadAccessToken();
      if (!token) return;
      try {
        const [projectRes, statusRes] = await Promise.all([
          projectsApi.list(token, { sort: 'name', order: 'asc' }),
          attendanceApi.statuses(token),
        ]);
        setProjects(projectRes.data);
        setStatuses(statusRes.statuses);
        setStatusLabels(statusRes.labels);
      } catch {
        setProjects([]);
      }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadRows = useCallback(async () => {
    if (!projectId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const token = await tokenStorage.loadAccessToken();
      if (!token) return;
      const [people, recordsRes] = await Promise.all([
        personnelApi.list(token, { search: search || undefined, status: 'ACTIVE' }),
        attendanceApi.list(token, { projectId, workDate, shiftKey }),
      ]);
      const byPersonnel = new Map(recordsRes.data.map((r) => [r.personnelId, r]));
      setRows(
        people.data.map((p) => {
          const record = byPersonnel.get(p.id) ?? null;
          return {
            personnel: p,
            recordId: record?.id ?? null,
            recordStatus: record?.status ?? null,
            markedStatus: record?.status ?? null,
            conflict: false,
            pendingOffline: false,
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Puantaj listesi yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [projectId, workDate, shiftKey, search]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const mark = useCallback(
    async (row: AttendanceRow, status: string) => {
      if (!projectId) return;
      setSavingId(row.personnel.id);
      setNotice(undefined);
      setError(undefined);
      try {
        const token = await tokenStorage.loadAccessToken();
        const mutationId = generateClientMutationId();
        if (!token) {
          // Çevrimdışı: kuyruğa al (duplicate + çakışma koruması kuyruğun içinde).
          const result = await offlineAttendanceQueue.enqueue({
            clientMutationId: mutationId,
            projectId,
            personnelId: row.personnel.id,
            workDate,
            shiftKey,
            attendanceStatus: status,
          });
          setRows((prev) =>
            prev.map((r) =>
              r.personnel.id === row.personnel.id
                ? {
                    ...r,
                    markedStatus: status,
                    conflict: result.hadConflict,
                    pendingOffline: !result.wasDuplicate,
                  }
                : r,
            ),
          );
          setNotice(
            result.wasDuplicate
              ? 'Bu işaretleme kuyrukta zaten bekliyor.'
              : 'Çevrimdışı: işaretleme kuyruğa alındı, bağlantı gelince gönderilecek.',
          );
          return;
        }
        // Çevrimiçi: idempotent tek istek; kuyruğa da yazılır ki uygulama
        // kapanırsa durum kaybolmasın — başarıda kuyruk kapanır.
        const enqueued = await offlineAttendanceQueue.enqueue({
          clientMutationId: mutationId,
          projectId,
          personnelId: row.personnel.id,
          workDate,
          shiftKey,
          attendanceStatus: status,
        });
        if (!enqueued.wasDuplicate) {
          const sent = await offlineAttendanceQueue.flush(async (item) => {
            try {
              await attendanceApi.create(token, {
                projectId: item.projectId,
                personnelId: item.personnelId,
                workDate: item.workDate,
                shiftKey: item.shiftKey,
                status: item.attendanceStatus,
                note: item.note,
                clientMutationId: item.clientMutationId,
              });
              return true;
            } catch {
              return false;
            }
          });
          if (sent.sent === 0) {
            setRows((prev) =>
              prev.map((r) =>
                r.personnel.id === row.personnel.id ? { ...r, markedStatus: status, pendingOffline: true } : r,
              ),
            );
            setNotice('Bağlantı sorunu: işaretleme kuyruğa alındı.');
            return;
          }
        }
        await offlineAttendanceQueue.clearDone();
        setRows((prev) =>
          prev.map((r) =>
            r.personnel.id === row.personnel.id
              ? { ...r, markedStatus: status, conflict: enqueued.hadConflict, pendingOffline: false }
              : r,
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'İşaretleme kaydedilemedi');
      } finally {
        setSavingId(null);
      }
    },
    [projectId, workDate, shiftKey],
  );

  const pendingOfflineCount = useMemo(() => rows.filter((r) => r.pendingOffline).length, [rows]);

  return (
    <View style={styles.root} testID="attendance-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Puantaj İşaretle</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} style={styles.closeButton}>
          <X size={22} color={colors.brand[900]} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error && <ErrorState message={error} onRetry={() => void loadRows()} />}

        {/* Proje seçimi */}
        <Card>
            <Text style={styles.cardTitle}>Proje ve Gün</Text>
            <Text style={styles.cardDesc}>Puantaj proje, gün ve vardiya bazında tutulur. GPS/konum istenmez.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {projects.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityState={{ selected: projectId === p.id }}
                onPress={() => setProjectId(p.id)}
                style={[styles.chip, projectId === p.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>{p.code}</Text>
              </Pressable>
            ))}
            {projects.length === 0 && <Text style={styles.emptyText}>Kapsamda proje yok.</Text>}
          </ScrollView>
          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>Gün:</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Bugünü seç"
              onPress={() => setWorkDate(todayWorkDate())}
              style={[styles.chip, styles.chipActive]}
            >
              <Text style={styles.chipTextActive}>{workDate}</Text>
            </Pressable>
            <Text style={styles.dateLabel}>Vardiya: Gündüz</Text>
          </View>
        </Card>

        {/* Hızlı arama */}
        <TextField
          label="Hızlı Personel Arama"
          placeholder="Ad soyad veya sicil"
          value={searchInput}
          onChangeText={setSearchInput}
        />

        {notice && (
          <View style={styles.notice} testID="attendance-notice">
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}
        {pendingOfflineCount > 0 && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{pendingOfflineCount} işaretleme kuyrukta — bağlantı gelince gönderilecek.</Text>
          </View>
        )}

        {/* Satır bazlı işaretleme */}
        {!projectId ? (
          <Card>
            <Text style={styles.cardTitle}>Puantaj Sayfası</Text>
            <Text style={styles.emptyText}>Başlamak için bir proje seçin.</Text>
          </Card>
        ) : loading ? (
          <Card>
            <Text style={styles.cardTitle}>Puantaj Sayfası</Text>
            <Text style={styles.emptyText}>Yükleniyor…</Text>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <Text style={styles.cardTitle}>Puantaj Sayfası</Text>
            <Text style={styles.emptyText}>Aramanıza uyan aktif personel yok.</Text>
          </Card>
        ) : (
          rows.map((row) => (
            <View key={row.personnel.id} style={styles.row} testID={`attendance-row-${row.personnel.id}`}>
              <View style={styles.rowHead}>
                <Text style={styles.rowName}>{row.personnel.fullName}</Text>
                {row.personnel.employeeCode && (
                  <Text style={styles.rowCode}>Sicil {row.personnel.employeeCode}</Text>
                )}
                {row.conflict && <Text style={styles.rowConflict}>Kuyruktaki işaretleme değiştirildi</Text>}
                {row.pendingOffline && <Text style={styles.rowPending}>Kuyrukta</Text>}
              </View>
              <View style={styles.statusRow}>
                {statuses.map((s) => (
                  <Pressable
                    key={s}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.personnel.fullName}: ${statusLabels[s] ?? s}`}
                    accessibilityState={{ selected: row.markedStatus === s, disabled: savingId === row.personnel.id }}
                    disabled={savingId === row.personnel.id}
                    onPress={() => void mark(row, s)}
                    style={[styles.statusChip, row.markedStatus === s && styles.statusChipActive]}
                  >
                    <Text style={[styles.statusChipText, row.markedStatus === s && styles.statusChipTextActive]}>
                      {statusLabels[s] ?? s}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}

        <Button
          label="Listeyi Yenile"
          variant="secondary"
          onPress={() => void loadRows()}
          style={styles.refreshButton}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface[50] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[6],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: colors.surface[0],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  title: { ...typography.screenTitle, color: colors.brand[900] },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  chipRow: { marginBottom: spacing[2] },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface[0],
    marginRight: spacing[2],
  },
  chipActive: { backgroundColor: colors.brand[600], borderColor: colors.brand[600] },
  chipText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  dateLabel: { color: colors.text.secondary, fontSize: 12 },
  notice: {
    borderRadius: radius.button,
    backgroundColor: '#e8f4ed',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  noticeText: { color: colors.semantic.success, fontSize: 12, fontWeight: '600' },
  row: {
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface[0],
    padding: spacing[3],
    gap: spacing[2],
  },
  rowHead: { gap: 2 },
  rowName: { ...typography.body, fontWeight: '700', color: colors.brand[900] },
  rowCode: { color: colors.text.secondary, fontSize: 11 },
  rowConflict: { color: colors.semantic.danger, fontSize: 11, fontWeight: '600' },
  rowPending: { color: '#8a6119', fontSize: 11, fontWeight: '600' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  statusChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface[50],
  },
  statusChipActive: { backgroundColor: colors.brand[600], borderColor: colors.brand[600] },
  statusChipText: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  statusChipTextActive: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  refreshButton: { marginTop: spacing[2] },
  emptyText: { color: colors.text.secondary, fontSize: 13 },
  cardTitle: { ...typography.sectionTitle, marginBottom: 2 },
  cardDesc: { color: colors.text.secondary, fontSize: 12, marginBottom: 8 },
});
