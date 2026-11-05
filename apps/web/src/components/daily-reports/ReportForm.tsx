'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Select, TextArea, TextField } from '@/components/ui/Field';
import { SectionCard } from '@/components/ui/Card';
import { useAuth } from '@/lib/auth';
import { ApiError, dailyReportsApi, mediaApi, projectsApi, type ProjectDetailDto } from '@/lib/api';
import { MEDIA_MIME_ALLOWLIST, permissionsForRoles, type DailyReportDetailDto } from '@santiyepro/contracts';

/**
 * Günlük rapor formu (Faz 05) — oluşturma ve düzenleme.
 *
 * Metin korunumu kuralı: form önce TASLAK kaydeder, fotoğraflar SONRA yüklenir;
 * yükleme başarısız olsa bile rapor metni kaybolmaz (hata mesajıyla devam edilir).
 * Gönderilmiş/onaylı rapor düzenlemesinde sunucu otomatik revizyon oluşturur.
 */

interface WorkerRow {
  name: string;
  jobTitle: string;
  workerCount: number;
  hours: string;
}

export interface ReportFormProps {
  /** Düzenleme modunda mevcut rapor; yoksa oluşturma modu. */
  report?: DailyReportDetailDto;
  onSaved?: (id: string) => void;
}

const emptyWorker: WorkerRow = { name: '', jobTitle: '', workerCount: 1, hours: '8' };

export function ReportForm({ report, onSaved }: ReportFormProps) {
  const { user, getToken } = useAuth();
  const token = getToken();
  const router = useRouter();
  const canCreate = permissionsForRoles(user?.roles ?? []).has('dailyreport.create');

  const [projects, setProjects] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [sites, setSites] = useState<Array<{ id: string; name: string }>>([]);

  const [projectId, setProjectId] = useState(report?.projectId ?? '');
  const [siteId, setSiteId] = useState(report?.siteId ?? '');
  const [reportDate, setReportDate] = useState(report?.reportDate ?? new Date().toISOString().slice(0, 10));
  const [weather, setWeather] = useState(report?.weather ?? '');
  const [workSummary, setWorkSummary] = useState(report?.workSummary ?? '');
  const [workforceSummary, setWorkforceSummary] = useState(report?.workforceSummary ?? '');
  const [equipmentSummary, setEquipmentSummary] = useState(report?.equipmentSummary ?? '');
  const [issues, setIssues] = useState(report?.issues ?? '');
  const [safetyNotes, setSafetyNotes] = useState(report?.safetyNotes ?? '');
  const [nextDayPlan, setNextDayPlan] = useState(report?.nextDayPlan ?? '');
  const [workers, setWorkers] = useState<WorkerRow[]>(
    report?.workers.map((w) => ({ name: w.name, jobTitle: w.jobTitle ?? '', workerCount: w.workerCount, hours: w.hours })) ?? [],
  );

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Array<{ name: string; size: number; url: string }>>([]);
  const [existingMedia, setExistingMedia] = useState(report?.media ?? []);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [uploadWarning, setUploadWarning] = useState<string>();

  useEffect(() => {
    if (!token || projectId) return;
    projectsApi
      .list(token, { sort: 'name', order: 'asc' })
      .then((res) => setProjects(res.data.map((p) => ({ id: p.id, code: p.code, name: p.name }))))
      .catch(() => setProjects([]));
  }, [token, projectId]);

  // Proje seçilince şantiyeler
  useEffect(() => {
    if (!token || !projectId) {
      setSites([]);
      return;
    }
    projectsApi
      .get(token, projectId)
      .then((res: ProjectDetailDto) => setSites(res.sites.map((s) => ({ id: s.id, name: s.name }))))
      .catch(() => setSites([]));
  }, [token, projectId]);

  function onFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    setFiles(selected);
    setPreviews(
      selected.map((f) => ({
        name: f.name,
        size: f.size,
        url: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
      })),
    );
  }

  function addWorker() {
    setWorkers((rows) => [...rows, { ...emptyWorker }]);
  }

  function updateWorker(index: number, patch: Partial<WorkerRow>) {
    setWorkers((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeWorker(index: number) {
    setWorkers((rows) => rows.filter((_, i) => i !== index));
  }

  async function uploadSelectedFiles(savedProjectId: string): Promise<string[]> {
    if (!token) return [];
    const mediaIds: string[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const { mediaId, uploadUrl } = await mediaApi.requestUploadUrl(token, {
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          projectId: savedProjectId,
        });
        await mediaApi.uploadBinary(uploadUrl, file);
        await mediaApi.complete(token, mediaId);
        mediaIds.push(mediaId);
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : 'yüklenemedi'}`);
      }
    }
    if (failures.length > 0) {
      setUploadWarning(`Bazı dosyalar yüklenemedi (rapor metni taslakta korundu): ${failures.join(' · ')}`);
    }
    return mediaIds;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setFormError(undefined);
    setUploadWarning(undefined);
    try {
      const payload = {
        projectId,
        siteId: siteId || undefined,
        reportDate,
        weather: weather || undefined,
        workSummary: workSummary.trim(),
        workforceSummary: workforceSummary || undefined,
        equipmentSummary: equipmentSummary || undefined,
        issues: issues || undefined,
        safetyNotes: safetyNotes || undefined,
        nextDayPlan: nextDayPlan || undefined,
        workers: workers.filter((w) => w.name.trim().length > 0),
      };

      // 1) Metni ÖNCE kaydet (taslak) — medya yüklemesi başarısız olsa da metin kaybolmaz.
      const saved = report
        ? await dailyReportsApi.update(token, report.id, payload)
        : await dailyReportsApi.create(token, payload);

      // 2) Sonra fotoğrafları yükle ve ekle.
      const mediaIds = await uploadSelectedFiles(saved.projectId);
      if (mediaIds.length > 0) {
        setExistingMedia([]);
        await dailyReportsApi.update(token, saved.id, { mediaIds });
      }

      if (onSaved) onSaved(saved.id);
      else router.push(`/gunluk-raporlar/${saved.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Rapor kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  if (!canCreate) {
    return (
      <p className="rounded-card border border-border-default bg-surface-50 p-4 text-sm text-text-secondary">
        Günlük rapor oluşturma yetkiniz yok (dailyreport.create). Şantiye şefi veya proje yöneticinize başvurun.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <SectionCard
        title={report ? 'Raporu Düzenle' : 'Yeni Günlük Rapor'}
        description="Bölümleri doldurun; uzun formlarda taslağı kaydedip sonra devam edebilirsiniz."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Select
            label="Proje"
            required
            disabled={Boolean(report)}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="Proje seçin"
            options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
          />
          <Select
            label="Şantiye"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            placeholder="Seçilmedi"
            options={sites.map((s) => ({ value: s.id, label: s.name }))}
          />
          <TextField label="Rapor Tarihi" required type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
          <TextField label="Hava Durumu" placeholder="Güneş / Yağmurlu / Rüzgarlı…" value={weather} onChange={(e) => setWeather(e.target.value)} />
        </div>

        <div className="grid gap-3">
          <TextArea label="Yapılan İşler" required value={workSummary} onChange={(e) => setWorkSummary(e.target.value)} helpText="Bugün tamamlanan işler (zorunlu)." />
          <TextArea label="Ekip / Personel Özeti" value={workforceSummary} onChange={(e) => setWorkforceSummary(e.target.value)} />
          <TextArea label="Ekipman ve Makine" value={equipmentSummary} onChange={(e) => setEquipmentSummary(e.target.value)} />
          <TextArea label="Sorun / Gecikme" value={issues} onChange={(e) => setIssues(e.target.value)} />
          <TextArea label="İş Güvenliği Notu" value={safetyNotes} onChange={(e) => setSafetyNotes(e.target.value)} />
          <TextArea label="Ertesi Gün Planı" value={nextDayPlan} onChange={(e) => setNextDayPlan(e.target.value)} />
        </div>

        {/* Ekip satırları */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Ekip / Personel Satırları</h3>
            <Button type="button" variant="secondary" onClick={addWorker} className="min-h-9 px-3 py-1 text-xs" leading="+">
              Satır Ekle
            </Button>
          </div>
          {workers.map((row, index) => (
            <div key={index} className="grid gap-2 rounded-card border border-border-default bg-surface-50 p-3 md:grid-cols-[2fr_1.5fr_0.8fr_0.8fr_auto]">
              <TextField label="Ad" value={row.name} onChange={(e) => updateWorker(index, { name: e.target.value })} />
              <TextField label="Görev" value={row.jobTitle} onChange={(e) => updateWorker(index, { jobTitle: e.target.value })} />
              <TextField
                label="Kişi"
                type="number"
                min={1}
                value={String(row.workerCount)}
                onChange={(e) => updateWorker(index, { workerCount: Math.max(1, Number(e.target.value) || 1) })}
              />
              <TextField label="Saat" value={row.hours} onChange={(e) => updateWorker(index, { hours: e.target.value })} helpText="Örn. 8.5" />
              <div className="flex items-end pb-1">
                <Button type="button" variant="secondary" onClick={() => removeWorker(index)} className="min-h-9 px-2 py-1 text-xs">
                  Sil
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Fotoğraf/belge ekleri */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-primary">Fotoğraf ve Belge Ekleri</h3>
          <input
            type="file"
            multiple
            accept={[...MEDIA_MIME_ALLOWLIST].join(',')}
            onChange={onFilesSelected}
            className="text-sm text-text-secondary"
          />
          {previews.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {previews.map((p) => (
                <li key={p.name} className="flex items-center gap-2 rounded-card border border-border-default bg-surface-50 p-2 text-xs">
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={p.name} className="h-12 w-12 rounded-input object-cover" />
                  ) : (
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-input bg-surface-100">📄</span>
                  )}
                  <span className="max-w-40 truncate text-text-secondary" title={p.name}>
                    {p.name} · {(p.size / 1024).toFixed(0)} KB
                  </span>
                </li>
              ))}
            </ul>
          )}
          {existingMedia.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {existingMedia.map((m) => (
                <li key={m.id} className="rounded-card border border-border-default bg-surface-50 p-2 text-xs text-text-secondary">
                  📎 {m.originalName}
                </li>
              ))}
            </ul>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-xs font-medium text-danger-600">
            {formError}
          </p>
        )}
        {uploadWarning && (
          <p role="alert" className="rounded-card border border-border-default bg-surface-50 p-2 text-xs font-medium text-danger-600">
            {uploadWarning}
          </p>
        )}

        <div>
          <Button type="submit" loading={saving} loadingLabel="Kaydediliyor…">
            {report ? 'Değişiklikleri Kaydet' : 'Taslağı Kaydet'}
          </Button>
        </div>
      </SectionCard>
    </form>
  );
}
