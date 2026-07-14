import { useEffect, useRef, useCallback } from 'react';
import { useAlertStore } from '../store/alert.store';
import { useAuth } from '../context/AuthContext';

export function useNotifications(): void {
  const { user } = useAuth();
  const { fetchAlerts, stockAlerts, expiryAlerts } = useAlertStore();
  const notifiedItems = useRef<Set<string>>(new Set());

  const checkAndNotify = useCallback(async () => {
    if (!user) return;
    await fetchAlerts();

    const stockCritical = stockAlerts?.critical ?? [];
    const expired = expiryAlerts?.expired ?? [];
    const expiringSoon = expiryAlerts?.expiringSoon ?? [];

    // Notify for critical stock (once per product per session)
    for (const p of stockCritical) {
      const key = `stock-${p.id}`;
      if (!notifiedItems.current.has(key)) {
        notifiedItems.current.add(key);
        if (window.api?.showNotification) {
          window.api.showNotification(
            'Stock crítico',
            `${p.name} — ${p.stock} unidades (mín: ${p.minStock})`,
          );
        }
      }
    }

    // Notify for expired products
    for (const p of expired) {
      const key = `expired-${p.id}`;
      if (!notifiedItems.current.has(key)) {
        notifiedItems.current.add(key);
        if (window.api?.showNotification) {
          window.api.showNotification(
            'Producto vencido',
            `${p.name} — Vencido el ${p.expiryDate}`,
          );
        }
      }
    }

    // Notify for expiring soon (one notification for all)
    if (expiringSoon.length > 0) {
      const key = `expiring-${Math.floor(Date.now() / 3600000)}`; // once per hour
      if (!notifiedItems.current.has(key)) {
        notifiedItems.current.add(key);
        if (window.api?.showNotification) {
          window.api.showNotification(
            'Productos próximos a vencer',
            `${expiringSoon.length} producto(s) vencen pronto. Revisa alertas.`,
          );
        }
      }
    }
  }, [user, fetchAlerts, stockAlerts, expiryAlerts]);

  useEffect(() => {
    if (!user) return;
    // Initial check after 5 seconds
    const initialTimer = setTimeout(() => checkAndNotify(), 5000);
    // Check every 5 minutes
    const interval = setInterval(checkAndNotify, 300000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [user, checkAndNotify]);
}
