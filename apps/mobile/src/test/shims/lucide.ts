/**
 * Jest test ortamı için lucide-react-native shim'i.
 * Paket jest'in require akışında ESM (.mjs) çözüldüğü için testlerde bu shim kullanılır;
 * ikonlar görsel ayrıntıdır, kabuk testlerinde davranışsal etkisi yoktur.
 */
import type { ComponentType } from 'react';

const Icon: ComponentType<{ size?: number; color?: string }> = () => null;

export const Home = Icon;
export const FolderKanban = Icon;
export const ListChecks = Icon;
export const User = Icon;
export const Plus = Icon;
export const CloudOff = Icon;
export const FileText = Icon;
export const Server = Icon;
export const Search = Icon;
export const ChevronLeft = Icon;
export const MapPin = Icon;
export const Users = Icon;
export const Archive = Icon;
export const Pencil = Icon;
export const X = Icon;
export const ClipboardList = Icon;

export default Icon;
