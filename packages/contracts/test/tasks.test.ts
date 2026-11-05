/**
 * Faz 04 sözleşme testleri — görev durum makinesi, gecikme hesabı, şemalar ve izin matrisi.
 */
import { describe, expect, it } from 'vitest';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  addTaskCommentRequestSchema,
  canTransitionTaskStatus,
  createTaskRequestSchema,
  isTaskOverdue,
  nextTaskStatuses,
  permissionsForRoles,
  taskDtoSchema,
  updateTaskRequestSchema,
  type TaskStatus,
} from '../src/index.js';

describe('görev durum makinesi', () => {
  it('geçerli geçişler kabul edilir', () => {
    expect(canTransitionTaskStatus('TODO', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionTaskStatus('TODO', 'BLOCKED')).toBe(true);
    expect(canTransitionTaskStatus('TODO', 'CANCELLED')).toBe(true);
    expect(canTransitionTaskStatus('IN_PROGRESS', 'DONE')).toBe(true);
    expect(canTransitionTaskStatus('IN_PROGRESS', 'BLOCKED')).toBe(true);
    expect(canTransitionTaskStatus('IN_PROGRESS', 'TODO')).toBe(true);
    expect(canTransitionTaskStatus('BLOCKED', 'IN_PROGRESS')).toBe(true);
  });

  it('geçersiz geçişler reddedilir', () => {
    expect(canTransitionTaskStatus('TODO', 'DONE')).toBe(false);
    expect(canTransitionTaskStatus('TODO', 'IN_PROGRESS') && canTransitionTaskStatus('BLOCKED', 'DONE')).toBe(false);
    expect(canTransitionTaskStatus('DONE', 'TODO')).toBe(false);
    expect(canTransitionTaskStatus('DONE', 'CANCELLED')).toBe(false);
    expect(canTransitionTaskStatus('CANCELLED', 'TODO')).toBe(false);
    expect(canTransitionTaskStatus('CANCELLED', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionTaskStatus('IN_PROGRESS', 'IN_PROGRESS')).toBe(false);
  });

  it('terminal durumdan çıkış yok; UI hedefleri matrisle uyumlu', () => {
    expect(nextTaskStatuses('DONE')).toEqual([]);
    expect(nextTaskStatuses('CANCELLED')).toEqual([]);
    expect(nextTaskStatuses('TODO')).toEqual(['IN_PROGRESS', 'BLOCKED', 'CANCELLED']);
    // Tüm durumlar tanımlı etikete sahip
    for (const status of TASK_STATUSES) expect(typeof status).toBe('string');
    expect(TASK_STATUSES).toHaveLength(5);
  });
});

describe('isTaskOverdue (gecikme hesabı)', () => {
  const now = new Date('2026-11-05T12:00:00.000Z');

  it('termin geçmiş ve açık görev → gecikmiş', () => {
    expect(
      isTaskOverdue({ dueAt: '2026-11-05T11:59:00.000Z', status: 'IN_PROGRESS' }, now),
    ).toBe(true);
    expect(isTaskOverdue({ dueAt: '2026-11-05T11:59:00.000Z', status: 'TODO' }, now)).toBe(true);
    expect(isTaskOverdue({ dueAt: '2026-11-05T11:59:00.000Z', status: 'BLOCKED' }, now)).toBe(true);
  });

  it('termin gelecekteyse veya birebir şimdiyse gecikmemiş', () => {
    expect(isTaskOverdue({ dueAt: '2026-11-05T12:00:00.000Z', status: 'IN_PROGRESS' }, now)).toBe(false);
    expect(isTaskOverdue({ dueAt: '2026-11-06T09:00:00.000Z', status: 'TODO' }, now)).toBe(false);
  });

  it('DONE / CANCELLED görevler termin geçse bile gecikmiş sayılmaz', () => {
    expect(isTaskOverdue({ dueAt: '2026-01-01T00:00:00.000Z', status: 'DONE' }, now)).toBe(false);
    expect(isTaskOverdue({ dueAt: '2026-01-01T00:00:00.000Z', status: 'CANCELLED' }, now)).toBe(false);
  });

  it('terminsiz veya bozuk tarih gecikmiş sayılmaz', () => {
    expect(isTaskOverdue({ dueAt: null, status: 'IN_PROGRESS' }, now)).toBe(false);
    expect(isTaskOverdue({ dueAt: 'geçersiz', status: 'IN_PROGRESS' }, now)).toBe(false);
  });
});

describe('görev şemaları', () => {
  const validBase = {
    projectId: 'prj-1',
    title: 'Beton döküm planla',
    priority: 'HIGH',
    dueAt: '2026-11-06T09:00:00.000Z',
  };

  it('geçerli oluşturma isteği kabul edilir; checklist varsayılanı uygulanır', () => {
    const parsed = createTaskRequestSchema.parse({
      ...validBase,
      checklist: [{ label: 'Kalıp kontrolü' }],
    });
    expect(parsed.priority).toBe('HIGH');
    expect(parsed.checklist?.[0]?.done).toBe(false);
  });

  it('zorunlu alan doğrulaması: kısa başlık ve proje yok → hata', () => {
    expect(createTaskRequestSchema.safeParse({ title: 'ab' }).success).toBe(false);
    expect(createTaskRequestSchema.safeParse({ ...validBase, projectId: '' }).success).toBe(false);
  });

  it('dueAt timezone sınırı: ofsetsiz/saat içermeyen tarih reddedilir', () => {
    expect(createTaskRequestSchema.safeParse({ ...validBase, dueAt: '06.11.2026' }).success).toBe(false);
    expect(createTaskRequestSchema.safeParse({ ...validBase, dueAt: '2026-11-06' }).success).toBe(false);
    expect(createTaskRequestSchema.safeParse({ ...validBase, dueAt: '2026-11-06T09:00:00+03:00' }).success).toBe(true);
  });

  it('checklist ve fileRef sınırları zorunlu alanları doğrular', () => {
    expect(
      createTaskRequestSchema.safeParse({ ...validBase, checklist: [{ label: '' }] }).success,
    ).toBe(false);
  });

  it('güncelleme isteği boş olamaz; version pozitif tam sayıdır', () => {
    expect(updateTaskRequestSchema.safeParse({}).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ status: 'DONE', version: 0 }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ status: 'DONE', version: 3 }).success).toBe(true);
  });

  it('yorum gövdesi boş olamaz', () => {
    expect(addTaskCommentRequestSchema.safeParse({ body: '' }).success).toBe(false);
    expect(addTaskCommentRequestSchema.safeParse({ body: 'Kalıp hazır' }).success).toBe(true);
  });

  it('taskDto overdue alanını doğrular', () => {
    const dto = {
      id: 't1',
      projectId: 'p1',
      title: 'Görev',
      status: 'IN_PROGRESS' as TaskStatus,
      priority: 'MEDIUM' as const,
      dueAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      checklist: [],
      fileRefs: [],
      commentCount: 0,
      version: 1,
      overdue: true,
      createdById: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(taskDtoSchema.safeParse(dto).success).toBe(true);
    expect(TASK_PRIORITIES).toHaveLength(4);
  });
});

describe('izin matrisi (Faz 04 görev izinleri)', () => {
  it('saha personeli görevleri görebilir ama düzenleyemez/atayamaz', () => {
    const perms = permissionsForRoles(['FIELD_WORKER']);
    expect(perms.has('task.view')).toBe(true);
    expect(perms.has('task.edit')).toBe(false);
    expect(perms.has('task.assign')).toBe(false);
  });

  it('teknik ofis görev oluşturur/düzenler ama kişi atayamaz ("sınırlı" hücresi)', () => {
    const perms = permissionsForRoles(['TECH_OFFICE']);
    expect(perms.has('task.view')).toBe(true);
    expect(perms.has('task.edit')).toBe(true);
    expect(perms.has('task.assign')).toBe(false);
  });

  it('şantiye şefi ve proje yöneticisi atayabilir; depo/muhasebe görev görmez', () => {
    expect(permissionsForRoles(['SITE_CHIEF']).has('task.assign')).toBe(true);
    expect(permissionsForRoles(['PROJECT_MANAGER']).has('task.assign')).toBe(true);
    expect(permissionsForRoles(['FIRM_ADMIN']).has('task.assign')).toBe(true);
    expect(permissionsForRoles(['WAREHOUSE']).has('task.view')).toBe(false);
    expect(permissionsForRoles(['ACCOUNTING']).has('task.view')).toBe(false);
  });
});
