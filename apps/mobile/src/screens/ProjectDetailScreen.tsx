import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, MapPin, Users } from 'lucide-react-native';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TextField } from '../components/ui/TextField';
import { tokenStorage } from '../lib/secure-store';
import { ApiError, projectsApi, usersApi, type ProjectDetailDto, type UserDto } from '../lib/api';
import {
  PROJECT_SCOPE_ROLE_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  SITE_STATUS_LABELS,
  canTransitionProjectStatus,
  permissionsForRoles,
  type ProjectStatus,
} from '@santiyepro/contracts';
import { useAuth } from '../lib/auth-context';
import { colors, spacing, typography } from '../theme/tokens';

type DetailTab = 'genel' | 'santiyeler' | 'uyeler';

const TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'genel', label: 'Genel' },
  { key: 'santiyeler', label: 'Şantiyeler' },
  { key: 'uyeler', label: 'Üyeler' },
];

function statusTone(status: ProjectStatus): 'approved' | 'pending' | 'submitted' | 'neutral' | 'draft' {
  switch (status) {
    case 'ACTIVE':
      return 'approved';
    case 'ON_HOLD':
      return 'pending';
    case 'COMPLETED':
      return 'submitted';
    case 'ARCHIVED':
      return 'neutral';
    default:
      return 'draft';
  }
}

/**
 * Sekmeli proje detayı (Faz 03): Genel / Şantiyeler / Üyeler.
 * Aktif proje bağlamı (kod + ad + durum) başlıkta kalıcı görünür — proje
 * değiştiricide yanlış projeye kayıt açma hatası önlenir (design/02).
 * Yazma işlemleri yalnızca project.edit izni olan kullanıcılara çizilir.
 */
export function ProjectDetailScreen({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { user } = useAuth();
  const canEdit = permissionsForRoles(user?.roles ?? []).has('project.edit');

  const [project, setProject] = useState<ProjectDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<DetailTab>('genel');

  const load = useCallback(async () => {
    const token = await tokenStorage.loadAccessToken();
    if (!token) {
      setError('Oturum bulunamadı. Lütfen tekrar giriş yapın.');
      setLoading(false);
      return;
    }
    setError(undefined);
    try {
      const detail = await projectsApi.get(token, projectId);
      setProject(detail);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('Proje bulunamadı veya erişim kapsamınızda değil.');
      } else {
        setError(err instanceof Error ? err.message : 'Proje yüklenemedi');
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Düzenleme formu
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [form, setForm] = useState({ name: '', clientName: '', address: '', startDate: '', plannedEndDate: '', contractAmount: '' });

  // Şantiye ekleme
  const [siteName, setSiteName] = useState('');
  const [siteError, setSiteError] = useState<string>();
  const [addingSite, setAddingSite] = useState(false);

  // Üye ekleme
  const [users, setUsers] = useState<UserDto[] | null>(null);
  const [memberError, setMemberError] = useState<string>();
  const [addingMember, setAddingMember] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const nextStatuses = project
    ? PROJECT_STATUSES.filter((s) => canTransitionProjectStatus(project.status, s))
    : [];

  async function changeStatus(next: ProjectStatus) {
    const token = await tokenStorage.loadAccessToken();
    if (!token || !project) return;
    try {
      await projectsApi.update(token, project.id, { status: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Durum değiştirilemedi');
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Aktif proje bağlamı */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Projeler listesine dön"
        onPress={onBack}
        style={styles.backRow}
      >
        <ChevronLeft size={18} color={colors.brand[900]} />
        <Text style={styles.backText}>Projeler</Text>
      </Pressable>

      <View style={styles.contextCard}>
        {project && <Text style={styles.contextCode}>{project.code}</Text>}
        <Text style={styles.contextName}>{loading ? 'Yükleniyor…' : project?.name ?? '—'}</Text>
        {project && (
          <View style={styles.contextBadge}>
            <StatusBadge tone={statusTone(project.status)}>{PROJECT_STATUS_LABELS[project.status]}</StatusBadge>
          </View>
        )}
      </View>

      {/* Sekmeler */}
      <View style={styles.tabRow} accessibilityRole="tablist">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${t.label} sekmesi`}
              onPress={() => setTab(t.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {loading && !project && <LoadingSkeleton rows={5} />}

      {project && tab === 'genel' && (
        <>
          <Card>
            <Text style={typography.sectionTitle}>Genel Bilgiler</Text>
            <View style={styles.infoGap}>
              <Text style={styles.infoText}>İşveren: {project.clientName ?? '—'}</Text>
              <Text style={styles.infoText}>Sorumlu: {project.manager?.fullName ?? '—'}</Text>
              <Text style={styles.infoText}>Adres: {project.address ?? '—'}</Text>
              <Text style={styles.infoText}>
                Tarih: {project.startDate ?? '—'} → {project.plannedEndDate ?? '—'}
              </Text>
              <Text style={styles.infoText}>
                Sözleşme: {project.contractAmount ? `${project.contractAmount} ${project.currency}` : '—'}
              </Text>
              {project.description ? <Text style={styles.infoText}>{project.description}</Text> : null}
            </View>
          </Card>

          {canEdit && project.status !== 'ARCHIVED' && (
            <Card>
              <Text style={typography.sectionTitle}>Durum Yönetimi</Text>
              {nextStatuses.length === 0 ? (
                <Text style={typography.secondary}>Bu durumdan geçiş yapılamaz.</Text>
              ) : (
                <View style={styles.statusRow}>
                  {nextStatuses.map((s) => (
                    <View key={s} style={styles.statusAction}>
                      <Button
                        label={s === 'ARCHIVED' ? 'Arşivle' : PROJECT_STATUS_LABELS[s]}
                        variant={s === 'ARCHIVED' ? 'destructive' : 'secondary'}
                        onPress={() => void changeStatus(s)}
                        accessibilityLabel={`Durumu ${PROJECT_STATUS_LABELS[s]} yap`}
                      />
                    </View>
                  ))}
                </View>
              )}
            </Card>
          )}

          {canEdit && project.status !== 'ARCHIVED' && (
            <Card>
              <Button
                label={editing ? 'Formu Kapat' : 'Bilgileri Düzenle'}
                variant={editing ? 'secondary' : 'primary'}
                onPress={() => {
                  setEditing((v) => !v);
                  setFormError(undefined);
                  setForm({
                    name: project.name,
                    clientName: project.clientName ?? '',
                    address: project.address ?? '',
                    startDate: project.startDate ?? '',
                    plannedEndDate: project.plannedEndDate ?? '',
                    contractAmount: project.contractAmount ?? '',
                  });
                }}
              />
              {editing && (
                <View style={styles.formGap}>
                  <TextField label="Proje Adı" required value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
                  <TextField label="İşveren" value={form.clientName} onChangeText={(v) => setForm((f) => ({ ...f, clientName: v }))} />
                  <TextField label="Adres" value={form.address} onChangeText={(v) => setForm((f) => ({ ...f, address: v }))} />
                  <TextField label="Başlangıç (YYYY-MM-DD)" value={form.startDate} onChangeText={(v) => setForm((f) => ({ ...f, startDate: v }))} />
                  <TextField label="Planlanan Bitiş (YYYY-MM-DD)" value={form.plannedEndDate} onChangeText={(v) => setForm((f) => ({ ...f, plannedEndDate: v }))} />
                  <TextField label="Sözleşme Tutarı" value={form.contractAmount} onChangeText={(v) => setForm((f) => ({ ...f, contractAmount: v }))} />
                  {formError ? <Text style={styles.formError}>{formError}</Text> : null}
                  <Button
                    label="Kaydet"
                    onPress={async () => {
                      const token = await tokenStorage.loadAccessToken();
                      if (!token || !project) return;
                      setFormError(undefined);
                      try {
                        await projectsApi.update(token, project.id, {
                          name: form.name.trim(),
                          clientName: form.clientName.trim() || null,
                          address: form.address.trim() || null,
                          startDate: form.startDate.trim() || null,
                          plannedEndDate: form.plannedEndDate.trim() || null,
                          contractAmount: form.contractAmount.trim() || null,
                        });
                        setEditing(false);
                        await load();
                      } catch (err) {
                        setFormError(err instanceof Error ? err.message : 'Proje güncellenemedi');
                      }
                    }}
                  />
                </View>
              )}
            </Card>
          )}
        </>
      )}

      {project && tab === 'santiyeler' && (
        <>
          {project.sites.length === 0 ? (
            <EmptyState title="Şantiye yok" description="Bu projeye ait şantiye/alan eklenmemiş." />
          ) : (
            project.sites.map((s) => (
              <Card key={s.id}>
                <View style={styles.cardHead}>
                  <View style={styles.cardTitleWrap}>
                    <View style={styles.siteNameRow}>
                      <MapPin size={14} color={colors.brand[600]} />
                      <Text style={styles.siteName}>{s.name}</Text>
                    </View>
                    <Text style={styles.infoText}>{s.address ?? 'Adres belirtilmemiş'}</Text>
                  </View>
                  <StatusBadge tone={s.status === 'ACTIVE' ? 'approved' : 'draft'}>{SITE_STATUS_LABELS[s.status]}</StatusBadge>
                </View>
                {canEdit && project.status !== 'ARCHIVED' && (
                  <View style={styles.siteAction}>
                    <Button
                      label={s.status === 'ACTIVE' ? 'Pasife Al' : 'Aktifleştir'}
                      variant="secondary"
                      onPress={async () => {
                        const token = await tokenStorage.loadAccessToken();
                        if (!token) return;
                        try {
                          await projectsApi.updateSite(token, project.id, s.id, {
                            status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                          });
                          await load();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Şantiye durumu değiştirilemedi');
                        }
                      }}
                    />
                  </View>
                )}
              </Card>
            ))
          )}

          {canEdit && project.status !== 'ARCHIVED' && (
            <Card>
              <Text style={typography.sectionTitle}>Şantiye Ekle</Text>
              <View style={styles.formGap}>
                <TextField label="Şantiye Adı" required value={siteName} onChangeText={setSiteName} placeholder="Örn. Kazı Alanı" />
                {siteError ? <Text style={styles.formError}>{siteError}</Text> : null}
                <Button
                  label="Şantiye Ekle"
                  loading={addingSite}
                  onPress={async () => {
                    const token = await tokenStorage.loadAccessToken();
                    if (!token || !siteName.trim()) return;
                    setAddingSite(true);
                    setSiteError(undefined);
                    try {
                      await projectsApi.createSite(token, project.id, { name: siteName.trim() });
                      setSiteName('');
                      await load();
                    } catch (err) {
                      setSiteError(err instanceof Error ? err.message : 'Şantiye eklenemedi');
                    } finally {
                      setAddingSite(false);
                    }
                  }}
                />
              </View>
            </Card>
          )}
        </>
      )}

      {project && tab === 'uyeler' && (
        <>
          <Card>
            <View style={styles.cardHead}>
              <View style={styles.cardTitleWrap}>
                <View style={styles.siteNameRow}>
                  <Users size={14} color={colors.brand[600]} />
                  <Text style={typography.sectionTitle}>Proje Üyeleri ({project.members.length})</Text>
                </View>
              </View>
            </View>
            {project.members.length === 0 ? (
              <EmptyState title="Üye yok" description="Yalnızca üyeler bu projenin kayıtlarına erişebilir." />
            ) : (
              <View style={styles.memberGap}>
                {project.members.map((m) => (
                  <View key={m.id} style={styles.memberRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>
                        {m.fullName}
                        {m.isManager ? ' · Sorumlu' : ''}
                      </Text>
                      <Text style={typography.secondary}>
                        {m.email} — {PROJECT_SCOPE_ROLE_LABELS[m.scopeRole]}
                      </Text>
                    </View>
                    {canEdit && project.status !== 'ARCHIVED' && !m.isManager && (
                      <View style={styles.memberActions}>
                        {confirmRemoveId === m.id ? (
                          <>
                            <Button
                              label="Onayla"
                              variant="destructive"
                              onPress={async () => {
                                const token = await tokenStorage.loadAccessToken();
                                if (!token) return;
                                try {
                                  await projectsApi.removeMember(token, project.id, m.id);
                                  setConfirmRemoveId(null);
                                  await load();
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : 'Üye çıkarılamadı');
                                  setConfirmRemoveId(null);
                                }
                              }}
                            />
                            <Button label="Vazgeç" variant="secondary" onPress={() => setConfirmRemoveId(null)} />
                          </>
                        ) : (
                          <Button label="Çıkar" variant="secondary" onPress={() => setConfirmRemoveId(m.id)} />
                        )}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </Card>

          {canEdit && project.status !== 'ARCHIVED' && (
            <Card>
              <Text style={typography.sectionTitle}>Üye Ekle</Text>
              <View style={styles.formGap}>
                {users === null ? (
                  <Button
                    label="Kullanıcı Listesini Yükle"
                    variant="secondary"
                    onPress={async () => {
                      const token = await tokenStorage.loadAccessToken();
                      if (!token) return;
                      try {
                        const res = await usersApi.list(token);
                        setUsers(res.data);
                      } catch (err) {
                        setMemberError(err instanceof Error ? err.message : 'Kullanıcı listesi yüklenemedi');
                      }
                    }}
                  />
                ) : (
                  <>
                    {users.filter((u) => !project.members.some((m) => m.userId === u.id)).length === 0 ? (
                      <Text style={typography.secondary}>Eklenebilecek kullanıcı kalmadı.</Text>
                    ) : (
                      users
                        .filter((u) => !project.members.some((m) => m.userId === u.id))
                        .slice(0, 15)
                        .map((u) => (
                          <View key={u.id} style={styles.memberRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.memberName}>{u.fullName}</Text>
                              <Text style={typography.secondary}>{u.email}</Text>
                            </View>
                            <View style={styles.memberActions}>
                              <Button
                                label="Ekle"
                                loading={addingMember}
                                onPress={async () => {
                                  const token = await tokenStorage.loadAccessToken();
                                  if (!token) return;
                                  setAddingMember(true);
                                  setMemberError(undefined);
                                  try {
                                    await projectsApi.addMember(token, project.id, { userId: u.id, scopeRole: 'WORKER' });
                                    await load();
                                  } catch (err) {
                                    setMemberError(err instanceof Error ? err.message : 'Üye eklenemedi');
                                  } finally {
                                    setAddingMember(false);
                                  }
                                }}
                              />
                            </View>
                          </View>
                        ))
                    )}
                  </>
                )}
                {memberError ? <Text style={styles.formError}>{memberError}</Text> : null}
              </View>
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface[50] },
  content: { padding: spacing['4'], gap: spacing['3'] },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  backText: { fontSize: 13, fontWeight: '700', color: colors.brand[900] },
  contextCard: {
    backgroundColor: colors.brand[900],
    borderRadius: 12,
    padding: spacing['4'],
    gap: 4,
  },
  contextCode: { fontSize: 11, fontWeight: '800', color: '#D99A2B', letterSpacing: 1 },
  contextName: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  contextBadge: { alignSelf: 'flex-start', marginTop: 4 },
  tabRow: {
    flexDirection: 'row',
    gap: spacing['2'],
    backgroundColor: colors.surface[0],
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 12,
    padding: 4,
  },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: colors.brand[900] },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.text.secondary },
  tabTextActive: { color: '#FFFFFF', fontWeight: '800' },
  infoGap: { gap: spacing['2'], marginTop: spacing['2'] },
  infoText: { fontSize: 13, color: colors.text.primary, lineHeight: 19 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing['2'], marginTop: spacing['2'] },
  statusAction: { minWidth: 120 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing['2'] },
  cardTitleWrap: { flex: 1, gap: 2 },
  siteNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  siteName: { fontSize: 15, fontWeight: '700', color: colors.text.primary },
  siteAction: { marginTop: spacing['3'] },
  formGap: { gap: spacing['3'], marginTop: spacing['2'] },
  formError: { fontSize: 12, fontWeight: '600', color: colors.semantic.danger },
  memberGap: { gap: spacing['3'], marginTop: spacing['2'] },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing['2'] },
  memberName: { fontSize: 14, fontWeight: '700', color: colors.text.primary },
  memberActions: { flexDirection: 'row', gap: spacing['2'], alignItems: 'center' },
});
