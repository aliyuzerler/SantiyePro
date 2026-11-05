/**
 * ŞantiyePro — Sistem rolleri ve izin seed'i (Faz 02).
 * Tek doğruluk kaynağı @santiyepro/contracts (docs/06 matrisi).
 * Idempotent: tekrar çalıştırılabilir; izin/rol kayıtlarını eşitler.
 * Kullanıcı oluşturmaz — ilk admin güvenli bootstrap akışıyla açılır.
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_LABELS } from '@santiyepro/contracts';

export async function runSeed(prisma: PrismaClient): Promise<void> {
  // 1) İzinler
  for (const key of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: key },
    });
  }
  const permissions = await prisma.permission.findMany();
  const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

  // 2) Sistem rolleri
  for (const key of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { key },
      update: { label: SYSTEM_ROLE_LABELS[key], isSystem: true },
      create: { key, label: SYSTEM_ROLE_LABELS[key], isSystem: true },
    });
  }
  const roles = await prisma.role.findMany();
  const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));

  // 3) Rol → izin matrisini eşitle (sadece sistem rolleri)
  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleIdByKey.get(roleKey);
    if (!roleId) continue;
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    for (const permissionKey of permissionKeys) {
      const permissionId = permissionIdByKey.get(permissionKey);
      if (!permissionId) continue;
      await prisma.rolePermission.create({ data: { roleId, permissionId } });
    }
  }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '');

if (isDirectRun) {
  const prisma = new PrismaClient();
  try {
    await runSeed(prisma);
    console.log('Seed tamamlandı: sistem rolleri ve izinler eşitlendi.');
  } finally {
    await prisma.$disconnect();
  }
}
