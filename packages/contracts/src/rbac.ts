/**
 * ŞantiyePro — Rol ve Yetki Matrisi (docs/06-roles-permissions.md).
 *
 * Tek doğruluk kaynağı: seed script'i, PermissionsGuard ve istemciler buradan beslenir.
 * Matrisin çevirisi Faz 02 kapsamıyla sınırlıdır; "sınırlı/görüntüle" gibi karma
 * hücreler MVP izin anahtarlarına açıklamalarla çevrilmiştir (Faz 03+ genişletir).
 */

/** Sistem rolleri (docs/06 kolonları). */
export const SYSTEM_ROLES = [
  'FIRM_ADMIN',
  'PROJECT_MANAGER',
  'SITE_CHIEF',
  'TECH_OFFICE',
  'WAREHOUSE',
  'ACCOUNTING',
  'FIELD_WORKER',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Sistem rollerinin Türkçe görünen adları. */
export const SYSTEM_ROLE_LABELS: Record<SystemRole, string> = {
  FIRM_ADMIN: 'Firma Yöneticisi',
  PROJECT_MANAGER: 'Proje Yöneticisi',
  SITE_CHIEF: 'Şantiye Şefi',
  TECH_OFFICE: 'Teknik Ofis',
  WAREHOUSE: 'Depo',
  ACCOUNTING: 'Muhasebe',
  FIELD_WORKER: 'Saha Personeli',
};

/** İzin anahtarları (deny-by-default; hiçbir rolde olmayan izin hiçbir yerde açılmaz). */
export const PERMISSIONS = {
  FIRM_SETTINGS_MANAGE: 'firm.settings.manage',
  USER_MANAGE: 'user.manage',
  USER_VIEW: 'user.view',
  AUDIT_VIEW: 'audit.view',
  PROJECT_VIEW: 'project.view',
  PROJECT_EDIT: 'project.edit',
  DAILY_REPORT_CREATE: 'dailyreport.create',
  DAILY_REPORT_VIEW: 'dailyreport.view',
  DAILY_REPORT_APPROVE: 'dailyreport.approve',
  TASK_ASSIGN: 'task.assign',
  TASK_VIEW: 'task.view',
  TASK_EDIT: 'task.edit',
  ATTENDANCE_EDIT: 'attendance.edit',
  ATTENDANCE_VIEW: 'attendance.view',
  INVENTORY_MOVE: 'inventory.move',
  INVENTORY_VIEW: 'inventory.view',
  EXPENSE_CREATE: 'expense.create',
  EXPENSE_APPROVE: 'expense.approve',
  CLAIM_PREPARE: 'claim.prepare',
  CLAIM_APPROVE: 'claim.approve',
  REPORT_EXPORT: 'report.export',
} as const;
export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Tüm izin anahtarları (seed ve testler için). */
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionKey[];

/**
 * Rol → izin matrisi (docs/06).
 *
 * Notlar:
 * - "Kullanıcı/rol yönetimi: sınırlı (Proje yöneticisi)" ve "Audit log: sınırlı" karma
 *   hücreleri MVP'de tam izin verilmeden boş bırakıldı; Faz 10 rapor fazında
 *   kapsam-lı görüntüleme izni olarak ayrıştırılacak.
 * - "Gider onayı: yapılandırılabilir" MVP'de yalnızca firma yöneticisinde;
 *   firma ayarından özelleştirme Faz 03+ ayar modülüyle gelir.
 * - "Görev atama: sınırlı (Teknik Ofis)" → MVP'de task.edit verilir (görev
 *   oluşturma/düzenleme) ama task.assign verilmez (kişi atayamaz). Faz 10
 *   rapor fazında ayrıştırılacak diğer "sınırlı" hücreler gibi belgelenmiştir.
 * - Görev görüntüleme (task.view): docs/06'da görev satırı yoktur; saha
 *   personeli "Bana Atananlar" listesi için FIELD_WORKER'a da verilir. Proje
 *   kapsamı kontrolü yine üyelikle sınırlıdır. Depo/Muhasebe'ye verilmez.
 * - "Proje görüntüleme: tümü" ayrımı izinle değil, proje kapsamı kontrolüyle yapılır:
 *   FIRM_ADMIN tüm projelere erişir, diğer roller yalnızca ProjectMember olduğu projelere.
 */
export const ROLE_PERMISSIONS: Record<SystemRole, readonly PermissionKey[]> = {
  FIRM_ADMIN: [
    PERMISSIONS.FIRM_SETTINGS_MANAGE,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.PROJECT_EDIT,
    PERMISSIONS.DAILY_REPORT_CREATE,
    PERMISSIONS.DAILY_REPORT_VIEW,
    PERMISSIONS.DAILY_REPORT_APPROVE,
    PERMISSIONS.TASK_ASSIGN,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
    PERMISSIONS.ATTENDANCE_EDIT,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.INVENTORY_MOVE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_APPROVE,
    PERMISSIONS.CLAIM_PREPARE,
    PERMISSIONS.CLAIM_APPROVE,
    PERMISSIONS.REPORT_EXPORT,
  ],
  PROJECT_MANAGER: [
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.PROJECT_EDIT,
    PERMISSIONS.DAILY_REPORT_CREATE,
    PERMISSIONS.DAILY_REPORT_VIEW,
    PERMISSIONS.DAILY_REPORT_APPROVE,
    PERMISSIONS.TASK_ASSIGN,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
    PERMISSIONS.ATTENDANCE_EDIT,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.INVENTORY_MOVE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.CLAIM_PREPARE,
    PERMISSIONS.REPORT_EXPORT,
  ],
  SITE_CHIEF: [
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.DAILY_REPORT_CREATE,
    PERMISSIONS.DAILY_REPORT_VIEW,
    PERMISSIONS.TASK_ASSIGN,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
    PERMISSIONS.ATTENDANCE_EDIT,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.REPORT_EXPORT,
  ],
  TECH_OFFICE: [
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.DAILY_REPORT_VIEW,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.CLAIM_PREPARE,
    PERMISSIONS.REPORT_EXPORT,
  ],
  WAREHOUSE: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.INVENTORY_MOVE,
    PERMISSIONS.INVENTORY_VIEW,
  ],
  ACCOUNTING: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.DAILY_REPORT_VIEW,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_APPROVE,
    PERMISSIONS.CLAIM_PREPARE,
    PERMISSIONS.CLAIM_APPROVE,
    PERMISSIONS.REPORT_EXPORT,
  ],
  FIELD_WORKER: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.TASK_VIEW,
  ],
};

/** Bir kullanıcının izin kümesi: rol listesinden benzersiz izin anahtarları. */
export function permissionsForRoles(roles: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role as SystemRole];
    if (perms) for (const p of perms) set.add(p);
  }
  return set;
}
