/**
 * ŞantiyePro — Kimlik doğrulama ve kullanıcı sözleşmeleri (Faz 02).
 *
 * Kurallar (docs/07-security-rules.md):
 * - Login hataları kullanıcı var/yok ayrımı yapmaz (generic mesaj API'de üretilir).
 * - Parola politikası: en az 10 karakter, büyük/küçük harf ve rakam zorunlu.
 * - Refresh token gövde yerine web'de HttpOnly cookie ile taşınır;
 *   şemada opsiyonel tutulur (mobil SecureStore akışı gövdeyi kullanır).
 */
import { z } from 'zod';

// ---------- Parola politikası ----------

export const passwordSchema = z
  .string()
  .min(10, 'Parola en az 10 karakter olmalıdır')
  .max(128)
  .regex(/[a-zçğıöşü]/, 'Parola en az bir küçük harf içermelidir')
  .regex(/[A-ZÇĞİÖŞÜ]/, 'Parola en az bir büyük harf içermelidir')
  .regex(/[0-9]/, 'Parola en az bir rakam içermelidir');
export type Password = z.infer<typeof passwordSchema>;

// ---------- Kullanıcı DTO ----------

export const userStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userDtoSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string().email(),
  phone: z.string().nullable().optional(),
  status: userStatusSchema,
  roles: z.array(z.string()),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const roleDtoSchema = z.object({
  key: z.string(),
  label: z.string(),
  isSystem: z.boolean(),
});
export type RoleDto = z.infer<typeof roleDtoSchema>;

// ---------- Auth akışları ----------

export const loginRequestSchema = z.object({
  email: z.string().email('Geçerli bir e-posta girin'),
  password: z.string().min(1, 'Parola gereklidir').max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  user: userDtoSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(20).max(512).optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const logoutRequestSchema = z.object({
  refreshToken: z.string().min(20).max(512).optional(),
});
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

export const bootstrapRequestSchema = z.object({
  setupToken: z.string().min(20, 'Kurulum anahtarı geçersiz').max(256),
  fullName: z.string().min(2, 'Ad soyad en az 2 karakter olmalıdır').max(120),
  email: z.string().email(),
  phone: z.string().max(32).optional(),
  password: passwordSchema,
});
export type BootstrapRequest = z.infer<typeof bootstrapRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, 'Mevcut parola gereklidir').max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20).max(256),
  newPassword: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

// ---------- Kullanıcı yönetimi ----------

export const createUserRequestSchema = z.object({
  fullName: z.string().min(2, 'Ad soyad en az 2 karakter olmalıdır').max(120),
  email: z.string().email(),
  phone: z.string().max(32).optional(),
  password: passwordSchema,
  roles: z.array(z.string().min(2)).min(1, 'En az bir rol seçilmelidir'),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().max(32).optional(),
  status: userStatusSchema.optional(),
  roles: z.array(z.string().min(2)).min(1).optional(),
});
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const usersListResponseSchema = z.object({
  data: z.array(userDtoSchema),
  meta: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  }),
});
export type UsersListResponse = z.infer<typeof usersListResponseSchema>;

export const rolesListResponseSchema = z.object({
  data: z.array(roleDtoSchema),
});
export type RolesListResponse = z.infer<typeof rolesListResponseSchema>;
