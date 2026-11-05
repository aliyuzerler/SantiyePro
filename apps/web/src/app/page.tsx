/**
 * Faz 00 bootable iskelet — genel bakış.
 * Faz 01'de tasarım sistemi ve AppShell (sidebar/topbar) eklenir.
 * Gerçek veri yoksa gerçekmiş gibi gösterim yasaktır (design/03).
 */
export default function HomePage() {
  return (
    <main style={{ padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ color: '#14263D', fontSize: 24, marginBottom: 8 }}>ŞantiyePro</h1>
      <p style={{ color: '#5C6B7A', fontSize: 14 }}>
        Web paneli iskeleti çalışıyor. Tasarım sistemi ve uygulama kabuğu Faz 01&apos;de eklenmektedir.
      </p>
    </main>
  );
}
