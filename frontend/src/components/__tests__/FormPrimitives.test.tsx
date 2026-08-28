import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from '../Button';
import Input from '../Input';
import Textarea from '../Textarea';
import Checkbox from '../Checkbox';
import Radio from '../Radio';
import Switch from '../Switch';
import Tooltip from '../Tooltip';
import Badge from '../Badge';

describe('Button', () => {
  it('defaults to type="button" (no accidental form submit)', () => {
    render(<Button>Ok</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('keeps an explicit type="submit"', () => {
    render(<Button type="submit">Envoyer</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('is disabled and aria-busy while loading', () => {
    render(<Button loading>Chargement</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Input', () => {
  it('links label, error and input via a stable generated id', () => {
    render(<Input label="Email" error="Requis" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const errorId = input.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveAttribute('id', errorId!);
  });

  it('two inputs with the same label do not collide', () => {
    render(
      <>
        <Input label="Nom" />
        <Input label="Nom" />
      </>,
    );
    const inputs = screen.getAllByLabelText('Nom');
    expect(inputs[0].id).not.toBe(inputs[1].id);
  });
});

describe('Textarea', () => {
  it('renders with a label and accessible description', () => {
    render(<Textarea label="Notes" hint="Optionnel" />);
    const ta = screen.getByLabelText('Notes');
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta).toHaveAttribute('aria-describedby');
  });
});

describe('Checkbox / Radio / Switch', () => {
  it('checkbox toggles and fires onChange', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Accepter" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Accepter'));
    expect(onChange).toHaveBeenCalled();
  });

  it('radio is exposed with role radio', () => {
    render(<Radio name="g" label="Choix A" />);
    expect(screen.getByRole('radio')).toBeInTheDocument();
  });

  it('switch is exposed with role switch', () => {
    render(<Switch label="Actif" />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });
});

describe('Tooltip', () => {
  it('shows content on focus and hides on blur', () => {
    render(
      <Tooltip content="Supprimer">
        <button aria-label="del">x</button>
      </Tooltip>,
    );
    const trigger = screen.getByLabelText('del');
    expect(trigger).not.toHaveAttribute('aria-describedby');
    fireEvent.focus(trigger);
    expect(trigger).toHaveAttribute('aria-describedby');
    fireEvent.blur(trigger);
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });
});

describe('Badge', () => {
  it('renders semantic variants', () => {
    render(<Badge variant="success">Livré</Badge>);
    expect(screen.getByText('Livré')).toBeInTheDocument();
  });
});
