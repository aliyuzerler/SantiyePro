'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, TextField } from '@/components/ui/Field';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/lib/auth';
import { ApiError, auditApi, usersApi, type AuditLogListParams } from '@/lib/api';
import { permissionsForRoles, type AuditLogEntry, type UserDto } from '@santiyepro/contracts';

/**
 * Denetim Kayıtları (Faz 10) — yalnızca audit.view izniyle (FIRM_ADMIN).
 *
 * Kurallar (prompts/phase-10-development.md, docs/06, docs/07):
 * - Filtreler: entityType / action / aktör / tarih aralığı.
 * - Önce/sonra gövdeleri okunabilir JSON olarak gösterilir; sunucu okuma
 *   anında da hassas alanları maskeler — ekranda ek maskeleme gerekmez.
 * - Sayfalama sunucu tarafındadır; günlük append-only'dir (düzenleme yok).
 */
function trDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'medium' });
}

function JsonBody({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-xs text-text-secondary">—</span>;
  const text = JSON.stringify(value, null, 1);
  return (
    <pre className="max-h-40 overflow-auto rounded-input bg-surface-50 px-3 py-2 text-[11px] leading-4 text-text-primary" aria-label="Kayıt gövdesi">
      {text}
    </pre>
  );
}

export default function AuditLogsPage() {
  const { user, getToken } = useAuth();
  const token = getToken() ?? '';
  const canView = permissionsForRoles(user?.roles ?? []).has('audit.view');

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [meta, setMeta] = useState<{ page: number; totalPages: number; total: number } | null>(null);
  const [facets, setFacets] = useState<{ entityTypes: string[]; actions: string[] }>({ entityTypes: [], actions: [] });
  const [users, setUsers] = useState<UserDto[]>([]);
  const [page, setPage] = useState(1);
  const [filterEntityType, setFilterEntityType] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const seqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!token || !canView) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(undefined);
    try {
      const params: AuditLogListParams = {
        page,
        pageSize: 20,
        entityType: filterEntityType || undefined,
        action: filterAction || undefined,
        actorUserId: filterActor || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
      };
      const res = await auditApi.logs(token, params);
      if (seq !== seqRef.current) return;
      setEntries(res.data);
      setMeta(res.meta);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e instanceof ApiError ? e.message : 'Denetim kayıtları yüklenemedi');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [token, canView, page, filterEntityType, filterAction, filterActor, filterDateFrom, filterDateTo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!token || !canView) return;
    auditApi
      .facets(token)
      .then((res) => setFacets(res))
      .catch(() => setFacets({ entityTypes: [], actions: [] }));
    usersApi
      .list(token)
      .then((res) => setUsers(res.data))
      .catch(() => setUsers([]));
  }, [token, canView]);

  if (!canView) {
    return (
      <AppShell title="Denetim Kayıtları">
        <PageHeader title="Denetim Kayıtları" description="Bu ekran yalnızca yetkili kullanıcılara açıktır." />
        <ErrorState title="Erişim yok" message="Denetim kayıtlarını görüntüleme izniniz yok (audit.view)." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Denetim Kayıtları">
      <PageHeader
        title="Denetim Kayıtları"
        description="Kritik iş kayıtları append-only tutulur; önce/sonra gövdelerinde hassas alanlar maskelenir. Düzenleme arayüzü yoktur."
      />

      <div className="mb-4"><SectionCard title="Filtreler">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            label="Varlık tipi"
            options={[{ value: '', label: 'Tümü' }, ...facets.entityTypes.map((t) => ({ value: t, label: t }))]}
            value={filterEntityType}
            onChange={(e) => { setFilterEntityType(e.target.value); setPage(1); }}
          />
          <Select
            label="Eylem"
            options={[{ value: '', label: 'Tümü' }, ...facets.actions.map((a) => ({ value: a, label: a }))]}
            value={filterAction}
            onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
          />
          <Select
            label="Aktör"
            options={[{ value: '', label: 'Tümü' }, ...users.map((u) => ({ value: u.id, label: u.fullName }))]}
            value={filterActor}
            onChange={(e) => { setFilterActor(e.target.value); setPage(1); }}
          />
          <TextField label="Başlangıç" type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }} />
          <TextField label="Bitiş" type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }} />
        </div>
      </SectionCard></div>

      <SectionCard
        title="Kayıtlar"
        description={meta ? `Sayfa ${meta.page}/${meta.totalPages || 1} · Toplam ${meta.total.toLocaleString('tr-TR')} kayıt` : undefined}
        action={
          <div className="flex gap-2">
            <Button variant="tertiary" disabled={!meta || meta.page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ← Önceki
            </Button>
            <Button variant="tertiary" disabled={!meta || meta.page >= meta.totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Sonraki →
            </Button>
          </div>
        }
      >
        {error && <ErrorState title="Denetim kayıtları yüklenemedi" message={error} onRetry={() => void reload()} />}
        {!error && loading && <LoadingSkeleton rows={6} />}
        {!error && !loading && entries.length === 0 && (
          <EmptyState title="Kayıt bulunamadı" description="Seçili filtrelerde denetim kaydı yok." />
        )}
        {!error && !loading && entries.length > 0 && (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => {
              const expanded = expandedId === entry.id;
              return (
                <li key={entry.id} className="rounded-card border border-border-default">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                    aria-expanded={expanded}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-surface-50"
                  >
                    <StatusBadge tone="neutral">{entry.entityType}</StatusBadge>
                    <span className="text-xs font-bold text-brand-900">{entry.action}</span>
                    <span className="text-xs text-text-secondary">{entry.actor ? entry.actor.fullName : '(sistem)'}</span>
                    <span className="ml-auto text-[11px] text-text-secondary">{trDateTime(entry.createdAt)}</span>
                  </button>
                  {expanded && (
                    <div className="grid gap-3 border-t border-border-default px-4 py-3 md:grid-cols-2">
                      <div>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-text-secondary">Önce</p>
                        <JsonBody value={entry.before} />
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-text-secondary">Sonra</p>
                        <JsonBody value={entry.after} />
                      </div>
                      <div className="text-[11px] text-text-secondary md:col-span-2">
                        {entry.entityId && <>Kayıt: {entry.entityId} · </>}
                        {entry.ip && <>IP: {entry.ip} · </>}
                        {entry.traceId && <>Trace: {entry.traceId}</>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </AppShell>
  );
}
