import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/Button';
import { TextField, Select } from '@/components/ui/Field';
import { SectionCard } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

describe('Button', () => {
  it('etiketle render edilir ve tıklanabilir', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Kaydet</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disabled iken tıklamaz', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Kaydet
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Kaydet' });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading durumunda aria-buyuk set eder ve tıklamaz', async () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Kaydediliyor" onClick={onClick}>
        Kaydet
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Kaydediliyor')).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('varyant sınıfları doğru uygulanır', () => {
    render(<Button variant="destructive">Sil</Button>);
    expect(screen.getByRole('button', { name: 'Sil' }).className).toContain('bg-danger-600');
  });
});

describe('TextField / Select', () => {
  it('label input ile ilişkilidir', () => {
    render(<TextField label="Proje adı" required />);
    const input = screen.getByLabelText(/Proje adı/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('required');
  });

  it('hata mesajı role=alert ile görünür ve aria-invalid set edilir', () => {
    render(<TextField label="E-posta" error="Geçerli bir e-posta girin" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Geçerli bir e-posta girin');
    expect(screen.getByLabelText(/E-posta/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('yardım metni aria-describedby ile bağlanır', () => {
    render(<TextField label="Kod" helpText="PRJ-YYYY-NNN biçiminde girin" />);
    const input = screen.getByLabelText(/Kod/);
    const described = input.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described as string)).toHaveTextContent('PRJ-YYYY-NNN');
  });

  it('Select seçeneklerini ve placeholder alanını render eder', () => {
    render(
      <Select
        label="Durum"
        placeholder="Seçiniz"
        options={[
          { value: 'active', label: 'Aktif' },
          { value: 'passive', label: 'Pasif' },
        ]}
      />,
    );
    const select = screen.getByLabelText(/Durum/) as HTMLSelectElement;
    expect(select.options).toHaveLength(3);
    expect(select.options[0]).toHaveTextContent('Seçiniz');
  });
});

describe('Card / StatusBadge', () => {
  it('SectionCard başlık ve açıklama gösterir', () => {
    render(
      <SectionCard title="Haftalık aktivite" description="Son 6 hafta">
        <p>içerik</p>
      </SectionCard>,
    );
    expect(screen.getByText('Haftalık aktivite')).toBeInTheDocument();
    expect(screen.getByText('Son 6 hafta')).toBeInTheDocument();
  });

  it('StatusBadge metin + ikon gösterir (renk tek başına değil)', () => {
    render(<StatusBadge tone="approved">Onaylandı</StatusBadge>);
    const badge = screen.getByText('Onaylandı').closest('span');
    expect(badge).toHaveTextContent('✓');
    expect(badge).toHaveTextContent('Onaylandı');
  });
});

describe('EmptyState / ErrorState / LoadingSkeleton', () => {
  it('EmptyState başlık ve açıklama gösterir', () => {
    render(<EmptyState title="Henüz proje yok" description="Proje modülü Faz 03'te eklenecek." />);
    expect(screen.getByText('Henüz proje yok')).toBeInTheDocument();
    expect(screen.getByText(/Faz 03'te eklenecek/)).toBeInTheDocument();
  });

  it('ErrorState role=alert ile retry sunar', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Sunucuya ulaşılamadı" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('LoadingSkeleton aria-busy taşır', () => {
    render(<LoadingSkeleton rows={2} />);
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByText('İçerik yükleniyor…')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('açıkken onay/iptal akışı çalışır', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Kaydı sil"
        message="Bu işlem geri alınamaz. Devam edilsin mi?"
        destructive
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Kaydı sil' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('Escape ile kapanır', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Kapatma testi" message="x" onConfirm={() => {}} onCancel={onCancel} />,
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });

  it('kapalıyken render etmez', () => {
    render(<ConfirmDialog open={false} title="gizli" message="x" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
