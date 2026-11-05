'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, TextField } from '@/components/ui/Field';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/lib/auth';
import { ApiError, usersApi, type RoleDto, type UsersListResponse } from '@/lib/api';
import { permissionsForRoles, SYSTEM_ROLE_LABELS, type UserDto } from '@santiyepro/contracts';

/**
 * Kullanıcılar & Yetkiler (Faz 02 — gerçek API verisi).
 * Liste: user.view izni; oluşturma/rol/status yönetimi: user.manage izni (deny-by-default,
 * API tarafında PermissionsGuard ile zorunlu; UI'da izne göre aksiyonlar gizlenir).
 */
export default function UsersPage() {
  const { user, getToken } = useAuth();
  const token = getToken();

  const [list, setList] = useState<UsersListResponse | null>(null);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  // Yeni kullanıcı formu
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleKey, setRoleKey] = useState('FIELD_WORKER');
  const [formError, setFormError] = useState<string>();
  const [creating, setCreating] = useState(false);

  const canManage = permissionsForRoles(user?.roles ?? []).has('user.manage');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(undefined);
    try {
      const [users, roleList] = await Promise.all([usersApi.list(token), usersApi.roles(token)]);
      setList(users);
      setRoles(roleList.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Oturumunuz sona erdi. Tekrar giriş yapın.');
      } else {
        setError(err instanceof Error ? err.message : 'Kullanıcılar yüklenemedi');
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    setFormError(undefined);
    try {
      await usersApi.create(token, { fullName, email, password, roles: [roleKey] });
      setShowForm(false);
      setFullName('');
      setEmail('');
      setPassword('');
      setRoleKey('FIELD_WORKER');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Kullanıcı oluşturulamadı');
    } finally {
      setCreating(false);
    }
  }

  async function onToggleStatus(target: UserDto) {
    if (!token) return;
    try {
      await usersApi.update(token, target.id, { status: target.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Durum değiştirilemedi');
    }
  }

  async function onChangeRole(target: UserDto, nextRole: string) {
    if (!token) return;
    try {
      await usersApi.update(token, target.id, { roles: [nextRole] });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rol değiştirilemedi');
    }
  }

  const canView = permissionsForRoles(user?.roles ?? []).has('user.view');

  return (
    <AppShell title="Kullanıcılar & Yetkiler">
      <PageHeader
        title="Kullanıcılar & Yetkiler"
        description="Firma çalışanlarını yönetin; roller ve erişim izinleri rol-yetki matrisine göre belirlenir."
      />

      {canView ? (
        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} onRetry={() => void load()} />}

          <SectionCard
            title={`Kullanıcı Listesi${list ? ` (${list.meta.total})` : ''}`}
            description="Denetim günlüğüne yazılan değişikliklerle birlikte yönetilir."
            action={
              canManage && (
                <Button
                  variant={showForm ? 'secondary' : 'primary'}
                  onClick={() => setShowForm((v) => !v)}
                  leading={showForm ? undefined : '+'}
                >
                  {showForm ? 'Vazgeç' : 'Yeni Kullanıcı'}
                </Button>
              )
            }
          >
            {showForm && canManage && (
              <form onSubmit={onCreate} className="mb-6 grid gap-3 rounded-card border border-border-default bg-surface-50 p-4 md:grid-cols-2">
                <TextField label="Ad Soyad" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                <TextField label="E-posta" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                <TextField
                  label="İlk Parola"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  helpText="En az 10 karakter; büyük/küçük harf ve rakam."
                />
                <Select
                  label="Rol"
                  value={roleKey}
                  onChange={(e) => setRoleKey(e.target.value)}
                  options={roles.map((r) => ({ value: r.key, label: r.label }))}
                />
                <div className="md:col-span-2">
                  {formError && (
                    <p role="alert" className="mb-2 text-xs font-medium text-danger-600">
                      {formError}
                    </p>
                  )}
                  <Button type="submit" loading={creating} loadingLabel="Oluşturuluyor…">
                    Kullanıcı Oluştur
                  </Button>
                </div>
              </form>
            )}

            {loading ? (
              <LoadingSkeleton rows={4} />
            ) : list && list.data.length === 0 ? (
              <EmptyState
                title="Henüz kullanıcı yok"
                description="Firma çalışanları için kullanıcı oluşturun; her kullanıcı rolüne göre yetkilendirilir."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-secondary">
                      <th scope="col" className="py-2 pr-4">Ad Soyad</th>
                      <th scope="col" className="py-2 pr-4">E-posta</th>
                      <th scope="col" className="py-2 pr-4">Rol</th>
                      <th scope="col" className="py-2 pr-4">Durum</th>
                      {canManage && <th scope="col" className="py-2">İşlem</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {list?.data.map((u) => (
                      <tr key={u.id} className="border-b border-border-default/60 last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-text-primary">{u.fullName}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{u.email}</td>
                        <td className="py-2.5 pr-4">
                          {canManage && u.id !== user?.id ? (
                            <select
                              aria-label={`${u.fullName} rolü`}
                              className="min-h-9 rounded-input border border-border-default bg-surface-0 px-2 text-sm"
                              value={u.roles[0] ?? ''}
                              onChange={(e) => void onChangeRole(u, e.target.value)}
                            >
                              {roles.map((r) => (
                                <option key={r.key} value={r.key}>
                                  {SYSTEM_ROLE_LABELS[r.key as keyof typeof SYSTEM_ROLE_LABELS] ?? r.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            u.roles.map((r) => SYSTEM_ROLE_LABELS[r as keyof typeof SYSTEM_ROLE_LABELS] ?? r).join(', ')
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          <StatusBadge tone={u.status === 'ACTIVE' ? 'approved' : 'draft'}>
                            {u.status === 'ACTIVE' ? 'Aktif' : 'Devre dışı'}
                          </StatusBadge>
                        </td>
                        {canManage && (
                          <td className="py-2.5">
                            <Button
                              variant={u.status === 'ACTIVE' ? 'destructive' : 'secondary'}
                              disabled={u.id === user?.id}
                              onClick={() => void onToggleStatus(u)}
                              className="min-h-9 px-3 py-1 text-xs"
                            >
                              {u.status === 'ACTIVE' ? 'Devre Dışı Bırak' : 'Aktifleştir'}
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <p className="text-xs leading-5 text-text-secondary">
            Güvenlik: Kullanıcı devre dışı bırakıldığında tüm oturum token'ları anında iptal edilir; rol ve durum
            değişiklikleri denetim günlüğüne yazılır (docs/07).
          </p>
        </div>
      ) : (
        <ErrorState
          title="Yetkisiz erişim"
          message="Bu sayfayı görüntülemek için gerekli izniniz yok (user.view). Firma yöneticinize başvurun."
        />
      )}
    </AppShell>
  );
}
