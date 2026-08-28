import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from '../Modal';
import Pagination from '../Pagination';
import Tabs from '../Tabs';

describe('Modal', () => {
  it('renders into a portal with dialog semantics when open', () => {
    render(
      <Modal open onClose={() => {}} title="Confirmer">
        <p>Contenu</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Confirmer');
    expect(screen.getByText('Contenu')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="X" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape and locks body scroll while open', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Modal open onClose={onClose} title="X" />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Pagination', () => {
  it('renders range + page and disables edges', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} totalPages={3} total={45} pageSize={20} onPageChange={onPageChange} />);
    expect(screen.getByText('1–20 sur 45')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Page précédente')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Page suivante'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe('Tabs', () => {
  it('exposes tablist semantics and switches with arrow keys', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        aria-label="Vue"
        value="a"
        onChange={onChange}
        items={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
