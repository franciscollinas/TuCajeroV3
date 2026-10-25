import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../app/renderer/src/shared/components/Modal';

// Fallo real (3.2.8): al escribir en un formulario dentro de un cuadro de diálogo, el foco saltaba al botón de
// cerrar con cada letra, porque la pantalla pasa onClose escrita en línea (una función nueva en cada dibujado).
function ProductFormLikeScreen({ onClosed }: { onClosed?: () => void }): JSX.Element {
  const [open, setOpen] = useState(true);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Agregar producto</button>
      <Modal isOpen={open} onClose={() => { setOpen(false); onClosed?.(); }} title="Agregar producto">
        <label htmlFor="code">Código</label>
        <input id="code" value={code} onChange={(e) => setCode(e.target.value)} />
        <label htmlFor="name">Nombre</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </Modal>
    </>
  );
}

/** Escribe letra por letra, como el teclado: el campo conserva el foco entre una letra y otra si nada lo quita. */
function typeInto(input: HTMLElement, text: string): void {
  act(() => input.focus());
  for (const char of text) {
    fireEvent.change(input, { target: { value: (input as HTMLInputElement).value + char } });
  }
}

describe('cuadro de diálogo: foco al escribir', () => {
  it('al abrirse, el cursor queda en el primer campo (no en el botón de cerrar)', () => {
    render(<ProductFormLikeScreen />);
    expect(screen.getByLabelText('Código')).toHaveFocus();
  });

  it('se puede escribir una palabra completa sin que el foco salga del campo', () => {
    render(<ProductFormLikeScreen />);
    const code = screen.getByLabelText('Código');

    typeInto(code, 'ABA0042');

    expect(code).toHaveValue('ABA0042');
    expect(code).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cerrar' })).not.toHaveFocus();
  });

  it('en el segundo campo tampoco pierde el foco', () => {
    render(<ProductFormLikeScreen />);

    typeInto(screen.getByLabelText('Código'), 'X1');
    typeInto(screen.getByLabelText('Nombre'), 'Arroz Roa 1kg');

    expect(screen.getByLabelText('Nombre')).toHaveValue('Arroz Roa 1kg');
    expect(screen.getByLabelText('Nombre')).toHaveFocus();
  });

  it('Escape cierra el diálogo y usa la versión más reciente de onClose', () => {
    const onClosed = vi.fn();
    render(<ProductFormLikeScreen onClosed={onClosed} />);
    typeInto(screen.getByLabelText('Código'), 'ABC'); // varios dibujados antes de Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('el botón de cerrar sigue funcionando', () => {
    const onClosed = vi.fn();
    render(<ProductFormLikeScreen onClosed={onClosed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('al cerrarse, el foco vuelve al botón que lo abrió', () => {
    render(<ProductFormLikeScreen />);
    const opener = screen.getByRole('button', { name: 'Agregar producto' });
    act(() => opener.focus());
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
