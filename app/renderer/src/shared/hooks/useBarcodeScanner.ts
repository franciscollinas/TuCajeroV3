import { useState, useEffect, useCallback, useRef } from 'react';
import { trpc } from '../../trpc';
import type { Product } from '../types/inventory.types';

export interface BarcodeScannerOptions {
  minLength?: number;
  timeout?: number;
  onDetect?: (barcode: string) => void;
  enabled?: boolean;
}

interface BarcodeScannerState {
  barcode: string;
  isScanning: boolean;
  product: Product | null;
  error: string | null;
}

export function useBarcodeScanner(options: BarcodeScannerOptions = {}): BarcodeScannerState & { reset: () => void } {
  const { minLength = 4, timeout = 100, onDetect, enabled = true } = options;

  const [state, setState] = useState<BarcodeScannerState>({
    barcode: '',
    isScanning: false,
    product: null,
    error: null,
  });

  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeyTimeRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const lookupBarcode = useCallback(async (barcode: string) => {
    try {
      const product = await trpc.inventory.getByBarcode.query({ barcode });
      if (product) {
        setState({ barcode, isScanning: false, product: product as Product, error: null });
        onDetect?.(barcode);
      } else {
        setState({ barcode, isScanning: false, product: null, error: 'Producto no encontrado' });
      }
    } catch {
      setState({ barcode, isScanning: false, product: null, error: 'Error al buscar producto' });
    }
  }, [onDetect]);

  const reset = useCallback(() => {
    bufferRef.current = '';
    if (timerRef.current) clearTimeout(timerRef.current);
    setState({ barcode: '', isScanning: false, product: null, error: null });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && bufferRef.current.length >= minLength) {
        e.preventDefault();
        const barcode = bufferRef.current;
        bufferRef.current = '';
        if (timerRef.current) clearTimeout(timerRef.current);
        lookupBarcode(barcode);
        return;
      }

      if (e.key.length === 1) {
        const now = Date.now();
        if (now - lastKeyTimeRef.current > timeout) {
          bufferRef.current = '';
        }
        lastKeyTimeRef.current = now;
        bufferRef.current += e.key;

        if (!stateRef.current.isScanning) {
          setState((prev) => ({ ...prev, isScanning: true }));
        }

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          if (bufferRef.current.length >= minLength) {
            const barcode = bufferRef.current;
            bufferRef.current = '';
            lookupBarcode(barcode);
          } else {
            bufferRef.current = '';
            setState((prev) => ({ ...prev, isScanning: false }));
          }
        }, timeout);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, minLength, timeout, lookupBarcode]);

  return { ...state, reset };
}
