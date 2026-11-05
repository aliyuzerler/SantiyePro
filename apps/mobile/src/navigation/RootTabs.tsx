import { useState } from 'react';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Home, FolderKanban, ListChecks, User, Plus } from 'lucide-react-native';
import { HomeScreen } from '../screens/HomeScreen';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { TasksScreen } from '../screens/TasksScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { RecordMenuSheet, RECORD_OPTIONS } from '../components/RecordMenuSheet';
import { colors, touch } from '../theme/tokens';

export type RootTabParamList = {
  AnaSayfa: undefined;
  Projeler: undefined;
  Gorevler: undefined;
  Profil: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

/** Alt navigasyon — design/02: Ana Sayfa, Projeler, ortada `+ Kayıt`, Görevler, Profil. */
export function RootTabs() {
  const [recordMenuOpen, setRecordMenuOpen] = useState(false);

  const tabBar = (props: BottomTabBarProps) => (
    <View style={styles.tabBarWrap}>
      <View style={styles.tabBar} accessibilityRole="tablist">
        <TabButton
          icon={<Home size={22} color={props.state.index === 0 ? colors.brand[900] : '#788795'} />}
          label="Ana Sayfa"
          active={props.state.index === 0}
          onPress={() => props.navigation.navigate('AnaSayfa')}
        />
        <TabButton
          icon={<FolderKanban size={22} color={props.state.index === 1 ? colors.brand[900] : '#788795'} />}
          label="Projeler"
          active={props.state.index === 1}
          onPress={() => props.navigation.navigate('Projeler')}
        />

        {/* Ortadaki `+ Kayıt` aksiyonu — sekme değil, menü açan birincil aksiyon. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Yeni kayıt ekle"
          onPress={() => setRecordMenuOpen(true)}
          style={styles.fab}
        >
          <Plus size={24} color={colors.brand[900]} />
        </Pressable>

        <TabButton
          icon={<ListChecks size={22} color={props.state.index === 2 ? colors.brand[900] : '#788795'} />}
          label="Görevler"
          active={props.state.index === 2}
          onPress={() => props.navigation.navigate('Gorevler')}
        />
        <TabButton
          icon={<User size={22} color={props.state.index === 3 ? colors.brand[900] : '#788795'} />}
          label="Profil"
          active={props.state.index === 3}
          onPress={() => props.navigation.navigate('Profil')}
        />
      </View>
      <RecordMenuSheet
        visible={recordMenuOpen}
        onClose={() => setRecordMenuOpen(false)}
        options={RECORD_OPTIONS}
      />
    </View>
  );

  return (
    <Tab.Navigator tabBar={tabBar} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="AnaSayfa" component={HomeScreen} />
      <Tab.Screen name="Projeler" component={ProjectsScreen} />
      <Tab.Screen name="Gorevler" component={TasksScreen} />
      <Tab.Screen name="Profil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

interface TabButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onPress: () => void;
}

function TabButton({ icon, label, active, onPress }: TabButtonProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.tabButton}
    >
      {icon}
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabBarWrap: { backgroundColor: colors.surface[0] },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    backgroundColor: colors.surface[0],
    height: 62,
  },
  tabButton: {
    minWidth: touch.min,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    flex: 1,
    paddingVertical: 6,
  },
  tabLabel: { fontSize: 10, color: '#788795' },
  tabLabelActive: { color: colors.brand[900], fontWeight: '700' },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent[500],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface[0],
    marginTop: -18,
  },
});
