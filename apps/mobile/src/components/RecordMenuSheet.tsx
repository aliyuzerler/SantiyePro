import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, touch, typography } from '../theme/tokens';

export interface RecordOption {
  key: string;
  label: string;
  /** Hangi fazda aktif olacağı — iskelet aşamasında dürüst bilgi. */
  phaseNote: string;
  enabled: boolean;
}

export interface RecordMenuSheetProps {
  visible: boolean;
  onClose: () => void;
  options: RecordOption[];
  onSelect?: (option: RecordOption) => void;
}

/**
 * `+ Kayıt` alt menüsü — design/02 navigasyon kuralı:
 * Günlük rapor, Puantaj, Malzeme hareketi, Gider, Fotoğraf/ilerleme.
 * Faz 01 iskeletinde modüller henüz bağlı değildir; seçenekler faz bilgisiyle devre dışı gösterilir.
 */
export function RecordMenuSheet({ visible, onClose, options, onSelect }: RecordMenuSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} accessibilityLabel="Yeni kayıt menüsü">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Menüyü kapat" />
      <View style={styles.sheet}>
        <View style={styles.handle} accessibilityElementsHidden />
        <Text style={styles.title}>Yeni Kayıt</Text>
        <Text style={styles.subtitle}>Kayıt türü seçin</Text>
        <View style={styles.options}>
          {options.map((opt) => (
            <Pressable
              key={opt.key}
              accessibilityRole="button"
              accessibilityLabel={`${opt.label}${opt.enabled ? '' : ` (${opt.phaseNote})`}`}
              accessibilityState={{ disabled: !opt.enabled }}
              disabled={!opt.enabled}
              onPress={() => onSelect?.(opt)}
              style={({ pressed }) => [
                styles.option,
                opt.enabled && pressed && styles.optionPressed,
              ]}
            >
              <Text style={[styles.optionLabel, !opt.enabled && styles.optionDisabled]}>{opt.label}</Text>
              <Text style={[styles.optionNote, !opt.enabled && styles.optionNoteDisabled]}>{opt.phaseNote}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

export const RECORD_OPTIONS: RecordOption[] = [
  { key: 'daily-report', label: 'Günlük rapor', phaseNote: 'Faz 05 ile aktif', enabled: true },
  { key: 'attendance', label: 'Puantaj', phaseNote: 'Faz 06 ile aktif', enabled: false },
  { key: 'stock-movement', label: 'Malzeme hareketi', phaseNote: 'Faz 07 ile aktif', enabled: false },
  { key: 'expense', label: 'Gider', phaseNote: 'Faz 08 ile aktif', enabled: false },
  { key: 'photo-progress', label: 'Fotoğraf / ilerleme', phaseNote: 'Faz 05 ile aktif', enabled: false },
];

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,38,61,0.4)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface[0],
    borderTopLeftRadius: radius.dialog,
    borderTopRightRadius: radius.dialog,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface[100],
    marginBottom: 12,
  },
  title: { ...typography.screenTitle, marginBottom: 2 },
  subtitle: { ...typography.secondary, marginBottom: 12 },
  options: { gap: 4 },
  option: {
    minHeight: touch.preferred,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.input,
  },
  optionPressed: { backgroundColor: colors.surface[100] },
  optionLabel: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
  optionDisabled: { color: colors.text.secondary },
  optionNote: { fontSize: 11, color: colors.brand[600], marginTop: 1 },
  optionNoteDisabled: { color: colors.text.secondary },
});
