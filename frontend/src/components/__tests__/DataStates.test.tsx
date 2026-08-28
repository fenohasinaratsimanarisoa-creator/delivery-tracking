import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Skeleton from '../Skeleton';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import { formatRelativeTime } from '../../services/i18n/formatDate';

describe('Skeleton', () => {
  it('renders the requested number of text lines, decorative for a11y', () => {
    const { container } = render(<Skeleton variant="text" lines={3} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(container.querySelectorAll('span > span').length).toBe(3);
  });
});

describe('EmptyState', () => {
  it('renders title, description and an action slot', () => {
    render(
      <EmptyState title="Aucune livraison" description="Créez-en une." action={<button>Créer</button>} />,
    );
    expect(screen.getByText('Aucune livraison')).toBeInTheDocument();
    expect(screen.getByText('Créez-en une.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('shows a default title and a working retry button', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Une erreur est survenue');
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('formatRelativeTime', () => {
  it('formats recent timestamps relatively', () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    expect(formatRelativeTime(twoMinAgo)).toMatch(/min/);
  });

  it('falls back to an absolute date past the threshold', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeDaysAgo)).not.toMatch(/ago|il y a/i);
  });

  it('returns a dash for an invalid date', () => {
    expect(formatRelativeTime('not-a-date')).toBe('—');
  });
});
